/**
 * Unified Multimodal Orchestrator Graph
 *
 * A simplified, LLM-driven graph architecture that:
 * 1. Accepts multimodal input (text, images, audio, video)
 * 2. Uses an Orchestrator to decide which SubAgent to call
 * 3. Executes SubAgents in a loop until task completion
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │                                                             │
 *   │    START ──► Orchestrator ──► Executor ──► Orchestrator ──► │
 *   │                 │                              │            │
 *   │                 └──── (when complete) ─────────┴───► END    │
 *   │                                                             │
 *   └─────────────────────────────────────────────────────────────┘
 */

import { StateGraph, START, END } from '@langchain/langgraph';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { BaseCheckpointSaver } from '@langchain/langgraph-checkpoint';

import {
    AgentStateAnnotation,
    type AgentState,
    createInitialState,
    createOrchestratorNode,
    createExecutorNode,
    routeAfterOrchestrator,
    routeAfterExecutor,
} from './orchestrator';

import {
    type ISubAgentRegistry,
    createSubAgentRegistry,
    createArtifactManager,
    type ArtifactManager,
    type MultimodalMessage,
    createTextMessage,
} from './multimodal';

import {
    createCodeActSubAgent,
    createVisionSubAgent,
} from './subagents';

import {
    createTraceContext,
    createAgentLogger,
    type TraceContext,
} from './tracing';

const log = createAgentLogger('Graph');

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for the V3 Graph
 */
export interface GraphConfig {
    /** Browser adapter instance */
    browserAdapter: IBrowserAdapter;
    /** LLM API key */
    apiKey: string;
    /** LLM base URL */
    baseUrl?: string;
    /** LLM model */
    model?: string;
    /** Workspace path for artifacts */
    workspacePath?: string;
    /** Maximum orchestrator iterations */
    maxIterations?: number;
}

/**
 * Compiled graph instance
 */
export interface CompiledGraph {
    /** Execute a task and return the final state */
    executeTask(
        input: string | MultimodalMessage,
        options?: ExecuteOptions
    ): Promise<AgentState>;

    /** Stream execution events */
    streamTask(
        input: string | MultimodalMessage,
        options?: ExecuteOptions
    ): AsyncGenerator<GraphEvent, AgentState>;
}

/**
 * Execution options
 */
export interface ExecuteOptions {
    /** Thread ID for checkpointing */
    threadId?: string;
    /** Initial variables */
    variables?: Record<string, unknown>;
    /** Trace context */
    traceContext?: TraceContext;
}

/**
 * Events emitted during streaming execution
 */
export interface GraphEvent {
    /** Event type */
    type: 'orchestrator' | 'executor' | 'complete' | 'error';
    /** Current node name */
    node: string;
    /** State snapshot */
    state: Partial<AgentState>;
}

// ============================================================
// Graph Builder
// ============================================================

/**
 * Create the V3 Graph
 */
export function createGraph(config: GraphConfig): {
    graph: ReturnType<typeof buildGraph>;
    registry: ISubAgentRegistry;
    artifactManager: ArtifactManager;
    compile: (checkpointer?: BaseCheckpointSaver) => CompiledGraph;
} {
    // Create artifact manager
    const workspacePath = config.workspacePath || process.cwd();
    const artifactManager = createArtifactManager(workspacePath);

    // Create SubAgent registry and register default agents
    const registry = createSubAgentRegistry();
    registerDefaultSubAgents(registry, config);

    // Build the graph
    const graph = buildGraph(config, registry, artifactManager);

    // Return graph with compile function
    return {
        graph,
        registry,
        artifactManager,
        compile: (checkpointer?: BaseCheckpointSaver) => {
            const compiled = checkpointer
                ? graph.compile({ checkpointer })
                : graph.compile();

            return createCompiledWrapper(compiled, artifactManager);
        },
    };
}

/**
 * Register default SubAgents
 */
function registerDefaultSubAgents(
    registry: ISubAgentRegistry,
    config: GraphConfig
): void {
    // CodeAct for browser automation
    registry.register(createCodeActSubAgent());

    // Vision for image analysis
    registry.register(createVisionSubAgent());

    log.info('[GRAPH] SubAgents registered', {
        count: registry.getAll().length,
        agents: registry.getAll().map((a) => a.name),
    });
}

