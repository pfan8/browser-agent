/**
 * Beads Planner Node
 *
 * LangGraph node that handles task planning using Beads.
 * Generates a complete task list upfront and tracks progress.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentState } from '../state';
import type { IBeadsClient } from '../beads';
import { loadLLMConfig } from '../config';
import { createAgentLogger, startTimer } from '../tracing';
import {
    PLANNER_INITIAL_SYSTEM_PROMPT,
    buildInitialPlanningMessage,
    parseInitialPlanningResponse,
} from './prompts';

const log = createAgentLogger('BeadsPlannerNode');

/**
 * Configuration for the Beads planner node
 */
export interface BeadsPlannerNodeConfig {
    /** Beads client for task management */
    beadsClient: IBeadsClient;
    /** LLM API key */
    apiKey?: string;
    /** LLM base URL */
    baseUrl?: string;
    /** LLM model name */
    model?: string;
    /** Temperature for LLM */
    temperature?: number;
    /** Max tokens for LLM response */
    maxTokens?: number;
}

/**
 * Create the Beads Planner Node
 *
 * The planner:
 * 1. On first call: Generates complete task list and creates in Beads
 * 2. On subsequent calls: Updates progress and checks completion
 */
export function createBeadsPlannerNode(config: BeadsPlannerNodeConfig) {
    const llmConfig = loadLLMConfig({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
    });

    const hasLlm = !!llmConfig.apiKey;
    let llm: ChatAnthropic | null = null;

    if (hasLlm) {
        log.info('Initializing Beads Planner LLM', { model: llmConfig.model });

        const llmOptions: Record<string, unknown> = {
            anthropicApiKey: llmConfig.apiKey,
            modelName: llmConfig.model,
        };

        if (llmConfig.temperature !== undefined) {
            llmOptions.temperature = llmConfig.temperature;
        }
        if (llmConfig.baseUrl) {
            llmOptions.anthropicApiUrl = llmConfig.baseUrl;
        }
        if (llmConfig.maxTokens !== undefined) {
            llmOptions.maxOutputTokens = llmConfig.maxTokens;
        }

        llm = new ChatAnthropic(llmOptions);
    }

    return async (state: AgentState): Promise<Partial<AgentState>> => {
        const traceContext = state.traceContext;
        const timer = startTimer(
            log,
            'beads-planner',
            traceContext ?? undefined
        );

        // Check if this is initial planning or progress check
        const isInitialPlanning = !state.beadsPlanningComplete;

        log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Starting', {
            isInitialPlanning,
            goal: state.goal.substring(0, 50),
            epicId: state.beadsEpicId,
        });

        try {
            if (!hasLlm) {
                timer.end('No LLM configured');
                return {
                    status: 'error',
                    error: 'LLM not configured',
                    isComplete: true,
                    result: '❌ AI 未配置，请在设置中配置 API Key',
                };
            }

            if (isInitialPlanning) {
                return await handleInitialPlanning(
                    state,
                    llm!,
                    config.beadsClient,
                    timer,
                    traceContext
                );
            } else {
                return await handleProgressCheck(
                    state,
                    config.beadsClient,
                    timer,
                    traceContext
                );
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error);
            log.errorWithTrace(traceContext!, '[BEADS-PLANNER] Error', {
                error: errorMessage,
            });
            timer.end(`Error: ${errorMessage}`);

            return {
                status: 'error',
                error: `Planner failed: ${errorMessage}`,
                consecutiveFailures: state.consecutiveFailures + 1,
            };
        }
    };
}

/**
 * Call LLM to generate task plan
 */
async function callLLMForPlan(
    goal: string,
    llm: ChatAnthropic,
    traceContext: AgentState['traceContext']
): Promise<string> {
    const messages = [
        new SystemMessage(PLANNER_INITIAL_SYSTEM_PROMPT),
        new HumanMessage(buildInitialPlanningMessage(goal)),
    ];

    const llmStartTime = Date.now();
    const response = await llm.invoke(messages);
    const llmDuration = Date.now() - llmStartTime;

    const responseText =
        typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] LLM response', {
        duration: llmDuration,
        responseLength: responseText.length,
        preview: responseText.substring(0, 200),
    });

    return responseText;
}

/**
 * Create tasks in Beads from planner output
 */
async function createTasksInBeads(
    plannerOutput: NonNullable<ReturnType<typeof parseInitialPlanningResponse>>,
    beadsClient: IBeadsClient,
    traceContext: AgentState['traceContext']
): Promise<{ epicId: string; taskIds: string[] }> {
    // Create epic
    const epic = await beadsClient.create(plannerOutput.epic, {
        priority: 0,
        metadata: { isEpic: true },
    });

    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Created epic', {
        epicId: epic.id,
    });

    // Create tasks
    const taskIds: string[] = [];
    for (let i = 0; i < plannerOutput.tasks.length; i++) {
        const taskDef = plannerOutput.tasks[i];

        // Validate blockedBy indices
        const blockedBy: string[] = [];
        if (taskDef.blockedBy && taskDef.blockedBy.length > 0) {
            for (const idx of taskDef.blockedBy) {
                if (idx < 0) {
                    log.warnWithTrace(
                        traceContext!,
                        '[BEADS-PLANNER] Invalid blockedBy index (negative)',
                        {
                            taskIndex: i,
                            invalidIndex: idx,
                            taskTitle: taskDef.title,
                        }
                    );
                } else if (idx >= i) {
                    log.warnWithTrace(
                        traceContext!,
                        '[BEADS-PLANNER] Invalid blockedBy index (forward reference)',
                        {
                            taskIndex: i,
                            invalidIndex: idx,
                            taskTitle: taskDef.title,
                        }
                    );
                } else if (!taskIds[idx]) {
                    log.warnWithTrace(
                        traceContext!,
                        '[BEADS-PLANNER] Invalid blockedBy index (task not found)',
                        {
                            taskIndex: i,
                            invalidIndex: idx,
                            taskTitle: taskDef.title,
                        }
                    );
                } else {
                    blockedBy.push(taskIds[idx]);
                }
            }
        }

        const task = await beadsClient.create(taskDef.title, {
            priority: 1,
            parentId: epic.id,
            blockedBy,
            metadata: {
                type: taskDef.type || 'browser_action',
                mergeable: taskDef.mergeable,
                index: i,
            },
        });

        taskIds.push(task.id);

        log.debugWithTrace(traceContext!, '[BEADS-PLANNER] Created task', {
            taskId: task.id,
            title: taskDef.title,
            blockedBy,
        });
    }

    return { epicId: epic.id, taskIds };
}

