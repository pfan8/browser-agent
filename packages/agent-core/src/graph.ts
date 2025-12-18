/**
 * Agent Graph
 * 
 * Main LangGraph StateGraph definition for the browser automation agent.
 * Uses a two-layer architecture:
 * - Planner: High-level task planning (doesn't know Playwright)
 * - CodeAct: Code generation and execution (knows Playwright API)
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import { 
  AgentStateAnnotation, 
  type AgentState, 
  type AgentConfig, 
  DEFAULT_AGENT_CONFIG,
  buildFailureReport,
  type ExecutionMode,
} from './state';
import { createPlannerNode, type PlannerNodeConfig } from './planner';
import { createCodeActNode, type CodeActNodeConfig } from './codeact';
import { 
  createTraceContext, 
  createAgentLogger, 
  setTraceContext,
  type TraceContext,
} from './tracing';

// Create module logger for the graph
const log = createAgentLogger('Graph');

/**
 * Configuration for the agent graph
 */
export interface AgentGraphConfig {
  browserAdapter: IBrowserAdapter;
  llmConfig: PlannerNodeConfig & CodeActNodeConfig;
  agentConfig?: Partial<AgentConfig>;
}

/**
 * Observe node - captures browser state via runCode
 */
function createObserveNode(browserAdapter: IBrowserAdapter) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const traceContext = state.traceContext;
    
    log.debugWithTrace(traceContext!, 'Capturing browser state', {
      iteration: state.iterationCount,
    });

    try {
      // Get page state via runCode
      const result = await browserAdapter.runCode(`
        return {
          url: page.url(),
          title: await page.title(),
          content: await page.content().then(c => c.slice(0, 10000)),
          loadState: await page.evaluate(() => document.readyState),
        };
      `);

      if (!result.success) {
        log.warn('Failed to capture browser state', { error: result.error });
        return {
          observation: {
            timestamp: new Date().toISOString(),
            url: 'unknown',
            title: 'unknown',
            error: result.error,
          },
          status: 'observing',
        };
      }

      const data = result.result as {
        url: string;
        title: string;
        content: string;
        loadState: string;
      };

      // Log detailed observation context for tracing
      log.infoWithTrace(traceContext!, '[OBSERVE] Context captured', {
        url: data.url,
        title: data.title,
        loadState: data.loadState,
        contentLength: data.content?.length || 0,
        contentPreview: data.content?.slice(0, 200) + (data.content?.length > 200 ? '...' : ''),
      });

      return {
        observation: {
          timestamp: new Date().toISOString(),
          url: data.url,
          title: data.title,
          content: data.content,
          loadState: data.loadState as any,
        },
        status: 'observing',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.error('Observe failed', { error: errorMessage });
      return {
        observation: {
          timestamp: new Date().toISOString(),
          url: 'error',
          title: 'error',
          error: errorMessage,
        },
        status: 'error',
        error: errorMessage,
      };
    }
  };
}

/**
 * Route function after observe node
 */
function routeAfterObserve(state: AgentState): string {
  if (state.status === 'error') {
    return 'end';
  }
  if (state.isComplete) {
    return 'end';
  }
  if (state.loopDetected) {
    log.warn('Loop detected, terminating');
    return 'end';
  }
  return 'planner';
}

/**
 * Route function after planner node
 */
function routeAfterPlanner(state: AgentState): string {
  if (state.status === 'error') {
    return 'end';
  }
  if (state.isComplete) {
    return 'end';
  }
  // If planner decided next step, go to codeact
  if ((state as any).currentInstruction) {
    return 'codeact';
  }
  // Otherwise observe again
  return 'observe';
}

/**
 * Route function after codeact node
 */
function routeAfterCodeAct(state: AgentState, config: AgentConfig): string {
  if (state.status === 'error') {
    // Check if we should retry or give up
    if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
      log.warn('Max consecutive failures reached');
      return 'end';
    }
    // Try again with observe
    return 'observe';
  }
  if (state.isComplete) {
    return 'end';
  }
  if (state.iterationCount >= config.maxIterations) {
    log.warn('Max iterations reached', { iterationCount: state.iterationCount });
    return 'end';
  }
  if (state.loopDetected) {
    log.warn('Loop detected after action');
    return 'end';
  }
  // Go back to observe for next cycle
  return 'observe';
}

/**
 * Creates the agent graph with Planner + CodeAct architecture
 */
export function createAgentGraph(graphConfig: AgentGraphConfig) {
  const { browserAdapter, llmConfig, agentConfig } = graphConfig;
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...agentConfig };

  // Create node functions
  const observeNode = createObserveNode(browserAdapter);
  const plannerNode = createPlannerNode(llmConfig);
  const codeActNode = createCodeActNode(browserAdapter, {
    ...llmConfig,
    mode: config.executionMode,
  });

  // Build the graph
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("observe", observeNode)
    .addNode("planner", plannerNode)
    .addNode("codeact", codeActNode)
    .addEdge(START, "observe")
    .addConditionalEdges("observe", routeAfterObserve, {
      planner: "planner",
      end: END,
    })
    .addConditionalEdges("planner", routeAfterPlanner, {
      codeact: "codeact",
      observe: "observe",
      end: END,
    })
    .addConditionalEdges("codeact", (state) => routeAfterCodeAct(state, config), {
      observe: "observe",
      end: END,
    });

  return graph;
}

/**
 * Agent class that wraps the compiled graph
 */
