/**
 * Beads Client Interface
 *
 * Abstract interface for interacting with Beads task management system.
 * Implementations can use CLI, API, or in-memory storage.
 */

import type {
    BeadsTask,
    CreateTaskOptions,
    ListTasksFilter,
    BeadsOperationResult,
} from './types';

/**
 * Interface for Beads client implementations
 */
export interface IBeadsClient {
    /**
     * Initialize Beads in the workspace
     * Equivalent to: bd init
     */
    init(): Promise<BeadsOperationResult>;

    /**
     * Create a new task
     * Equivalent to: bd create "title" -p <priority>
     */
    create(title: string, options?: CreateTaskOptions): Promise<BeadsTask>;

    /**
     * Add a dependency between tasks
     * Equivalent to: bd dep add <blockerId> <blockedId> --type blocks
     *
     * @param blockerId - The task that blocks/is a prerequisite
     * @param blockedId - The task that is blocked/depends on blockerId
     * @param type - Dependency type ('blocks' creates: blockerId blocks blockedId)
     */
    addDependency(
        blockerId: string,
        blockedId: string,
        type?: 'blocks' | 'related' | 'parent'
    ): Promise<BeadsOperationResult>;

    /**
     * Remove a dependency between tasks
     * Equivalent to: bd dep remove <dependentId> <dependencyId>
     *
     * @param dependentId - The task that depends on another
     * @param dependencyId - The task that is depended upon
     */
    removeDependency(
        dependentId: string,
        dependencyId: string
    ): Promise<BeadsOperationResult>;

    /**
     * Get all ready tasks (no open blockers)
     * Equivalent to: bd ready --json
     */
    getReady(): Promise<BeadsTask[]>;

    /**
     * Close/complete a task
     * Equivalent to: bd close <id>
     */
    close(id: string, result?: string): Promise<BeadsOperationResult>;

    /**
     * Get task details
     * Equivalent to: bd show <id> --json
     */
    show(id: string): Promise<BeadsTask | null>;

    /**
     * List tasks with optional filtering
     * Equivalent to: bd list --json
     */
    list(filter?: ListTasksFilter): Promise<BeadsTask[]>;

    /**
     * Update task metadata or status
     */
    update(
        id: string,
        updates: Partial<Pick<BeadsTask, 'title' | 'priority' | 'metadata'>>
    ): Promise<BeadsOperationResult>;

    /**
     * Check if Beads is initialized in the workspace
     */
    isInitialized(): Promise<boolean>;
}

/**
 * Factory function type for creating Beads clients
 */
export type BeadsClientFactory = (workspacePath: string) => IBeadsClient;
