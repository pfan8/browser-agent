/**
 * Session IPC Handlers
 *
 * Handles session management: create, load, list, delete sessions.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import type { ThreadMetadata } from '@chat-agent/agent-core';
import { getAgent, log } from './shared';

/**
 * Register session IPC handlers
 */
export function registerSessionHandlers(): void {
    // Create session
    ipcMain.handle(
        'agent-create-session',
        async (_event, name: string, description?: string) => {
            try {
                const agentInstance = getAgent();
                const session = agentInstance.createSession(name, description);
                if (session) {
                    return {
                        success: true,
                        session: {
                            id: session.threadId,
                            name: session.name || name,
                            description: session.description,
                            createdAt: session.createdAt,
                        },
                    };
                }
                // Fallback if no SQLite checkpointer
                const sessionId = `session_${Date.now()}`;
                return {
                    success: true,
                    session: { id: sessionId, name },
                };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
    );

    // Load session
    ipcMain.handle('agent-load-session', async (_event, sessionId: string) => {
        try {
            const agentInstance = getAgent();

            // Set current thread ID to the loaded session
            (agentInstance as any).setCurrentThreadId?.(sessionId);

            // Reset session state to clear temporary caches
            (agentInstance as any).resetSessionState?.();

            const state = await agentInstance.loadSessionState(sessionId);
            if (state) {
                log.info('Session loaded and activated', {
                    sessionId,
                    messageCount: state.messages?.length || 0,
                });
                return { success: true, hasState: true };
            }
            return { success: true, hasState: false };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    // List sessions
    ipcMain.handle('agent-list-sessions', async () => {
        try {
            const agentInstance = getAgent();
            const sessions = agentInstance.listSessions();
            return sessions.map((s: ThreadMetadata) => ({
                id: s.threadId,
                name: s.name || `Session ${s.threadId.substring(0, 8)}`,
                description: s.description,
                messageCount: s.messageCount,
                createdAt: s.createdAt,
                updatedAt: s.updatedAt,
            }));
        } catch (error) {
            log.warn('Failed to list sessions:', error);
            return [];
        }
    });

    // Delete session
    ipcMain.handle('agent-delete-session', async (_event, sessionId: string) => {
        try {
            const agentInstance = getAgent();
            return agentInstance.deleteSession(sessionId);
        } catch (error) {
            log.warn('Failed to delete session:', error);
            return false;
        }
    });

    // Get current session
    ipcMain.handle('agent-get-current-session', async () => {
        const agentInstance = getAgent();
        return agentInstance.getCurrentThreadId();
    });

    log.info('Session IPC handlers registered');
}

