/**
 * Beads IPC Handlers
 *
 * IPC handlers for Beads task management.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import {
    createBeadsCliAdapter,
    type IBeadsClient,
} from '@chat-agent/agent-core';
import { createLogger } from './utils/logger';

const log = createLogger('BeadsHandlers');

// Beads task type for IPC handlers
interface BeadsTaskForIPC {
    id: string;
    title: string;
    priority: number;
    status: string;
    blockedBy: string[];
    blocks: string[];
    parentId?: string;
    metadata?: Record<string, unknown>;
}

// Global Beads client instance (lazy initialized)
let beadsClientInstance: IBeadsClient | null = null;

/**
 * Get or create the Beads client instance
 */
export function getBeadsClient(): IBeadsClient {
    if (!beadsClientInstance) {
        const workspacePath = process.cwd();
        beadsClientInstance = createBeadsCliAdapter(workspacePath);
    }
    return beadsClientInstance;
}

/**
 * Reset the Beads client (useful for testing or workspace changes)
 */
export function resetBeadsClient(): void {
    beadsClientInstance = null;
}

/**
 * Helper function to determine execution status
 */
function getExecutionStatus(task: BeadsTaskForIPC): string {
    if (task.status === 'closed') {
        return 'completed';
    }
    if (task.blockedBy.length > 0) {
        return 'blocked';
    }
    if (task.metadata?.inProgress === true) {
        return 'in_progress';
    }
    return 'pending';
}

/**
 * Transform a Beads task to UI format
 */
function transformTaskToUI(task: BeadsTaskForIPC) {
    return {
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        executionStatus: getExecutionStatus(task),
        blockedBy: task.blockedBy,
        blocks: task.blocks,
        parentId: task.parentId,
        isReady: task.blockedBy.length === 0 && task.status === 'open',
        isMergeable: (task.metadata?.mergeable as boolean) ?? false,
        depth: task.parentId ? 1 : 0,
        type: (task.metadata?.type as string) || 'browser_action',
    };
}

/**
 * Register all Beads-related IPC handlers
 */
export function registerBeadsHandlers(): void {
    // Get Beads tasks
    ipcMain.handle('agent-get-beads-tasks', async () => {
        try {
            const beads = getBeadsClient();
            const isInit = await beads.isInitialized();

            if (!isInit) {
                return { success: true, tasks: [], initialized: false };
            }

            const tasks = (await beads.list()) as BeadsTaskForIPC[];
            const uiTasks = tasks.map(transformTaskToUI);

            return { success: true, tasks: uiTasks, initialized: true };
        } catch (error) {
            log.error('Failed to get Beads tasks:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                tasks: [],
            };
        }
    });

    // Get Beads progress
    ipcMain.handle('agent-get-beads-progress', async () => {
        try {
            const beads = getBeadsClient();
            const isInit = await beads.isInitialized();

            if (!isInit) {
                return { success: true, progress: null, initialized: false };
            }

            const allTasks = (await beads.list()) as BeadsTaskForIPC[];
            const readyTasks = (await beads.getReady()) as BeadsTaskForIPC[];

            // Filter out epic tasks - only count child tasks for progress
            const childTasks = allTasks.filter(
                (t: BeadsTaskForIPC) => t.metadata?.isEpic !== true
            );

            const total = childTasks.length;
            const completed = childTasks.filter(
                (t: BeadsTaskForIPC) => t.status === 'closed'
            ).length;
            const blocked = childTasks.filter(
                (t: BeadsTaskForIPC) =>
                    t.status === 'open' && t.blockedBy.length > 0
            ).length;

            return {
                success: true,
                initialized: true,
                progress: {
                    total,
                    completed,
                    ready: readyTasks.length,
                    blocked,
                    pending: total - completed - blocked,
                    failed: 0,
                    percentage:
                        total > 0 ? Math.round((completed / total) * 100) : 0,
                },
            };
        } catch (error) {
            log.error('Failed to get Beads progress:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                progress: null,
            };
        }
    });

    // Get Beads plan (epic with tasks)
    ipcMain.handle('agent-get-beads-plan', async () => {
        try {
            const beads = getBeadsClient();
            const isInit = await beads.isInitialized();

            if (!isInit) {
                return { success: true, plan: null, initialized: false };
            }

            const allTasks = (await beads.list()) as BeadsTaskForIPC[];

            // Find epic (task with isEpic metadata)
            const epic = allTasks.find(
                (t: BeadsTaskForIPC) => t.metadata?.isEpic === true
            );

            if (!epic) {
                return { success: true, plan: null, initialized: true };
            }

            // Get tasks under epic
            const epicTasks = allTasks
                .filter((t: BeadsTaskForIPC) => t.parentId === epic.id)
                .sort((a: BeadsTaskForIPC, b: BeadsTaskForIPC) => {
                    const aIdx = (a.metadata?.index as number) ?? 0;
                    const bIdx = (b.metadata?.index as number) ?? 0;
                    return aIdx - bIdx;
                });

            const completedCount = epicTasks.filter(
                (t: BeadsTaskForIPC) => t.status === 'closed'
            ).length;
            const totalCount = epicTasks.length;

            const plan = {
                epicId: epic.id,
                epicTitle: epic.title,
                tasks: epicTasks.map(transformTaskToUI),
                completedCount,
                totalCount,
                percentage:
                    totalCount > 0
                        ? Math.round((completedCount / totalCount) * 100)
                        : 0,
                status: completedCount === totalCount ? 'completed' : 'active',
            };

            return { success: true, plan, initialized: true };
        } catch (error) {
            log.error('Failed to get Beads plan:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
                plan: null,
            };
        }
    });

    log.info('Beads IPC handlers registered');
}
