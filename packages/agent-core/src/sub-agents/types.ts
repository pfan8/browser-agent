/**
 * Sub-Agent Types
 *
 * Defines the interface for sub-agents that can be used by the Router
 * to execute different types of tasks. This enables extensibility
 * for adding new capabilities like translation, script export, etc.
 */

import type { BeadsTask } from '../beads/types';
import type { AgentState } from '../state';

/**
 * Task types that can be handled by sub-agents
 */
export type SubAgentTaskType =
    | 'browser_action'
    | 'query'
    | 'translate'
    | 'export'
    | 'unknown';

/**
 * Context provided to sub-agents during execution
 */
export interface SubAgentContext {
    /** Current agent state */
    state: AgentState;
    /** Execution variables from previous steps */
    variables: Record<string, unknown>;
    /** Trace context for logging */
    traceId?: string;
}

/**
 * Task passed to a sub-agent for execution
 */
export interface SubAgentTask {
    /** The Beads tasks to execute (may be merged) */
    tasks: BeadsTask[];
    /** Combined instruction for execution */
    instruction: string;
    /** Task type */
    type: SubAgentTaskType;
    /** Whether these tasks were merged */
    isMerged: boolean;
    /** Original task IDs before merging */
    originalTaskIds: string[];
}

/**
 * Result returned by a sub-agent after execution
 */
export interface SubAgentResult {
    /** Whether execution succeeded */
    success: boolean;
    /** IDs of tasks that were completed */
    completedTaskIds: string[];
    /** IDs of tasks that failed */
    failedTaskIds: string[];
    /** Result data (if any) */
    result?: unknown;
    /** Error message (if failed) */
    error?: string;
    /** Execution summary for logging */
    summary: string;
    /** Updated variables after execution */
    updatedVariables?: Record<string, unknown>;
}

/**
 * Interface that all sub-agents must implement
 */
export interface ISubAgent {
    /** Unique name of this sub-agent */
    readonly name: string;

    /** Task types this sub-agent can handle */
    readonly supportedTypes: SubAgentTaskType[];

    /**
     * Check if this sub-agent can handle a specific task
     */
    canHandle(task: BeadsTask): boolean;

    /**
     * Execute the given task(s)
     */
    execute(
        task: SubAgentTask,
        context: SubAgentContext
    ): Promise<SubAgentResult>;

    /**
     * Get estimated execution time (for planning)
     */
    estimateTime?(task: SubAgentTask): number;
}

/**
 * Registry for managing sub-agents
 */
export interface ISubAgentRegistry {
    /**
     * Register a sub-agent
     */
    register(agent: ISubAgent): void;

    /**
     * Get all registered sub-agents
     */
    getAll(): ISubAgent[];

    /**
     * Find a sub-agent that can handle the given task
     */
    findForTask(task: BeadsTask): ISubAgent | null;

    /**
     * Find a sub-agent by name
     */
    findByName(name: string): ISubAgent | null;
}

/**
 * Configuration for sub-agent behavior
 */
export interface SubAgentConfig {
    /** Maximum execution time per task (ms) */
    maxExecutionTime: number;
    /** Whether to retry on failure */
    retryOnFailure: boolean;
    /** Maximum retry attempts */
    maxRetries: number;
}

/**
 * Default sub-agent configuration
 */
export const DEFAULT_SUBAGENT_CONFIG: SubAgentConfig = {
    maxExecutionTime: 60000,
    retryOnFailure: true,
    maxRetries: 2,
};

