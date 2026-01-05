/**
 * Beads Types
 *
 * Type definitions for Beads task management system.
 * Beads is a distributed, git-backed graph issue tracker for AI agents.
 * @see https://github.com/steveyegge/beads
 */

/**
 * Task status in Beads
 */
export type BeadsTaskStatus = 'open' | 'closed';

/**
 * Task priority levels (P0 = highest)
 */
export type BeadsPriority = 0 | 1 | 2 | 3;

/**
 * Dependency relationship types
 */
export type BeadsDependencyType = 'blocks' | 'related' | 'parent';

/**
 * A Beads task (issue)
 */
export interface BeadsTask {
    /** Unique task ID, e.g., "bd-a3f8" or "bd-a3f8.1" for subtasks */
    id: string;
    /** Task title/description */
    title: string;
    /** Priority level (0 = P0, highest) */
    priority: BeadsPriority;
    /** Current status */
    status: BeadsTaskStatus;
    /** IDs of tasks that block this one */
    blockedBy: string[];
    /** IDs of tasks this one blocks */
    blocks: string[];
    /** Parent task ID (for hierarchical tasks) */
    parentId?: string;
    /** Child task IDs */
    children: string[];
    /** Creation timestamp */
    createdAt: string;
    /** Last update timestamp */
    updatedAt: string;
    /** Custom metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Options for creating a new task
 */
export interface CreateTaskOptions {
    /** Priority level (default: 1) */
    priority?: BeadsPriority;
    /** Parent task ID for creating subtasks */
    parentId?: string;
    /** IDs of tasks this one is blocked by */
    blockedBy?: string[];
    /** Custom metadata */
    metadata?: Record<string, unknown>;
}

/**
 * Options for listing tasks
 */
export interface ListTasksFilter {
    /** Filter by status */
    status?: BeadsTaskStatus;
    /** Filter by parent ID (get subtasks) */
    parentId?: string;
    /** Only show ready tasks (no open blockers) */
    ready?: boolean;
    /** Limit number of results */
    limit?: number;
}

/**
 * Result of a Beads operation
 */
export interface BeadsOperationResult {
    success: boolean;
    error?: string;
}

/**
 * Epic with its tasks (UI representation)
 */
export interface BeadsEpic {
    /** Epic task ID */
    id: string;
    /** Epic title */
    title: string;
    /** All tasks under this epic */
    tasks: BeadsTask[];
    /** Number of completed tasks */
    completedCount: number;
    /** Total number of tasks */
    totalCount: number;
}

/**
 * Task for UI display with additional computed fields
 */
export interface BeadsTaskUI extends BeadsTask {
    /** Whether this task is ready (no open blockers) */
    isReady: boolean;
    /** Whether this task can be merged with adjacent tasks */
    isMergeable: boolean;
    /** Execution status for UI (extends base status) */
    executionStatus: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
    /** Depth level in hierarchy (0 = epic, 1 = task, 2 = subtask) */
    depth: number;
}

/**
 * Plan structure for Planner output
 */
export interface BeadsPlannerOutput {
    /** Epic title/goal */
    epic: string;
    /** List of tasks to create */
    tasks: BeadsPlannerTask[];
    /** Hint about which tasks can be merged */
    mergeHint?: string;
}

/**
 * Task in Planner output (before creation in Beads)
 */
export interface BeadsPlannerTask {
    /** Task title */
    title: string;
    /** Whether this task can be merged with adjacent ones */
    mergeable: boolean;
    /** Indices of tasks this one is blocked by (0-based) */
    blockedBy?: number[];
    /** Task type for routing */
    type?: 'browser_action' | 'query' | 'translate' | 'export';
}