/**
 * Handle initial planning - generate task list
 */
async function handleInitialPlanning(
    state: AgentState,
    llm: ChatAnthropic,
    beadsClient: IBeadsClient,
    timer: ReturnType<typeof startTimer>,
    traceContext: AgentState['traceContext']
): Promise<Partial<AgentState>> {
    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Generating initial plan');

    // Call LLM
    const responseText = await callLLMForPlan(state.goal, llm, traceContext);

    // Parse response
    const plannerOutput = parseInitialPlanningResponse(responseText);
    if (!plannerOutput) {
        log.errorWithTrace(
            traceContext!,
            '[BEADS-PLANNER] Failed to parse response'
        );
        timer.end('Parse error');
        return {
            status: 'error',
            error: 'Failed to parse planner response',
            consecutiveFailures: state.consecutiveFailures + 1,
        };
    }

    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Parsed plan', {
        epic: plannerOutput.epic,
        taskCount: plannerOutput.tasks.length,
        mergeHint: plannerOutput.mergeHint,
    });

    // Create tasks in Beads
    const { epicId, taskIds } = await createTasksInBeads(
        plannerOutput,
        beadsClient,
        traceContext
    );

    timer.end(`Created ${taskIds.length} tasks`);

    // Determine ready tasks (no blockers)
    const readyTaskIds = taskIds.filter((_, i) => {
        const task = plannerOutput.tasks[i];
        return !task.blockedBy || task.blockedBy.length === 0;
    });

    return {
        status: 'planning',
        beadsEpicId: epicId,
        beadsTaskCount: taskIds.length,
        beadsCompletedCount: 0,
        beadsPlanningComplete: true,
        beadsReadyTaskIds: readyTaskIds,
    };
}

/** Progress stats for an epic */
interface ProgressStats {
    completedCount: number;
    openCount: number;
    totalCount: number;
    readyIds: string[];
}

/**
 * Fetch progress stats for an epic
 */
async function fetchProgressStats(
    epicId: string,
    beadsClient: IBeadsClient
): Promise<ProgressStats> {
    const allTasks = await beadsClient.list();
    const childTasks = allTasks.filter((t) => t.parentId === epicId);

    const completedCount = childTasks.filter(
        (t) => t.status === 'closed'
    ).length;
    const openCount = childTasks.filter((t) => t.status === 'open').length;
    const totalCount = childTasks.length;

    const readyTasks = await beadsClient.getReady();
    const readyIds = readyTasks.map((t) => t.id);

    return { completedCount, openCount, totalCount, readyIds };
}

/**
 * Handle progress check - update state based on Beads
 */
async function handleProgressCheck(
    state: AgentState,
    beadsClient: IBeadsClient,
    timer: ReturnType<typeof startTimer>,
    traceContext: AgentState['traceContext']
): Promise<Partial<AgentState>> {
    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Checking progress');

    // Validate that beadsEpicId is set (invariant after planning completes)
    const epicId = state.beadsEpicId;
    if (!epicId) {
        log.errorWithTrace(
            traceContext!,
            '[BEADS-PLANNER] beadsEpicId is null'
        );
        timer.end('Missing epic ID');
        return { status: 'error', error: 'Epic ID not set', isComplete: true };
    }

    const stats = await fetchProgressStats(epicId, beadsClient);
    const { completedCount, openCount, totalCount, readyIds } = stats;

    log.infoWithTrace(traceContext!, '[BEADS-PLANNER] Progress', {
        completed: completedCount,
        total: totalCount,
        open: openCount,
        ready: readyIds.length,
    });

    // Guard: no tasks created
    if (totalCount === 0) {
        log.warnWithTrace(traceContext!, '[BEADS-PLANNER] No tasks under epic');
        timer.end('No tasks found');
        return { status: 'error', error: 'No tasks created', isComplete: true };
    }

    // All done
    if (completedCount >= totalCount) {
        await beadsClient.close(epicId, '任务完成');
        timer.end('All tasks complete');
        return {
            status: 'complete',
            isComplete: true,
            result: `✅ 任务完成！共完成 ${completedCount} 个步骤`,
            beadsCompletedCount: completedCount,
        };
    }

    // Deadlock: open tasks but none ready (circular dependencies)
    if (openCount > 0 && readyIds.length === 0) {
        log.errorWithTrace(traceContext!, '[BEADS-PLANNER] Deadlock detected', {
            openCount,
            completedCount,
            totalCount,
        });
        timer.end('Deadlock');
        return {
            status: 'error',
            error: `任务阻塞：${openCount} 个任务无法继续（可能循环依赖）`,
            isComplete: true,
            beadsCompletedCount: completedCount,
        };
    }

    timer.end(`${completedCount}/${totalCount} complete`);
    return {
        status: 'planning',
        beadsCompletedCount: completedCount,
        beadsReadyTaskIds: readyIds,
    };
}
