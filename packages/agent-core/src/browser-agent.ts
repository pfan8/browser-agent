/**
 * Browser Agent
 *
 * Main agent class that wraps the LangGraph compiled graph.
 * Handles task execution, session management, checkpoints, and memory.
 *
 * Extracted from graph.ts to maintain file size under 800 lines.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import {
    type AgentState,
    type AgentConfig,
    DEFAULT_AGENT_CONFIG,
    buildFailureReport,
    type ExecutionMode,
    type MemoryContext,
} from './state';
import {
    createTraceContext,
    createAgentLogger,
    setTraceContext,
    type TraceContext,
} from './tracing';
import {
    PersistentCheckpointer,
    SqliteCheckpointer,
    type ThreadMetadata,
    type CheckpointHistoryItem,
} from './checkpointer';
import { MemoryManager, SqliteMemoryStore } from './memory';
import {
    createAgentGraph,
    createBeadsAgentGraph,
    type AgentGraphConfig,
    type BeadsAgentGraphConfig,
} from './graph';
import {
    snapshotToHistoryItem,
    restoreStateFromSnapshot,
} from './agent-checkpoints';

const log = createAgentLogger('BrowserAgent');

/**
 * Extended config for BrowserAgent that supports Beads mode
 */
export type BrowserAgentConfig = AgentGraphConfig | BeadsAgentGraphConfig;

/**
 * Check if config is for Beads mode
 */
function isBeadsConfig(
    config: BrowserAgentConfig
): config is BeadsAgentGraphConfig {
    return 'beadsClient' in config && config.beadsClient !== undefined;
}

/**
 * Agent class that wraps the compiled graph
 *
 * Supports two modes:
 * 1. Legacy mode (Planner ↔ CodeAct): Pass AgentGraphConfig
 * 2. Beads mode (BeadsPlanner ↔ Router): Pass BeadsAgentGraphConfig with beadsClient
 */
export class BrowserAgent {
    private graph:
        | ReturnType<typeof createAgentGraph>
        | ReturnType<typeof createBeadsAgentGraph>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private compiledGraph: any = null;
    private browserAdapter: IBrowserAdapter;
    private config: AgentConfig;
    private isRunning: boolean = false;
    private currentThreadId: string | null = null;
    private abortController: AbortController | null = null;
    private persistentCheckpointer: PersistentCheckpointer | null = null;
    private memoryManager: MemoryManager | null = null;
    private useBeadsMode: boolean = false;

    constructor(graphConfig: BrowserAgentConfig) {
        // Choose graph based on config type
        if (isBeadsConfig(graphConfig)) {
            this.graph = createBeadsAgentGraph(graphConfig);
            this.useBeadsMode = true;
            log.info('Using Beads agent graph');
        } else {
            this.graph = createAgentGraph(graphConfig);
            log.info('Using legacy agent graph');
        }

        this.browserAdapter = graphConfig.browserAdapter;
        this.config = { ...DEFAULT_AGENT_CONFIG, ...graphConfig.agentConfig };

        if (graphConfig.memoryDbPath) {
            const memoryStore = new SqliteMemoryStore(graphConfig.memoryDbPath);
            this.memoryManager = new MemoryManager(memoryStore);
            log.info('Memory manager initialized', {
                dbPath: graphConfig.memoryDbPath,
            });
        }
    }

    /**
     * Check if agent is using Beads mode
     */
    isBeadsMode(): boolean {
        return this.useBeadsMode;
    }

    /**
     * Compile the graph with optional checkpointer
     */
    compile(checkpointer?: unknown) {
        if (checkpointer instanceof PersistentCheckpointer) {
            this.persistentCheckpointer = checkpointer;
            this.compiledGraph = this.graph.compile({
                checkpointer: checkpointer.getCheckpointer() as any,
            });
        } else if (checkpointer instanceof SqliteCheckpointer) {
            this.persistentCheckpointer =
                checkpointer as PersistentCheckpointer;
            this.compiledGraph = this.graph.compile({
                checkpointer: checkpointer.getCheckpointer() as any,
            });
        } else {
            this.compiledGraph = this.graph.compile({
                checkpointer: checkpointer as any,
            });
        }

        log.info('Graph compiled', {
            maxIterations: this.config.maxIterations,
            hasPersistentCheckpointer: !!this.persistentCheckpointer,
        });

        return this;
    }

