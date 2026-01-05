/**
 * Agent IPC Handlers
 *
 * Handles agent task execution, stopping, and status queries.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import type { AgentState } from '@chat-agent/agent-core';
import { getAgent, safeSend, safeSerialize, log } from './shared';

/**
 * Track and emit agent step events
 */
function createStepTracker() {
    let stepCounter = 0;
    const stepStartTimes = new Map<string, number>();
    let lastActionCount = 0;
    let lastObservationTimestamp = '';
    let pendingPlannerStepId: string | null = null;
    let pendingCodeActStepId: string | null = null;
    let lastPlannerThought = '';
    let lastInstruction = '';

    return {
        nextStepId: (node: string) => `step-${++stepCounter}-${node}`,
        startStep: (stepId: string) => stepStartTimes.set(stepId, Date.now()),
        getDuration: (stepId: string) =>
            Date.now() - (stepStartTimes.get(stepId) || Date.now()),

        handleObserve: (state: AgentState) => {
            const obs = state.observation;
            if (!obs || obs.timestamp === lastObservationTimestamp) return;

            lastObservationTimestamp = obs.timestamp;
            const stepId = `step-${++stepCounter}-observe`;

            safeSend('agent-step-started', {
                step: { id: stepId, description: '正在观察页面状态...' },
                node: 'observe',
                observation: { url: obs.url, title: obs.title },
            });

            safeSend('agent-step-completed', {
                step: {
                    id: stepId,
                    description: `📍 ${obs.title || obs.url}`.substring(0, 60),
                },
                node: 'observe',
                duration: 100,
                observation: { url: obs.url, title: obs.title },
            });
        },

        handlePlanner: (state: AgentState) => {
            const plannerState = state as unknown as {
                plannerThought?: string;
                currentInstruction?: string;
            };

            // Complete pending planner step if any
            if (pendingPlannerStepId) {
                safeSend('agent-step-completed', {
                    step: {
                        id: pendingPlannerStepId,
                        description: lastPlannerThought || '分析完成',
                    },
                    node: 'planner',
                    duration: stepStartTimes.get(pendingPlannerStepId)
                        ? Date.now() - stepStartTimes.get(pendingPlannerStepId)!
                        : 100,
                    thought: lastPlannerThought,
                    instruction: lastInstruction,
                });
                pendingPlannerStepId = null;
            }

            // Start new planner step if instruction changed
            if (
                plannerState.currentInstruction &&
                plannerState.currentInstruction !== lastInstruction
            ) {
                lastInstruction = plannerState.currentInstruction;
                lastPlannerThought = plannerState.plannerThought || '';

                const stepId = `step-${++stepCounter}-planner`;
                stepStartTimes.set(stepId, Date.now());
                pendingPlannerStepId = stepId;

                safeSend('agent-step-started', {
                    step: { id: stepId, description: '🧠 正在思考...' },
                    node: 'planner',
                });

                if (lastPlannerThought) {
                    safeSend('agent-thinking-update', {
                        stepId,
                        thought: lastPlannerThought,
                        instruction: lastInstruction,
                    });
                }
            }
        },

        handleCodeAct: (state: AgentState) => {
            // Complete pending planner step first
            if (pendingPlannerStepId) {
                const duration = stepStartTimes.get(pendingPlannerStepId)
                    ? Date.now() - stepStartTimes.get(pendingPlannerStepId)!
                    : 100;
                safeSend('agent-step-completed', {
                    step: {
                        id: pendingPlannerStepId,
                        description: lastPlannerThought
                            ? `💭 ${lastPlannerThought.substring(0, 50)}${lastPlannerThought.length > 50 ? '...' : ''}`
                            : '分析完成',
                    },
                    node: 'planner',
                    duration: Math.max(duration, 100),
                    thought: lastPlannerThought,
                    instruction: lastInstruction,
                });
                pendingPlannerStepId = null;
            }

            const currentActionCount = state.actionHistory?.length || 0;

            // Handle new action
            if (currentActionCount > lastActionCount) {
                const newAction = state.actionHistory![currentActionCount - 1];
                if (newAction) {
                    // Complete pending codeact step
                    if (pendingCodeActStepId) {
                        const duration = stepStartTimes.get(pendingCodeActStepId)
                            ? Date.now() - stepStartTimes.get(pendingCodeActStepId)!
                            : 100;
                        const prevAction = state.actionHistory![currentActionCount - 2];
                        emitCodeActCompletion(pendingCodeActStepId, prevAction, duration);
                        pendingCodeActStepId = null;
                    }

                    // Start new codeact step
                    const stepId = `step-${++stepCounter}-codeact`;
                    stepStartTimes.set(stepId, Date.now());
                    pendingCodeActStepId = stepId;

                    const codeSnippet = (newAction.args?.code as string) || '';
                    const instruction =
                        (newAction.args?.instruction as string) ||
                        newAction.reasoning ||
                        '';

                    safeSend('agent-step-started', {
                        step: {
                            id: stepId,
                            description: `⚡ ${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}`,
                            tool: 'codeact',
                        },
                        node: 'codeact',
                        action: { instruction, thought: newAction.thought },
                    });

                    if (codeSnippet) {
                        safeSend('agent-code-update', {
                            stepId,
                            code: codeSnippet,
                            instruction,
                        });
                    }

                    lastActionCount = currentActionCount;
                }
            }

            // Check if last action completed
            if (state.actionHistory?.length) {
                const lastAction =
                    state.actionHistory[state.actionHistory.length - 1];
                if (lastAction.result && pendingCodeActStepId) {
                    const duration = stepStartTimes.get(pendingCodeActStepId)
                        ? Date.now() - stepStartTimes.get(pendingCodeActStepId)!
                        : 100;
                    emitCodeActCompletion(pendingCodeActStepId, lastAction, duration);
                    pendingCodeActStepId = null;
                }
            }
        },

        completePendingSteps: () => {
            if (pendingPlannerStepId) {
                safeSend('agent-step-completed', {
                    step: { id: pendingPlannerStepId, description: '分析完成' },
                    node: 'planner',
                    duration: stepStartTimes.get(pendingPlannerStepId)
                        ? Date.now() - stepStartTimes.get(pendingPlannerStepId)!
                        : 100,
                });
            }
            if (pendingCodeActStepId) {
                safeSend('agent-step-completed', {
                    step: { id: pendingCodeActStepId, description: '执行完成' },
                    node: 'codeact',
                    duration: stepStartTimes.get(pendingCodeActStepId)
                        ? Date.now() - stepStartTimes.get(pendingCodeActStepId)!
                        : 100,
                });
            }
        },
    };
}

