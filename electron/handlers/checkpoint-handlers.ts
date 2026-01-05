/**
 * Checkpoint IPC Handlers
 *
 * Handles checkpoint creation, listing, restoration, and state queries.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import type { CheckpointHistoryItem } from '@chat-agent/agent-core';
import { getAgent, log } from './shared';

/**
 * Extract user goal from a planner HumanMessage content
 * The content format is: "## Task\n{goal}\n\n## Current Page..."
 */
function extractGoalFromPlannerMessage(content: string): string | null {
    const match = content.match(/##\s*Task\s*\n([\s\S]*?)(?:\n##|\n\n##|$)/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

/**
 * Extract completion message from AI response JSON
 */
function extractCompletionFromAIMessage(content: string): string | null {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.isComplete && parsed.completionMessage) {
            return parsed.completionMessage;
        }
        if (parsed.completionMessage) {
            return parsed.completionMessage;
        }
    } catch (error) {
        log.warn('Failed to parse AI message JSON', {
            jsonSnippet: jsonMatch[0].substring(0, 200),
            error: error instanceof Error ? error.message : String(error),
        });
    }
    return null;
}

/**
 * Convert LangGraph state to UI-friendly messages
 */
function formatStateToUIMessages(
    state: Record<string, unknown>
): Array<{ id: string; role: string; content: string; timestamp: string }> {
    const uiMessages: Array<{
        id: string;
        role: string;
        content: string;
        timestamp: string;
    }> = [];
    const now = new Date().toISOString();

    const messages = state.messages as unknown[] | undefined;
    const result = state.result as string | undefined;
    const goal = state.goal as string | undefined;
    const isComplete = state.isComplete as boolean | undefined;

    log.debug('formatStateToUIMessages', {
        messageCount: messages?.length || 0,
        hasResult: !!result,
        hasGoal: !!goal,
        isComplete,
    });

    const seenGoals = new Set<string>();

    if (messages && Array.isArray(messages)) {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i] as Record<string, unknown>;
            if (!msg) continue;

            // Detect message type
            let isHuman = false;
            if (typeof (msg as any)._getType === 'function') {
                isHuman = (msg as any)._getType() === 'human';
            } else if (msg.type === 'human' || msg._type === 'human') {
                isHuman = true;
            } else if (msg.lc_id && Array.isArray(msg.lc_id)) {
                isHuman = (msg.lc_id as string[]).some((s) =>
                    s.includes('HumanMessage')
                );
            } else if (typeof msg.id === 'string') {
                isHuman = (msg.id as string).includes('HumanMessage');
            }

            const content = (msg.content ??
                (msg.lc_kwargs as any)?.content ??
                '') as string;

            if (isHuman) {
                const extractedGoal = extractGoalFromPlannerMessage(content);
                if (extractedGoal && !seenGoals.has(extractedGoal)) {
                    seenGoals.add(extractedGoal);
                    uiMessages.push({
                        id: (msg.id as string) || `user_${i}`,
                        role: 'user',
                        content: extractedGoal,
                        timestamp: now,
                    });
                }
            } else {
                const completion = extractCompletionFromAIMessage(content);
                if (completion) {
                    uiMessages.push({
                        id: (msg.id as string) || `agent_${i}`,
                        role: 'assistant',
                        content: completion,
                        timestamp: now,
                    });
                }
            }
        }
    }

    // Fallback to goal/result from state
    if (uiMessages.length === 0 && goal) {
        uiMessages.push({
            id: 'user_goal',
            role: 'user',
            content: goal,
            timestamp: now,
        });

        if (result) {
            uiMessages.push({
                id: 'agent_result',
                role: 'assistant',
                content: result,
                timestamp: now,
            });
        }
    }

    // Add final result if not captured
    if (result && isComplete) {
        const lastMsg = uiMessages[uiMessages.length - 1];
        if (
            !lastMsg ||
            lastMsg.role !== 'assistant' ||
            lastMsg.content !== result
        ) {
            const hasResult = uiMessages.some(
                (m) => m.role === 'assistant' && m.content === result
            );
            if (!hasResult) {
                uiMessages.push({
                    id: 'final_result',
                    role: 'assistant',
                    content: result,
                    timestamp: now,
                });
            }
        }
    }

    log.debug('formatStateToUIMessages result', {
        extractedCount: uiMessages.length,
        userMessages: uiMessages.filter((m) => m.role === 'user').length,
        agentMessages: uiMessages.filter((m) => m.role === 'assistant').length,
    });

    return uiMessages;
}

