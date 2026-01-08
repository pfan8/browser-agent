/**
 * Agent IPC Handlers
 *
 * Handles agent task execution, stopping, and status queries.
 * Extracted from main.ts to maintain file size under 800 lines.
 *
 * Uses Orchestrator ↔ Executor pattern
 */

import { ipcMain } from 'electron';
import type { AgentState } from '@chat-agent/agent-core';
import { getAgent, safeSend, safeSerialize, log } from './shared';

// ============================================================
// State Types (for type safety)
// ============================================================

interface SubAgentRequestState {
    id: string;
    agentName: string;
    input: {
        text?: string;
        content: Array<{ type: string; text?: string }>;
    };
}

interface SubAgentResultState {
    success: boolean;
    output: {
        text?: string;
        content: Array<{ type: string; text?: string }>;
    };
    error?: string;
    duration: number;
    artifacts?: Array<{ type: string; path: string }>;
}

interface OrchestratorAgentState {
    goal?: string;
    status?: string;
    iterationCount?: number;
    pendingSubAgentRequest?: SubAgentRequestState;
    lastSubAgentResult?: SubAgentResultState;
    outputMessages?: Array<{ text?: string }>;
    isComplete?: boolean;
    error?: string;
    result?: string;
}

// ============================================================
// Step Tracker
// ============================================================

/**
 * Track and emit agent step events for Orchestrator architecture
 */
function createStepTracker() {
    let stepCounter = 0;
    const stepStartTimes = new Map<string, number>();

    // Pending step tracking
    let pendingOrchestratorStepId: string | null = null;
    let pendingExecutorStepId: string | null = null;
    let lastIterationCount = 0;
    let lastRequestId = '';

    return {
        /**
         * Handle orchestrator node events
         * Extracts thinking/reasoning from the decision
         */
        handleOrchestrator: (state: OrchestratorAgentState) => {
            const iterationCount = state.iterationCount || 0;

            // Complete pending orchestrator step if iteration changed
            if (pendingOrchestratorStepId && iterationCount > lastIterationCount) {
                const duration = stepStartTimes.get(pendingOrchestratorStepId)
                    ? Date.now() - stepStartTimes.get(pendingOrchestratorStepId)!
                    : 100;

                safeSend('agent-step-completed', {
                    step: {
                        id: pendingOrchestratorStepId,
                        description: '决策完成',
                    },
                    node: 'planner',
                    duration,
                });
                pendingOrchestratorStepId = null;
            }

            // Check if there's a new SubAgent request (orchestrator made a decision)
            const request = state.pendingSubAgentRequest;
            if (request && request.id !== lastRequestId) {
                lastRequestId = request.id;
                lastIterationCount = iterationCount;

                // Start new orchestrator step
                const stepId = `step-${++stepCounter}-orchestrator`;
                stepStartTimes.set(stepId, Date.now());
                pendingOrchestratorStepId = stepId;

                // Extract instruction text
                const instructionText = request.input?.text ||
                    request.input?.content
                        ?.filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join(' ') ||
                    '正在分析...';

                const thought = `决定调用 ${request.agentName} 执行任务`;

                safeSend('agent-step-started', {
                    step: {
                        id: stepId,
                        description: `🧠 ${thought}`,
                    },
                    node: 'planner',
                    action: {
                        thought,
                        instruction: instructionText.substring(0, 100),
                    },
                });

                // Send thinking update
                safeSend('agent-thinking-update', {
                    stepId,
                    thought,
                    instruction: instructionText.substring(0, 200),
                });
            }
        },

        /**
         * Handle executor node events
         * Extracts execution details from SubAgent result
         */
        handleExecutor: (state: OrchestratorAgentState) => {
            const request = state.pendingSubAgentRequest;
            const result = state.lastSubAgentResult;

            // Start executor step when request is pending
            if (request && !pendingExecutorStepId) {
                const stepId = `step-${++stepCounter}-executor`;
                stepStartTimes.set(stepId, Date.now());
                pendingExecutorStepId = stepId;

                const instructionText = request.input?.text ||
                    request.input?.content
                        ?.filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join(' ') ||
                    '执行中...';

                safeSend('agent-step-started', {
                    step: {
                        id: stepId,
                        description: `⚡ ${request.agentName}: ${instructionText.substring(0, 40)}...`,
                        tool: request.agentName,
                    },
                    node: 'codeact',
                    action: {
                        instruction: instructionText,
                        thought: `使用 ${request.agentName} 执行`,
                    },
                });
            }

            // Complete executor step when result arrives
            if (result && pendingExecutorStepId) {
                const duration = result.duration || 
                    (stepStartTimes.get(pendingExecutorStepId)
                        ? Date.now() - stepStartTimes.get(pendingExecutorStepId)!
                        : 100);

                const outputText = result.output?.text ||
                    result.output?.content
                        ?.filter((c) => c.type === 'text')
                        .map((c) => c.text)
                        .join(' ') ||
                    '';

                if (result.success) {
                    safeSend('agent-step-completed', {
                        step: {
                            id: pendingExecutorStepId,
                            description: `✅ ${outputText.substring(0, 50)}${outputText.length > 50 ? '...' : ''}`,
                        },
                        node: 'codeact',
                        duration,
                        thought: outputText.substring(0, 200),
                    });
                } else {
                    safeSend('agent-step-failed', {
                        step: {
                            id: pendingExecutorStepId,
                            description: `❌ ${result.error?.substring(0, 40) || '执行失败'}`,
                            tool: request?.agentName || 'unknown',
                        },
                        node: 'codeact',
                        error: result.error || 'Unknown error',
                        duration,
                    });
                }

                pendingExecutorStepId = null;
            }
        },

        /**
         * Complete any pending steps when task finishes
         */
        completePendingSteps: () => {
            if (pendingOrchestratorStepId) {
                safeSend('agent-step-completed', {
                    step: { id: pendingOrchestratorStepId, description: '分析完成' },
                    node: 'planner',
                    duration: stepStartTimes.get(pendingOrchestratorStepId)
                        ? Date.now() - stepStartTimes.get(pendingOrchestratorStepId)!
                        : 100,
                });
                pendingOrchestratorStepId = null;
            }
            if (pendingExecutorStepId) {
                safeSend('agent-step-completed', {
                    step: { id: pendingExecutorStepId, description: '执行完成' },
                    node: 'codeact',
                    duration: stepStartTimes.get(pendingExecutorStepId)
                        ? Date.now() - stepStartTimes.get(pendingExecutorStepId)!
                        : 100,
                });
                pendingExecutorStepId = null;
            }
        },
    };
}