/**
 * Build the state graph
 */
function buildGraph(
    config: GraphConfig,
    registry: ISubAgentRegistry,
    artifactManager: ArtifactManager
) {
    // Create nodes
    const orchestratorNode = createOrchestratorNode({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        subAgentRegistry: registry,
        maxIterations: config.maxIterations,
    });

    const executorNode = createExecutorNode({
        subAgentRegistry: registry,
        browserAdapter: config.browserAdapter,
        artifactManager,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
    });

    // Build graph
    const graph = new StateGraph(AgentStateAnnotation)
        .addNode('orchestrator', orchestratorNode)
        .addNode('executor', executorNode)
        .addEdge(START, 'orchestrator')
        .addConditionalEdges('orchestrator', routeAfterOrchestrator, {
            executor: 'executor',
            end: END,
        })
        .addConditionalEdges('executor', routeAfterExecutor, {
            orchestrator: 'orchestrator',
        });

    return graph;
}

/**
 * Create a wrapper around the compiled graph
 */
function createCompiledWrapper(
    compiled: ReturnType<ReturnType<typeof buildGraph>['compile']>,
    artifactManager: ArtifactManager
): CompiledGraph {
    return {
        async executeTask(
            input: string | MultimodalMessage,
            options?: ExecuteOptions
        ): Promise<AgentState> {
            // Normalize input to MultimodalMessage
            const inputMessage: MultimodalMessage =
                typeof input === 'string'
                    ? createTextMessage(input, 'user')
                    : input;

            // Create trace context
            const traceContext =
                options?.traceContext || createTraceContext('graph');

            // Create initial state
            const initialState = createInitialState(
                inputMessage,
                undefined,
                traceContext
            );

            if (options?.variables) {
                initialState.executionVariables = options.variables;
            }

            log.infoWithTrace(traceContext, '[GRAPH] Starting execution', {
                goal: inputMessage.text?.substring(0, 100),
                threadId: options?.threadId,
            });

            // Execute graph
            const config = options?.threadId
                ? { configurable: { thread_id: options.threadId } }
                : undefined;

            const result = await compiled.invoke(initialState, config);

            log.infoWithTrace(traceContext, '[GRAPH] Execution complete', {
                isComplete: result.isComplete,
                status: result.status,
                artifactCount: result.artifacts?.length || 0,
            });

            return result as AgentState;
        },

        async *streamTask(
            input: string | MultimodalMessage,
            options?: ExecuteOptions
        ): AsyncGenerator<GraphEvent, AgentState> {
            // Normalize input
            const inputMessage: MultimodalMessage =
                typeof input === 'string'
                    ? createTextMessage(input, 'user')
                    : input;

            // Create trace context
            const traceContext =
                options?.traceContext || createTraceContext('graph');

            // Create initial state
            const initialState = createInitialState(
                inputMessage,
                undefined,
                traceContext
            );

            if (options?.variables) {
                initialState.executionVariables = options.variables;
            }

            // Stream graph execution
            const config = options?.threadId
                ? { configurable: { thread_id: options.threadId } }
                : undefined;

            let finalState: AgentState | null = null;

            for await (const event of await compiled.stream(
                initialState,
                config
            )) {
                // Extract node name and state from event
                const [nodeName, nodeState] = Object.entries(event)[0] as [
                    string,
                    Partial<AgentState>
                ];

                // Emit event
                yield {
                    type:
                        nodeName === 'orchestrator'
                            ? 'orchestrator'
                            : 'executor',
                    node: nodeName,
                    state: nodeState,
                };

                // Track final state
                if (nodeState) {
                    finalState = {
                        ...(finalState || {}),
                        ...nodeState,
                    } as AgentState;
                }
            }

            // Return final state
            if (!finalState) {
                throw new Error('No final state from graph execution');
            }

            return finalState;
        },
    };
}

// ============================================================
// Convenience Exports
// ============================================================

export {
    AgentStateAnnotation,
    type AgentState,
    type AgentStatus,
} from './orchestrator';

export {
    type MultimodalMessage,
    type ContentBlock,
    type ArtifactRef,
    createTextMessage,
    createMultimodalMessage,
} from './multimodal';

export {
    type ISubAgent,
    type ISubAgentRegistry,
    type SubAgentRequest,
    type SubAgentResult,
} from './multimodal';