/**
 * Register checkpoint IPC handlers
 */
export function registerCheckpointHandlers(): void {
    // Create checkpoint (API compatibility)
    ipcMain.handle(
        'agent-create-checkpoint',
        async (_event, _name: string, _description?: string) => {
            return { success: true, checkpointId: `checkpoint_${Date.now()}` };
        }
    );

    // List checkpoints
    ipcMain.handle('agent-list-checkpoints', async (_event, threadId?: string) => {
        try {
            const agentInstance = getAgent();
            const currentThreadId = threadId || agentInstance.getCurrentThreadId();

            if (!currentThreadId) {
                return [];
            }

            const history = await agentInstance.getCheckpointHistory(currentThreadId);
            return history.map((h: CheckpointHistoryItem) => ({
                id: h.checkpointId,
                threadId: h.threadId,
                createdAt: h.createdAt,
                step: h.step,
                messagePreview: h.messagePreview,
                isUserMessage: h.isUserMessage,
                parentCheckpointId: h.parentCheckpointId,
            }));
        } catch (error) {
            log.warn('Failed to list checkpoints:', error);
            return [];
        }
    });

    // Get checkpoint history
    ipcMain.handle(
        'agent-get-checkpoint-history',
        async (_event, threadId: string) => {
            try {
                const agentInstance = getAgent();
                const history = await agentInstance.getCheckpointHistory(threadId);
                return history.map((h: CheckpointHistoryItem) => ({
                    id: h.checkpointId,
                    threadId: h.threadId,
                    createdAt: h.createdAt,
                    step: h.step,
                    messagePreview: h.messagePreview,
                    isUserMessage: h.isUserMessage,
                    parentCheckpointId: h.parentCheckpointId,
                    metadata: h.metadata,
                }));
            } catch (error) {
                log.warn('Failed to get checkpoint history:', error);
                return [];
            }
        }
    );

    // Restore checkpoint
    ipcMain.handle(
        'agent-restore-checkpoint',
        async (_event, threadId: string, checkpointId: string) => {
            try {
                const agentInstance = getAgent();
                const state = await agentInstance.restoreToCheckpoint(
                    threadId,
                    checkpointId
                );

                if (state) {
                    log.info('Restored to checkpoint', { threadId, checkpointId });
                    const formattedMessages = formatStateToUIMessages(
                        state as Record<string, unknown>
                    );

                    return {
                        success: true,
                        state: {
                            messages: formattedMessages,
                            goal: state.goal,
                            status: state.status,
                            isComplete: state.isComplete,
                        },
                    };
                }

                return { success: false, error: 'Checkpoint not found' };
            } catch (error) {
                log.error('Failed to restore checkpoint:', error);
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
    );

    // Get state at checkpoint
    ipcMain.handle(
        'agent-get-state-at-checkpoint',
        async (_event, threadId: string, checkpointId: string) => {
            try {
                const agentInstance = getAgent();
                const state = await agentInstance.getStateAtCheckpoint(
                    threadId,
                    checkpointId
                );

                if (state) {
                    const formattedMessages = formatStateToUIMessages(
                        state as Record<string, unknown>
                    );

                    return {
                        messages: formattedMessages,
                        goal: state.goal,
                        status: state.status,
                        isComplete: state.isComplete,
                        actionHistory: state.actionHistory,
                    };
                }

                return null;
            } catch (error) {
                log.warn('Failed to get state at checkpoint:', error);
                return null;
            }
        }
    );

    // Restore latest
    ipcMain.handle('agent-restore-latest', async (_event, threadId?: string) => {
        try {
            const agentInstance = getAgent();
            const targetThreadId = threadId || agentInstance.getCurrentThreadId();

            if (!targetThreadId) {
                return { success: false, error: 'No thread ID provided' };
            }

            const state = await agentInstance.loadSessionState(targetThreadId);

            if (state) {
                const formattedMessages = formatStateToUIMessages(
                    state as Record<string, unknown>
                );

                return {
                    success: true,
                    state: {
                        messages: formattedMessages,
                        goal: state.goal,
                        status: state.status,
                    },
                };
            }

            return { success: true, state: null };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Delete checkpoint (not directly supported)
    ipcMain.handle('agent-delete-checkpoint', async (_event, _checkpointId: string) => {
        log.info(
            'Checkpoint deletion requested (not supported with LangGraph SqliteSaver)'
        );
        return true;
    });

    log.info('Checkpoint IPC handlers registered');
}

// Export formatStateToUIMessages for use by other handlers
export { formatStateToUIMessages };