    // ============================================
    // Session Management Methods
    // ============================================

    createSession(name?: string, description?: string): ThreadMetadata | null {
        if (!this.persistentCheckpointer) {
            log.warn(
                'No SQLite checkpointer configured, sessions not persisted'
            );
            return null;
        }

        const threadId = `thread_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 7)}`;
        return this.persistentCheckpointer.createThread(
            threadId,
            name,
            description
        );
    }

    listSessions(limit: number = 50): ThreadMetadata[] {
        if (!this.persistentCheckpointer) {
            return [];
        }
        return this.persistentCheckpointer.listThreads(limit);
    }

    getSession(threadId: string): ThreadMetadata | null {
        if (!this.persistentCheckpointer) {
            return null;
        }
        return this.persistentCheckpointer.getThread(threadId);
    }

    deleteSession(threadId: string): boolean {
        if (!this.persistentCheckpointer) {
            return false;
        }
        return this.persistentCheckpointer.deleteThread(threadId);
    }

    private updateThreadActivity(threadId: string, messageCount: number): void {
        if (!this.persistentCheckpointer) return;
        this.persistentCheckpointer.updateThreadActivity(
            threadId,
            messageCount
        );
    }

    // ============================================
    // Checkpoint History Methods
    // ============================================

    async getCheckpointHistory(
        threadId: string
    ): Promise<CheckpointHistoryItem[]> {
        if (!this.compiledGraph) {
            throw new Error('Graph not compiled. Call compile() first.');
        }

        const history: CheckpointHistoryItem[] = [];

        try {
            const config = { configurable: { thread_id: threadId } };

            for await (const snapshot of this.compiledGraph.getStateHistory(
                config
            )) {
                const checkpoint = snapshotToHistoryItem(threadId, snapshot);
                if (checkpoint) {
                    history.push(checkpoint);
                }
            }

            log.debug('Retrieved checkpoint history', {
                threadId,
                count: history.length,
            });
            return history;
        } catch (error) {
            log.warn('Failed to get checkpoint history', {
                threadId,
                error: error instanceof Error ? error.message : String(error),
            });
            return [];
        }
    }