export class BrowserAgent {
  private graph: ReturnType<typeof createAgentGraph>;
  private compiledGraph: ReturnType<ReturnType<typeof createAgentGraph>['compile']> | null = null;
  private browserAdapter: IBrowserAdapter;
  private config: AgentConfig;
  private isRunning: boolean = false;
  private currentThreadId: string | null = null;
  private abortController: AbortController | null = null;

  constructor(graphConfig: AgentGraphConfig) {
    this.graph = createAgentGraph(graphConfig);
    this.browserAdapter = graphConfig.browserAdapter;
    this.config = { ...DEFAULT_AGENT_CONFIG, ...graphConfig.agentConfig };
  }

  /**
   * Compile the graph with optional checkpointer
   */
  compile(checkpointer?: unknown) {
    this.compiledGraph = this.graph.compile({
      checkpointer: checkpointer as any,
    });
    
    log.info('Graph compiled', { 
      maxIterations: this.config.maxIterations,
    });
    
    return this;
  }

  /**
   * Get runtime config for graph execution
   * 
   * Sets recursionLimit based on maxIterations to ensure our iteration check
   * triggers before LangGraph's internal limit.
   * Each iteration = 3 nodes (observe + planner + codeact), plus buffer for retries.
   */
  private getGraphConfig(threadId: string, signal?: AbortSignal) {
    // Calculate recursion limit: maxIterations * 3 nodes per cycle + buffer for retries
    const recursionLimit = (this.config.maxIterations * 3) + 10;
    
    return {
      configurable: {
        thread_id: threadId,
      },
      recursionLimit,
      signal,
    };
  }

  /**
   * Execute a task
   */
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

      const initialState: Partial<AgentState> = {
        goal,
        originalGoal: goal,
        status: 'idle',
        iterationCount: 0,
        consecutiveFailures: 0,
        actionHistory: [],
        messages: [],
        observation: null,
        previousObservation: null,
        plan: null,
        currentStepIndex: 0,
        completedSteps: [],
        result: null,
        error: null,
        isComplete: false,
        actionSignatures: new Map(),
        loopDetected: false,
        useFallbackRules: false,
        traceContext,
        currentInstruction: null,
        plannerThought: null,
        executionMode: this.config.executionMode,
      };

      const graphConfig = this.getGraphConfig(
        this.currentThreadId,
        this.abortController?.signal
      );

      const result = await this.compiledGraph.invoke(initialState, graphConfig);

      const duration = Date.now() - startTime;
      log.infoWithTrace(traceContext, 'Task completed', { 
        status: result.status,
        duration,
        iterationCount: result.iterationCount,
        actionCount: result.actionHistory?.length || 0,
      });
      
      if (result.status === 'error' && !result.result) {
        const report = buildFailureReport(result);
        return {
          ...result,
          result: report,
          isComplete: true,
        };
      }
      
      return result;
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        log.infoWithTrace(traceContext, 'Task aborted by user');
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
        };
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

  /**
   * Stream task execution
   */
  async *streamTask(goal: string, threadId?: string): AsyncGenerator<{ 
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

      const initialState: Partial<AgentState> = {
        goal,
        originalGoal: goal,
        status: 'idle',
        iterationCount: 0,
        consecutiveFailures: 0,
        actionHistory: [],
        messages: [],
        observation: null,
        previousObservation: null,
        plan: null,
        currentStepIndex: 0,
        completedSteps: [],
        result: null,
        error: null,
        isComplete: false,
        actionSignatures: new Map(),
        loopDetected: false,
        useFallbackRules: false,
        traceContext,
        currentInstruction: null,
        plannerThought: null,
        executionMode: this.config.executionMode,
      };

      const graphConfig = this.getGraphConfig(
        this.currentThreadId,
        this.abortController?.signal
      );

      for await (const event of await this.compiledGraph.stream(initialState, graphConfig)) {
        if (this.abortController?.signal.aborted) {
          log.infoWithTrace(traceContext, 'Task aborted by user');
          yield { 
            node: '__abort__', 
            state: { 
              status: 'error', 
              error: 'Task stopped by user', 
              isComplete: true 
            }, 
            traceContext 
          };
          return;
        }
        
        for (const [node, state] of Object.entries(event)) {
          log.debugWithTrace(traceContext, `Node completed: ${node}`, {
            status: (state as Partial<AgentState>).status,
          });
          yield { node, state: state as Partial<AgentState>, traceContext };
        }
      }
      
      const duration = Date.now() - startTime;
      log.infoWithTrace(traceContext, 'Streamed task completed', { duration });
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        log.infoWithTrace(traceContext, 'Streamed task aborted by user');
        yield { 
          node: '__abort__', 
          state: { 
            status: 'error', 
            error: 'Task stopped by user', 
            result: '任务已被用户停止',
            isComplete: true 
          }, 
          traceContext 
        };
        return;
      }
      const duration = Date.now() - startTime;
      log.errorWithTrace(traceContext, 'Streamed task failed with exception', { 
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

  /**
   * Stop the current task
   */
  stop() {
    log.info('Task stop requested');
    if (this.abortController) {
      this.abortController.abort();
      log.info('AbortController triggered');
    }
    this.isRunning = false;
  }

  /**
   * Check if agent is running
   */
  isTaskRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current thread ID
   */
  getCurrentThreadId(): string | null {
    return this.currentThreadId;
  }

  /**
   * Get the config
   */
  getConfig(): AgentConfig {
    return this.config;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<AgentConfig>) {
    this.config = { ...this.config, ...config };
  }

  /**
   * Set execution mode
   */
  setExecutionMode(mode: ExecutionMode) {
    this.config.executionMode = mode;
  }
}
