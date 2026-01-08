/**
 * Browser Agent
 *
 * Main agent class that wraps the LangGraph compiled graph.
 * Handles task execution for browser automation.
 *
 * Uses the unified multimodal orchestrator architecture.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import {
    type AgentConfig,
    DEFAULT_AGENT_CONFIG,
    type ExecutionMode,
} from './state';
import {
    createTraceContext,
    createAgentLogger,
    setTraceContext,
    type TraceContext,
} from './tracing';
import {
    createGraph,
    type GraphConfig,
    type CompiledGraph,
    type GraphEvent,
} from './graph';
import { type AgentState } from './orchestrator';
import { createTextMessage } from './multimodal';

const log = createAgentLogger('BrowserAgent');

/**
 * Configuration for BrowserAgent
 */
export interface BrowserAgentConfig {
    browserAdapter: IBrowserAdapter;
    llmConfig: {
        apiKey: string;
        baseUrl?: string;
        model?: string;
    };
    agentConfig?: Partial<AgentConfig>;
    beadsClient?: unknown; // Optional beads client (currently not used by graph)
}

/**
 * Agent class that wraps the compiled graph
 *
 * Uses the unified multimodal orchestrator architecture.
 */
export class BrowserAgent {
    private compiledGraph: CompiledGraph | null = null;
    private browserAdapter: IBrowserAdapter;
    private config: AgentConfig;
    private graphConfig: GraphConfig;
    private isRunning: boolean = false;
    private currentThreadId: string | null = null;
    private abortController: AbortController | null = null;

    constructor(agentConfig: BrowserAgentConfig) {
        this.browserAdapter = agentConfig.browserAdapter;
        this.config = { ...DEFAULT_AGENT_CONFIG, ...agentConfig.agentConfig };

        this.graphConfig = {
            browserAdapter: agentConfig.browserAdapter,
            apiKey: agentConfig.llmConfig.apiKey,
            baseUrl: agentConfig.llmConfig.baseUrl,
            model: agentConfig.llmConfig.model,
            maxIterations: this.config.maxIterations,
        };

        log.info('BrowserAgent initialized');
    }

    /**
     * Check if agent is using Beads mode (deprecated)
     */
    isBeadsMode(): boolean {
        return false;
    }

    /**
     * Compile the graph
     */
    compile() {
        const { compile } = createGraph(this.graphConfig);
        this.compiledGraph = compile();

        log.info('Graph compiled', {
            maxIterations: this.config.maxIterations,
        });

        return this;
    }

    // ============================================
    // Graph Execution
    // ============================================

    async executeTask(goal: string, threadId?: string): Promise<AgentState> {
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
            log.infoWithTrace(traceContext, 'Starting task', {
                goal: goal.substring(0, 100),
                threadId: this.currentThreadId,
                mode: this.config.executionMode,
            });

            const result = await this.compiledGraph.executeTask(goal, {
                threadId: this.currentThreadId,
                traceContext,
            });

            const duration = Date.now() - startTime;
            log.infoWithTrace(traceContext, 'Task completed', {
                status: result.status,
                duration,
                iterationCount: result.iterationCount,
            });

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
        threadId?: string
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

        try {
            log.infoWithTrace(traceContext, 'Starting streamed task', {
                goal: goal.substring(0, 100),
                threadId: this.currentThreadId,
                mode: this.config.executionMode,
            });

            for await (const event of this.compiledGraph.streamTask(goal, {
                threadId: this.currentThreadId,
                traceContext,
            })) {
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

                yield {
                    node: event.node,
                    state: event.state,
                    traceContext,
                };
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

    private buildAbortedState(
        goal: string,
        traceContext: TraceContext
    ): AgentState {
        return {
            inputMessage: createTextMessage(goal, 'user'),
            goal,
            status: 'error',
            error: 'Task stopped by user',
            result: '任务已被用户停止',
            isComplete: true,
            pendingSubAgentRequest: undefined,
            lastSubAgentResult: undefined,
            iterationCount: 0,
            outputMessages: [],
            artifacts: [],
            executionVariables: {},
            messages: [],
            traceContext,
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
