/**
 * Memory & History IPC Handlers
 *
 * Handles memory management, conversation history, and fact storage.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import { getAgent, log } from './shared';
import { formatStateToUIMessages } from './checkpoint-handlers';

// Need access to PersistentCheckpointer - import via shared module or pass as context
let getPersistentCheckpointer: (() => any) | null = null;

/**
 * Initialize memory handlers with checkpointer access
 */
export function initMemoryHandlerContext(context: {
    getPersistentCheckpointer: () => any;
}): void {
    getPersistentCheckpointer = context.getPersistentCheckpointer;
}

/**
 * Register memory & history IPC handlers
 */
export function registerMemoryHandlers(): void {
    // Get conversation
    ipcMain.handle(
        'agent-get-conversation',
        async (_event, sessionIdOrLimit?: string | number, limit?: number) => {
            try {
                const agentInstance = getAgent();

                let sessionId: string | undefined;
                let messageLimit: number | undefined;

                if (typeof sessionIdOrLimit === 'string') {
                    sessionId = sessionIdOrLimit;
                    messageLimit = limit;
                } else if (typeof sessionIdOrLimit === 'number') {
                    messageLimit = sessionIdOrLimit;
                }

                if (sessionId) {
                    const state = await agentInstance.loadSessionState(sessionId);
                    const hasMessages =
                        state &&
                        state.messages &&
                        Array.isArray(state.messages) &&
                        state.messages.length > 0;

                    if (hasMessages) {
                        const messages = formatStateToUIMessages(
                            state as Record<string, unknown>
                        );

                        if (messageLimit && messageLimit > 0) {
                            return messages.slice(-messageLimit);
                        }
                        return messages;
                    } else if (getPersistentCheckpointer) {
                        const checkpointer = getPersistentCheckpointer();
                        const isFallback = checkpointer.isUsingFallback();
                        checkpointer.updateThreadActivity(sessionId, 0);
                        log.info(
                            'Synced thread metadata - checkpoint data was empty',
                            { sessionId, isFallbackMode: isFallback }
                        );
                    }
                }

                return [];
            } catch (error) {
                log.error('Failed to get conversation', { error });
                return [];
            }
        }
    );

    // Clear memory
    ipcMain.handle('agent-clear-memory', async () => {
        try {
            const agentInstance = getAgent();
            const memoryManager = agentInstance.getMemoryManager();
            if (memoryManager) {
                await memoryManager.runCleanup();
            }
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // Get memory summary
    ipcMain.handle('agent-get-memory-summary', async () => {
        try {
            const agentInstance = getAgent();
            const memoryManager = agentInstance.getMemoryManager();
            if (memoryManager) {
                const stats = await memoryManager.getStats();
                return `Total memories: ${stats.totalMemories}, Tasks: ${
                    stats.byNamespace.task_summary || 0
                }, Facts: ${stats.byNamespace.facts || 0}`;
            }
            return 'Memory not configured';
        } catch (error) {
            return 'Error getting memory summary';
        }
    });

    // Get memory stats
    ipcMain.handle('agent-get-memory-stats', async () => {
        try {
            const agentInstance = getAgent();
            const memoryManager = agentInstance.getMemoryManager();
            if (memoryManager) {
                return await memoryManager.getStats();
            }
            return null;
        } catch (error) {
            log.warn('Failed to get memory stats:', error);
            return null;
        }
    });

    // Get recent tasks
    ipcMain.handle('agent-get-recent-tasks', async (_event, limit: number = 10) => {
        try {
            const agentInstance = getAgent();
            const memoryManager = agentInstance.getMemoryManager();
            if (memoryManager) {
                const tasks = await memoryManager.getRecentTasks(limit);
                return tasks;
            }
            return [];
        } catch (error) {
            log.warn('Failed to get recent tasks:', error);
            return [];
        }
    });

    // Save fact
    ipcMain.handle(
        'agent-save-fact',
        async (_event, fact: { content: string; category?: string }) => {
            try {
                const agentInstance = getAgent();
                const memoryManager = agentInstance.getMemoryManager();
                if (memoryManager) {
                    await memoryManager.saveFact({
                        content: fact.content,
                        category: fact.category,
                        source: 'user',
                        confidence: 1.0,
                    });
                    return { success: true };
                }
                return { success: false, error: 'Memory not configured' };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
    );

    // Get facts
    ipcMain.handle('agent-get-facts', async (_event, category?: string) => {
        try {
            const agentInstance = getAgent();
            const memoryManager = agentInstance.getMemoryManager();
            if (memoryManager) {
                return await memoryManager.getFacts({ category });
            }
            return [];
        } catch (error) {
            log.warn('Failed to get facts:', error);
            return [];
        }
    });

    log.info('Memory IPC handlers registered');
}

