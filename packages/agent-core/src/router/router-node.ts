/**
 * Router Node
 *
 * LangGraph node that routes tasks to appropriate sub-agents.
 * Uses Beads to get ready tasks and dispatches them for execution.
 */

import type { AgentState } from '../state';
import type { TraceContext } from '../tracing';
import type { IBeadsClient, BeadsTask } from '../beads';
import type {
    ISubAgent,
    ISubAgentRegistry,
    SubAgentTask,
    SubAgentContext,
    SubAgentResult,
    SubAgentTaskType,
} from '../sub-agents';
import { createAgentLogger, startTimer } from '../tracing';

/** Valid SubAgentTaskType values for validation */
const VALID_TASK_TYPES: SubAgentTaskType[] = [
    'browser_action',
    'query',
    'translate',
    'export',
    'unknown',
];

/**
 * Validate and normalize task type from metadata
 */
function getValidTaskType(metadataType: unknown): SubAgentTaskType {
    if (
        typeof metadataType === 'string' &&
        VALID_TASK_TYPES.includes(metadataType as SubAgentTaskType)
    ) {
        return metadataType as SubAgentTaskType;
    }
    return 'browser_action';
}

const log = createAgentLogger('RouterNode');

/**
 * Configuration for the router node
 */
export interface RouterNodeConfig {
    /** Beads client for task management */
    beadsClient: IBeadsClient;
    /** Sub-agent registry for task dispatch */
    subAgentRegistry: ISubAgentRegistry;
    /** Whether to enable smart merging */
    enableMerging?: boolean;
    /** Maximum tasks to merge into one batch */
    maxMergeSize?: number;
}

/** Result when no ready tasks are available */
interface NoReadyTasksResult {
    type: 'complete' | 'blocked';
    state: Partial<AgentState>;
}

/** Prepared execution context for sub-agent */
interface PreparedExecution {
    subAgent: ISubAgent;
    subAgentTask: SubAgentTask;
    context: SubAgentContext;
    tasksToExecute: BeadsTask[];
    readyTasks: BeadsTask[];
}

/**
 * Handle case when no ready tasks exist
 */
async function handleNoReadyTasks(
    beadsClient: IBeadsClient,
    state: AgentState,
    traceContext: TraceContext | null
): Promise<NoReadyTasksResult> {
    const allTasks = await beadsClient.list();
    const openTasks = allTasks.filter((t) => t.status === 'open');

    if (openTasks.length === 0) {
        log.infoWithTrace(traceContext!, '[ROUTER] All tasks complete');
        return {
            type: 'complete',
            state: {
                status: 'complete',
                isComplete: true,
                result: `✅ 任务完成！共完成 ${state.beadsCompletedCount} 个步骤`,
            },
        };
    }

    log.warnWithTrace(traceContext!, '[ROUTER] Tasks blocked', {
        blockedCount: openTasks.length,
    });
    return {
        type: 'blocked',
        state: {
            status: 'error',
            error: 'All remaining tasks are blocked',
        },
    };
}

/**
 * Prepare sub-agent execution (merge tasks, find agent, build context)
 */
function prepareSubAgentExecution(
    readyTasks: BeadsTask[],
    state: AgentState,
    subAgentRegistry: ISubAgentRegistry,
    enableMerging: boolean,
    maxMergeSize: number,
    traceContext: TraceContext | null
): PreparedExecution | { error: Partial<AgentState> } {
    // Apply smart merging if enabled
    const tasksToExecute = enableMerging
        ? mergeConsecutiveTasks(readyTasks, maxMergeSize)
        : [readyTasks[0]];

    const isMerged = tasksToExecute.length > 1;
    const firstTask = tasksToExecute[0];

    // Find sub-agent for the first task
    const subAgent = subAgentRegistry.findForTask(firstTask);

    if (!subAgent) {
        log.errorWithTrace(traceContext!, '[ROUTER] No sub-agent found', {
            taskId: firstTask.id,
            taskTitle: firstTask.title,
        });
        return {
            error: {
                status: 'error',
                error: `No sub-agent can handle task: ${firstTask.title}`,
            },
        };
    }

    log.infoWithTrace(traceContext!, '[ROUTER] Dispatching to sub-agent', {
        subAgent: subAgent.name,
        taskCount: tasksToExecute.length,
        isMerged,
    });

    // Build the task for sub-agent
    const subAgentTask: SubAgentTask = {
        tasks: tasksToExecute,
        instruction: buildMergedInstruction(tasksToExecute),
        type: getValidTaskType(firstTask.metadata?.type),
        isMerged,
        originalTaskIds: tasksToExecute.map((t) => t.id),
    };

    // Build context
    const context: SubAgentContext = {
        state,
        variables: state.executionVariables || {},
        traceId: traceContext?.traceId,
    };

    return { subAgent, subAgentTask, context, tasksToExecute, readyTasks };
}

/**
 * Build state update from sub-agent result
 *
 * @param freshReadyTaskIds - IDs of ready tasks fetched AFTER closing completed tasks
 */
