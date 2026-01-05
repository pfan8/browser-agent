/**
 * Beads Types for UI
 *
 * Shared type definitions for Beads task management in the Electron UI.
 * These types mirror the agent-core types but are designed for the renderer.
 */

/**
 * Task status in Beads
 */
export type BeadsTaskStatus = 'open' | 'closed';

/**
 * Execution status for UI display (extends base status)
 */
export type BeadsExecutionStatus =
    | 'pending'
    | 'in_progress'
    | 'completed'
    | 'failed'
    | 'blocked';

/**
 * Task type for routing
 */
export type BeadsTaskType =
    | 'browser_action'
    | 'query'
    | 'translate'
    | 'export'
    | 'unknown';

/**
 * A Beads task for UI display
 */
export interface BeadsTaskUI {
    /** Unique task ID, e.g., "bd-a3f8" or "bd-a3f8.1" for subtasks */
    id: string;
    /** Task title/description */
    title: string;
    /** Priority level (0 = P0, highest) */
    priority: number;
    /** Current status */
    status: BeadsTaskStatus;
    /** Execution status for UI */
    executionStatus: BeadsExecutionStatus;
    /** IDs of tasks that block this one */
    blockedBy: string[];
    /** IDs of tasks this one blocks */
    blocks: string[];
    /** Parent task ID (for hierarchical tasks) */
    parentId?: string;
    /** Whether this task is ready (no open blockers) */
    isReady: boolean;
    /** Whether this task can be merged with adjacent tasks */
    isMergeable: boolean;
    /** Depth level in hierarchy (0 = epic, 1 = task, 2 = subtask) */
    depth: number;
    /** Task type */
    type: BeadsTaskType;
    /** Result message (if completed) */
    result?: string;
    /** Error message (if failed) */
    error?: string;
}

/**
 * Epic (top-level task group) for UI
 */
export interface BeadsPlanUI {
    /** Epic task ID */
    epicId: string;
    /** Epic title */
    epicTitle: string;
    /** All tasks under this epic */
    tasks: BeadsTaskUI[];
    /** Number of completed tasks */
    completedCount: number;
    /** Total number of tasks (excluding epic itself) */
    totalCount: number;
    /** Completion percentage */
    percentage: number;
    /** Status of the epic */
    status: 'active' | 'completed' | 'failed';
}

/**
 * Progress information for display
 */
export interface BeadsProgressUI {
    /** Total number of tasks */
    total: number;
    /** Completed tasks */
    completed: number;
    /** Failed tasks */
    failed: number;
    /** Pending tasks */
    pending: number;
    /** Ready tasks (can be executed now) */
    ready: number;
    /** Blocked tasks */
    blocked: number;
    /** Completion percentage */
    percentage: number;
}

/**
 * Merge group for visual display
 */
export interface BeadsMergeGroup {
    /** Start index in task list */
    startIndex: number;
    /** End index in task list */
    endIndex: number;
    /** Task IDs in this group */
    taskIds: string[];
}

/**
 * Transform raw Beads tasks to UI format
 */
export function transformToBeadsPlanUI(
    epicId: string,
    epicTitle: string,
    tasks: BeadsTaskUI[]
): BeadsPlanUI {
    const completedCount = tasks.filter(
        (t) => t.executionStatus === 'completed'
    ).length;
    const totalCount = tasks.length;
    const failedCount = tasks.filter(
        (t) => t.executionStatus === 'failed'
    ).length;

    return {
        epicId,
        epicTitle,
        tasks,
        completedCount,
        totalCount,
        percentage:
            totalCount > 0
                ? Math.round((completedCount / totalCount) * 100)
                : 0,
        status:
            completedCount === totalCount
                ? 'completed'
                : failedCount > 0
                ? 'failed'
                : 'active',
    };
}

/**
 * Calculate progress from task list
 *
 * Note: ready and pending are mutually exclusive counts:
 * - ready: open tasks with no blockers (can execute now)
 * - pending: open tasks that are NOT ready (waiting but not blocked by dependency)
 */
export function calculateBeadsProgress(tasks: BeadsTaskUI[]): BeadsProgressUI {
    const total = tasks.length;
    const completed = tasks.filter(
        (t) => t.executionStatus === 'completed'
    ).length;
    const failed = tasks.filter((t) => t.executionStatus === 'failed').length;
    const blocked = tasks.filter((t) => t.executionStatus === 'blocked').length;
    const inProgress = tasks.filter(
        (t) => t.executionStatus === 'in_progress'
    ).length;

    // Ready tasks: open and have no blockers (can execute now)
    const ready = tasks.filter((t) => t.isReady && t.status === 'open').length;

    // Pending tasks: have 'pending' executionStatus but are NOT ready
    // (this avoids double-counting ready tasks)
    const pendingNotReady = tasks.filter(
        (t) => t.executionStatus === 'pending' && !t.isReady
    ).length;

    return {
        total,
        completed,
        failed,
        pending: pendingNotReady + inProgress,
        ready,
        blocked,
        percentage: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
}

/**
 * Find merge groups in task list
 */
export function findMergeGroups(tasks: BeadsTaskUI[]): BeadsMergeGroup[] {
    const groups: BeadsMergeGroup[] = [];
    let groupStart: number | null = null;
    let groupIds: string[] = [];

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (task.isMergeable) {
            if (groupStart === null) {
                groupStart = i;
                groupIds = [task.id];
            } else {
                groupIds.push(task.id);
            }
        } else {
            if (groupStart !== null && groupIds.length > 1) {
                groups.push({
                    startIndex: groupStart,
                    endIndex: i - 1,
                    taskIds: groupIds,
                });
            }
            groupStart = null;
            groupIds = [];
        }
    }

    // Handle group at end
    if (groupStart !== null && groupIds.length > 1) {
        groups.push({
            startIndex: groupStart,
            endIndex: tasks.length - 1,
            taskIds: groupIds,
        });
    }

    return groups;
}