/**
 * Emit codeact completion event
 */
function emitCodeActCompletion(
    stepId: string,
    action: { result?: { success?: boolean; error?: string }; reasoning?: string } | undefined,
    duration: number
) {
    if (!action) return;

    if (action.result?.success) {
        safeSend('agent-step-completed', {
            step: {
                id: stepId,
                description: `✅ ${action.reasoning?.substring(0, 40) || '执行成功'}`,
            },
            node: 'codeact',
            action,
            duration,
        });
    } else {
        safeSend('agent-step-failed', {
            step: {
                id: stepId,
                description: `❌ ${action.reasoning?.substring(0, 40) || '执行失败'}`,
                tool: 'codeact',
            },
            node: 'codeact',
            action,
            error: action.result?.error || 'Unknown error',
            duration,
        });
    }
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
                `Executing task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`,
                { threadId: options?.threadId, continueSession: options?.continueSession }
            );

            try {
                const agentInstance = getAgent();
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
                        safeSend('agent-task-stopped', { message: '任务已被用户停止' });
                        return safeSerialize({
                            success: false,
                            error: 'Task stopped by user',
                            result: event.state.result || '任务已被用户停止',
                        });
                    }

                    // Status update
                    if (event.state.status) {
                        safeSend('agent-status-changed', { status: event.state.status });
                    }

                    // Track node events
                    if (event.node === 'observe' && event.state.observation) {
                        tracker.handleObserve(event.state as AgentState);
                    }
                    if (event.node === 'planner') {
                        tracker.handlePlanner(event.state as AgentState);
                    }
                    if (event.node === 'codeact') {
                        tracker.handleCodeAct(event.state as AgentState);
                    }

                    // Merge state
                    finalState = finalState
                        ? { ...(finalState as object), ...(event.state as object) } as AgentState
                        : event.state as AgentState;
                }

                tracker.completePendingSteps();

                if (finalState) {
                    if (finalState.isComplete && !finalState.error) {
                        log.info('Task completed successfully');
                        safeSend('agent-task-completed', { result: finalState.result });
                        return safeSerialize({ success: true, result: finalState.result });
                    } else {
                        log.warn('Task failed:', finalState.error);
                        safeSend('agent-task-failed', { error: finalState.error });
                        return safeSerialize({
                            success: false,
                            error: finalState.error,
                            result: finalState.result,
                        });
                    }
                }

                return { success: false, error: 'No final state' };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
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