function buildStateFromResult(
    result: SubAgentResult,
    state: AgentState,
    freshReadyTaskIds: string[],
    instruction: string
): Partial<AgentState> {
    const newCompletedCount =
        state.beadsCompletedCount + result.completedTaskIds.length;

    return {
        status: result.success ? 'executing' : 'error',
        beadsCompletedCount: newCompletedCount,
        beadsCurrentTaskId: result.completedTaskIds[0] || null,
        // Use fresh ready task IDs (fetched after closing tasks to include newly-unblocked)
        beadsReadyTaskIds: freshReadyTaskIds,
        executionVariables: result.updatedVariables || state.executionVariables,
        consecutiveFailures: result.success ? 0 : state.consecutiveFailures + 1,
        error: result.success ? null : result.error,
        currentInstruction: instruction,
    };
}

/**
 * Create the Router Node
 *
 * The router:
 * 1. Gets ready tasks from Beads (no blockers)
 * 2. Optionally merges consecutive mergeable tasks
 * 3. Dispatches to appropriate sub-agent
 * 4. Updates task status in Beads
 */
export function createRouterNode(config: RouterNodeConfig) {
    const {
        beadsClient,
        subAgentRegistry,
        enableMerging = true,
        maxMergeSize = 5,
    } = config;

    return async (state: AgentState): Promise<Partial<AgentState>> => {
        const traceContext = state.traceContext;
        const timer = startTimer(log, 'router', traceContext ?? undefined);

        log.infoWithTrace(traceContext!, '[ROUTER] Starting task routing', {
            epicId: state.beadsEpicId,
            completedCount: state.beadsCompletedCount,
            taskCount: state.beadsTaskCount,
        });

        try {
            // Get ready tasks (no blockers)
            const readyTasks = await beadsClient.getReady();

            if (readyTasks.length === 0) {
                const result = await handleNoReadyTasks(
                    beadsClient,
                    state,
                    traceContext
                );
                timer.end(
                    result.type === 'complete'
                        ? 'All tasks complete'
                        : 'Tasks blocked'
                );
                return result.state;
            }

            log.infoWithTrace(traceContext!, '[ROUTER] Ready tasks found', {
                readyCount: readyTasks.length,
                taskIds: readyTasks.map((t) => t.id),
            });

            // Prepare execution
            const prepared = prepareSubAgentExecution(
                readyTasks,
                state,
                subAgentRegistry,
                enableMerging,
                maxMergeSize,
                traceContext
            );

            if ('error' in prepared) {
                timer.end('No sub-agent found');
                return prepared.error;
            }

            // Execute via sub-agent
            const result = await prepared.subAgent.execute(
                prepared.subAgentTask,
                prepared.context
            );

            // Update Beads task status
            for (const taskId of result.completedTaskIds) {
                await beadsClient.close(taskId, result.summary);
            }

            // Fetch fresh ready tasks AFTER closing completed tasks
            // This includes newly-unblocked tasks that became ready
            const freshReadyTasks = await beadsClient.getReady();
            const freshReadyTaskIds = freshReadyTasks.map((t) => t.id);

            log.infoWithTrace(
                traceContext!,
                '[ROUTER] Sub-agent execution complete',
                {
                    success: result.success,
                    completedCount: result.completedTaskIds.length,
                    failedCount: result.failedTaskIds.length,
                    totalCompleted:
                        state.beadsCompletedCount +
                        result.completedTaskIds.length,
                    newReadyCount: freshReadyTaskIds.length,
                }
            );

            timer.end(`Executed ${result.completedTaskIds.length} tasks`);

            return buildStateFromResult(
                result,
                state,
                freshReadyTaskIds,
                prepared.subAgentTask.instruction
            );
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            log.errorWithTrace(traceContext!, '[ROUTER] Error', {
                error: errorMessage,
            });
            timer.end(`Error: ${errorMessage}`);

            return {
                status: 'error',
                error: `Router error: ${errorMessage}`,
                consecutiveFailures: state.consecutiveFailures + 1,
            };
        }
    };
}

/**
 * Get tasks to execute in this iteration, respecting maxSize limit.
 * Returns up to maxSize consecutive mergeable tasks, or a single non-mergeable task.
 * This ensures each router iteration only handles a controlled batch.
 */
function mergeConsecutiveTasks(
    tasks: BeadsTask[],
    maxSize: number
): BeadsTask[] {
    if (tasks.length === 0) return [];

    const firstTask = tasks[0];
    const isFirstMergeable = firstTask.metadata?.mergeable === true;

    // If first task is not mergeable, return just that one
    if (!isFirstMergeable) {
        return [firstTask];
    }

    // First task is mergeable - collect consecutive mergeable tasks up to maxSize
    const batch: BeadsTask[] = [firstTask];

    for (let i = 1; i < tasks.length && batch.length < maxSize; i++) {
        const task = tasks[i];
        const isMergeable = task.metadata?.mergeable === true;

        if (isMergeable) {
            batch.push(task);
        } else {
            // Stop at first non-mergeable task
            break;
        }
    }

    return batch;
}

/**
 * Build a single instruction from merged tasks
 */
function buildMergedInstruction(tasks: BeadsTask[]): string {
    if (tasks.length === 0) return '';
    if (tasks.length === 1) return tasks[0].title;

    // Join tasks with ", then "
    return tasks.map((t) => t.title).join(', then ');
}