    async getStateAtCheckpoint(
        threadId: string,
        checkpointId: string
    ): Promise<Partial<AgentState> | null> {
        if (!this.compiledGraph) {
            throw new Error('Graph not compiled. Call compile() first.');
        }

        try {
            const config = {
                configurable: {
                    thread_id: threadId,
                    checkpoint_id: checkpointId,
                },
            };

            const snapshot = await this.compiledGraph.getState(config);

            if (!snapshot || !snapshot.values) {
                return null;
            }

            return restoreStateFromSnapshot(
                snapshot.values as Record<string, unknown>
            );
        } catch (error) {
            log.warn('Failed to get state at checkpoint', {
                threadId,
                checkpointId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async restoreToCheckpoint(
        threadId: string,
        checkpointId: string
    ): Promise<Partial<AgentState> | null> {
        if (!this.compiledGraph) {
            throw new Error('Graph not compiled. Call compile() first.');
        }

        try {
            const state = await this.getStateAtCheckpoint(
                threadId,
                checkpointId
            );

            if (!state) {
                log.warn('Checkpoint not found for restore', {
                    threadId,
                    checkpointId,
                });
                return null;
            }

            log.info('Restored to checkpoint', {
                threadId,
                checkpointId,
                messageCount:
                    (state.messages as unknown[] | undefined)?.length || 0,
            });

            this.currentThreadId = threadId;
            return state;
        } catch (error) {
            log.error('Failed to restore to checkpoint', {
                threadId,
                checkpointId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    async loadSessionState(
        threadId: string
    ): Promise<Partial<AgentState> | null> {
        if (!this.compiledGraph) {
            return null;
        }

        try {
            const config = { configurable: { thread_id: threadId } };
            const snapshot = await this.compiledGraph.getState(config);

            if (!snapshot || !snapshot.values) {
                return null;
            }

            return restoreStateFromSnapshot(
                snapshot.values as Record<string, unknown>
            );
        } catch (error) {
            log.warn('Failed to load session state', {
                threadId,
                error: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
    }

    // ============================================
    // Memory Methods
    // ============================================

    private async buildMemoryContext(
        goal: string
    ): Promise<MemoryContext | null> {
        if (!this.memoryManager) {
            return null;
        }

        try {
            const context = await this.memoryManager.buildContextForTask(goal);

            return {
                userPreferences: context.userPrefs?.language
                    ? `Language: ${context.userPrefs.language}`
                    : undefined,
                relevantFacts: context.relevantFacts.map((f) => f.content),
                recentTasks: context.recentTasks
                    .filter((t) => t.success)
                    .map((t) => t.goal.substring(0, 50)),
                contextSummary: context.contextSummary || undefined,
            };
        } catch (error) {
            log.warn('Failed to build memory context', {
                error: error instanceof Error ? error.message : 'Unknown error',
            });
            return null;
        }
    }

    private async extractMemories(
        goal: string,
        success: boolean,
        state: AgentState,
        threadId: string,
        duration: number
    ): Promise<void> {
        if (!this.memoryManager) {
            return;
        }

        try {
            await this.memoryManager.extractFromTaskResult({
                goal,
                success,
                actionHistory: (state.actionHistory || []).map((a) => ({
                    tool: a.tool,
                    args: a.args,
                    result: a.result
                        ? { success: a.result.success }
                        : undefined,
                })),
                observation: state.observation
                    ? { url: state.observation.url }
                    : undefined,
                threadId,
                duration,
            });
        } catch (error) {
            log.error('Failed to extract memories', error);
        }
    }

    getMemoryManager(): MemoryManager | null {
        return this.memoryManager;
    }

    // ============================================
    // Graph Execution
    // ============================================

    private getGraphConfig(threadId: string, signal?: AbortSignal) {
        const recursionLimit = this.config.maxIterations * 3 + 10;

        return {
            configurable: { thread_id: threadId },
            recursionLimit,
            signal,
        };
    }

    async executeTask(
        goal: string,
        threadId?: string,
        continueSession: boolean = false
    ): Promise<AgentState> {
        if (!this.compiledGraph) {
            throw new Error('Graph not compiled. Call compile() first.');
        }

        if (this.isRunning) {
            throw new Error('Agent is already running a task');
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.currentThreadId = threadId || `thread_${Date.now()}`;

        const traceContext = createTraceContext(goal, {
            threadId: this.currentThreadId,
            maxIterations: this.config.maxIterations,
        });

        setTraceContext(traceContext);
        const startTime = Date.now();

        try {
            let previousState: Partial<AgentState> | null = null;
            if (continueSession && threadId) {
                previousState = await this.loadSessionState(threadId);
                if (previousState) {
                    log.infoWithTrace(
                        traceContext,
                        'Continuing previous session',
                        {
                            threadId,
                            previousMessageCount:
                                previousState.messages?.length || 0,
                        }
                    );
                }
            }

            if (this.persistentCheckpointer) {
                const threadName = continueSession
                    ? undefined
                    : goal.substring(0, 50);
                this.persistentCheckpointer.createThread(
                    this.currentThreadId,
                    threadName
                );
            }

            const memoryContext = await this.buildMemoryContext(goal);
            if (memoryContext) {
                log.infoWithTrace(traceContext, 'Memory context loaded', {
                    hasUserPrefs: !!memoryContext.userPreferences,
                    factCount: memoryContext.relevantFacts?.length || 0,
                    recentTaskCount: memoryContext.recentTasks?.length || 0,
                });
            }

            log.infoWithTrace(traceContext, 'Starting task', {
                goal: goal.substring(0, 100),
                threadId: this.currentThreadId,
                mode: this.config.executionMode,
                continueSession,
                hasMemoryContext: !!memoryContext,
            });

            const initialState = this.buildInitialState(
                goal,
                previousState,
                continueSession,
                traceContext,
                memoryContext
            );

            const graphConfig = this.getGraphConfig(
                this.currentThreadId,
                this.abortController?.signal
            );

            const result = await this.compiledGraph.invoke(
                initialState,
                graphConfig
            );

            const duration = Date.now() - startTime;
            log.infoWithTrace(traceContext, 'Task completed', {
                status: result.status,
                duration,
                iterationCount: result.iterationCount,
                actionCount: result.actionHistory?.length || 0,
            });

            const messageCount = result.messages?.length || 0;
            this.updateThreadActivity(this.currentThreadId, messageCount);

            const isSuccess = result.status === 'complete' && !result.error;
            await this.extractMemories(
                goal,
                isSuccess,
                result,
                this.currentThreadId,
                duration
            );

            if (result.status === 'error' && !result.result) {
                const report = buildFailureReport(result);
                return { ...result, result: report, isComplete: true };
            }

            return result;
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                log.infoWithTrace(traceContext, 'Task aborted by user');
                return this.buildAbortedState(goal, traceContext);
            }
            const duration = Date.now() - startTime;
            log.errorWithTrace(traceContext, 'Task failed with exception', {
                error: error instanceof Error ? error.message : String(error),
                duration,
            });
            throw error;
        } finally {
            this.isRunning = false;
            this.abortController = null;
            setTraceContext(null);
        }
    }

    async *streamTask(
        goal: string,
        threadId?: string,
        continueSession: boolean = false
    ): AsyncGenerator<{
        node: string;
        state: Partial<AgentState>;
        traceContext?: TraceContext;
    }> {
        if (!this.compiledGraph) {
            throw new Error('Graph not compiled. Call compile() first.');
        }

        if (this.isRunning) {
            throw new Error('Agent is already running a task');
        }

        this.isRunning = true;
        this.abortController = new AbortController();
        this.currentThreadId = threadId || `thread_${Date.now()}`;

        const traceContext = createTraceContext(goal, {
            threadId: this.currentThreadId,
            maxIterations: this.config.maxIterations,
            streaming: true,
        });

        setTraceContext(traceContext);
        const startTime = Date.now();
        let finalState: AgentState | null = null;

        try {
            let previousState: Partial<AgentState> | null = null;
            if (continueSession && threadId) {
                previousState = await this.loadSessionState(threadId);
                if (previousState) {
                    log.infoWithTrace(
                        traceContext,
                        'Continuing previous session (stream)',
                        {
                            threadId,
                            previousMessageCount:
                                previousState.messages?.length || 0,
                        }
                    );
                }
            }

            if (this.persistentCheckpointer) {
                const threadName = continueSession
                    ? undefined
                    : goal.substring(0, 50);
                this.persistentCheckpointer.createThread(
                    this.currentThreadId,
                    threadName
                );
            }

            const memoryContext = await this.buildMemoryContext(goal);

            log.infoWithTrace(traceContext, 'Starting streamed task', {
                goal: goal.substring(0, 100),
                threadId: this.currentThreadId,
                mode: this.config.executionMode,
                continueSession,
                hasMemoryContext: !!memoryContext,
            });

            const initialState = this.buildInitialState(
                goal,
                previousState,
                continueSession,
                traceContext,
                memoryContext
            );

            const graphConfig = this.getGraphConfig(
                this.currentThreadId,
                this.abortController?.signal
            );

            for await (const event of await this.compiledGraph.stream(
                initialState,
                graphConfig
            )) {
                if (this.abortController?.signal.aborted) {
                    log.infoWithTrace(traceContext, 'Task aborted by user');
                    yield {
                        node: '__abort__',
                        state: {
                            status: 'error',
                            error: 'Task stopped by user',
                            isComplete: true,
                        },
                        traceContext,
                    };
                    return;
                }

                for (const [node, state] of Object.entries(event)) {
                    log.debugWithTrace(
                        traceContext,
                        `Node completed: ${node}`,
                        {
                            status: (state as Partial<AgentState>).status,
                        }
                    );

                    if (finalState) {
                        finalState = {
                            ...finalState,
                            ...(state as AgentState),
                        };
                    } else {
                        finalState = state as AgentState;
                    }

                    yield {
                        node,
                        state: state as Partial<AgentState>,
                        traceContext,
                    };
                }
            }

            if (finalState && this.currentThreadId) {
                const messageCount = finalState.messages?.length || 0;
                this.updateThreadActivity(this.currentThreadId, messageCount);

                const duration = Date.now() - startTime;
                const isSuccess =
                    finalState.status === 'complete' && !finalState.error;
                await this.extractMemories(
                    goal,
                    isSuccess,
                    finalState,
                    this.currentThreadId,
                    duration
                );
            }

            const duration = Date.now() - startTime;
            log.infoWithTrace(traceContext, 'Streamed task completed', {
                duration,
            });
        } catch (error) {
            if (this.abortController?.signal.aborted) {
                log.infoWithTrace(
                    traceContext,
                    'Streamed task aborted by user'
                );
                yield {
                    node: '__abort__',
                    state: {
                        status: 'error',
                        error: 'Task stopped by user',
                        result: '任务已被用户停止',
                        isComplete: true,
                    },
                    traceContext,
                };
                return;
            }
            const duration = Date.now() - startTime;
            log.errorWithTrace(
                traceContext,
                'Streamed task failed with exception',
                {
                    error:
                        error instanceof Error ? error.message : String(error),
                    duration,
                }
            );
            throw error;
        } finally {
            this.isRunning = false;
            this.abortController = null;
            setTraceContext(null);
        }
    }

    private buildInitialState(
        goal: string,
        previousState: Partial<AgentState> | null,
        continueSession: boolean,
        traceContext: TraceContext,
        memoryContext: MemoryContext | null
    ): Partial<AgentState> {
        return {
            ...(previousState || {}),
            goal,
            originalGoal: previousState?.originalGoal || goal,
            status: 'idle',
            iterationCount: 0,
            consecutiveFailures: 0,
            actionHistory: continueSession
                ? previousState?.actionHistory || []
                : [],
            messages: continueSession ? previousState?.messages || [] : [],
            observation: null,
            previousObservation: null,
            plan: null,
            currentStepIndex: 0,
            completedSteps: continueSession
                ? previousState?.completedSteps || []
                : [],
            result: null,
            error: null,
            isComplete: false,
            actionSignatures: continueSession
                ? previousState?.actionSignatures || new Map()
                : new Map(),
            loopDetected: false,
            useFallbackRules: false,
            traceContext,
            currentInstruction: null,
            plannerThought: null,
            executionMode: this.config.executionMode,
            memoryContext,
            threadId: this.currentThreadId,
            executionVariables: continueSession
                ? previousState?.executionVariables || {}
                : {},
            variableSummary: continueSession
                ? previousState?.variableSummary || []
                : [],
        };
    }

    private buildAbortedState(
        goal: string,
        traceContext: TraceContext
    ): AgentState {
        return {
            goal,
            originalGoal: goal,
            status: 'error',
            error: 'Task stopped by user',
            result: '任务已被用户停止',
            isComplete: true,
            messages: [],
            observation: null,
            previousObservation: null,
            actionHistory: [],
            iterationCount: 0,
            consecutiveFailures: 0,
            actionSignatures: new Map(),
            loopDetected: false,
            plan: null,
            currentStepIndex: 0,
            completedSteps: [],
            useFallbackRules: false,
            traceContext,
            currentInstruction: null,
            plannerThought: null,
            executionMode: this.config.executionMode,
            memoryContext: null,
            threadId: this.currentThreadId,
            conversationSummary: null,
            summaryMessageCount: 0,
            // Beads state fields
            beadsEpicId: null,
            beadsCurrentTaskId: null,
            beadsTaskCount: 0,
            beadsCompletedCount: 0,
            beadsReadyTaskIds: [],
            beadsPlanningComplete: false,
            executionVariables: {},
            variableSummary: [],
        };
    }

    // ============================================
    // Control Methods
    // ============================================

    stop() {
        log.info('Task stop requested');
        if (this.abortController) {
            this.abortController.abort();
            log.info('AbortController triggered');
        }
        this.isRunning = false;
    }

    isTaskRunning(): boolean {
        return this.isRunning;
    }

    getCurrentThreadId(): string | null {
        return this.currentThreadId;
    }

    setCurrentThreadId(threadId: string): void {
        this.currentThreadId = threadId;
        log.info('Thread ID set', { threadId });
    }

    resetSessionState(): void {
        log.info('Resetting session state', { threadId: this.currentThreadId });
    }

    getConfig(): AgentConfig {
        return this.config;
    }

    updateConfig(config: Partial<AgentConfig>) {
        this.config = { ...this.config, ...config };
    }

    setExecutionMode(mode: ExecutionMode) {
        this.config.executionMode = mode;
    }
}