/**
 * Register agent IPC handlers
 */
export function registerAgentHandlers(): void {
    // Agent Task Execution
    ipcMain.handle(
        'agent-execute-task',
        async (
            _event,
            task: string,
            options?: { threadId?: string; continueSession?: boolean }
        ) => {
            log.info(
                `Executing task: "${task.substring(0, 100)}${
                    task.length > 100 ? '...' : ''
                }"`,
                {
                    threadId: options?.threadId,
                    continueSession: options?.continueSession,
                }
            );

            try {
                const agentInstance = getAgent();
                // Create step tracker for the orchestrator architecture
                const tracker = createStepTracker();
                let finalState: AgentState | null = null;

                const threadId = options?.threadId;
                const continueSession = options?.continueSession ?? false;

                for await (const event of agentInstance.streamTask(
                    task,
                    threadId,
                    continueSession
                )) {
                    // Check abort
                    if (event.node === '__abort__') {
                        log.info('Task was stopped by user');
                        safeSend('agent-task-stopped', {
                            message: '任务已被用户停止',
                        });
                        return safeSerialize({
                            success: false,
                            error: 'Task stopped by user',
                            result: event.state.result || '任务已被用户停止',
                        });
                    }

                    // Status update
                    if (event.state.status) {
                        safeSend('agent-status-changed', {
                            status: event.state.status,
                        });
                    }

                    // Handle orchestrator and executor nodes
                    if (event.node === 'orchestrator') {
                        tracker.handleOrchestrator(event.state as unknown as OrchestratorAgentState);
                    }
                    if (event.node === 'executor') {
                        tracker.handleExecutor(event.state as unknown as OrchestratorAgentState);
                    }

                    // Merge state
                    finalState = finalState
                        ? ({
                              ...(finalState as object),
                              ...(event.state as object),
                          } as AgentState)
                        : (event.state as AgentState);
                }

                tracker.completePendingSteps();

                if (finalState) {
                    if (finalState.isComplete && !finalState.error) {
                        log.info('Task completed successfully');
                        safeSend('agent-task-completed', {
                            result: finalState.result,
                        });
                        return safeSerialize({
                            success: true,
                            result: finalState.result,
                        });
                    } else {
                        log.warn('Task failed:', finalState.error);
                        safeSend('agent-task-failed', {
                            error: finalState.error,
                        });
                        return safeSerialize({
                            success: false,
                            error: finalState.error,
                            result: finalState.result,
                        });
                    }
                }

                return { success: false, error: 'No final state' };
            } catch (error) {
                const errorMsg =
                    error instanceof Error ? error.message : 'Unknown error';
                log.error('Task failed with error:', errorMsg);
                safeSend('agent-task-failed', { error: errorMsg });
                return { success: false, error: errorMsg };
            }
        }
    );

    // Stop current task
    ipcMain.handle('agent-stop-task', async () => {
        try {
            const agentInstance = getAgent();
            agentInstance.stop();
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Get agent status
    ipcMain.handle('agent-get-status', async () => {
        const agentInstance = getAgent();
        return {
            status: agentInstance.isTaskRunning() ? 'running' : 'idle',
            isRunning: agentInstance.isTaskRunning(),
            currentPlan: null,
            progress: null,
        };
    });

    // Get agent state (simplified)
    ipcMain.handle('agent-get-state', async () => {
        return {
            sessionId: 'default',
            status: 'idle',
            currentTask: null,
            plan: null,
            memory: { conversation: [], workingMemory: {}, facts: [] },
            checkpoints: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
    });

    log.info('Agent IPC handlers registered');
}
