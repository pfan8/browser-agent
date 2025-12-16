/**
 * Agent Graph
 * 
 * Main LangGraph StateGraph definition for the browser automation agent.
 * Implements the ReAct pattern: Observe -> Think -> Act -> Observe...
 * 
 * Supports:
 * - RA-05: Loop termination on completion or max iterations
 * - RA-06: Infinite loop detection via action signature tracking
 * - RA-07: Consecutive failure handling with replan trigger
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { 
  AgentStateAnnotation, 
  type AgentState, 
  type AgentConfig, 
  DEFAULT_AGENT_CONFIG,
  buildFailureReport 
} from './state';
import { createObserveNode, createThinkNode, createActNode, type ThinkNodeConfig } from './nodes';

/**
 * Configuration for the agent graph
 */
export interface AgentGraphConfig {
  browserAdapter: IBrowserAdapter;
  tools: StructuredToolInterface[];
  llmConfig: ThinkNodeConfig;
  agentConfig?: Partial<AgentConfig>;
}

/**
 * Route function after observe node (RA-01)
 */
function routeAfterObserve(state: AgentState): string {
  // Check for errors
  if (state.status === 'error') {
    return 'end';
  }

  // Check for completion (RA-05)
  if (state.isComplete) {
    return 'end';
  }

  // RA-06: Check for detected loop
  if (state.loopDetected) {
    console.log('[Graph] Loop detected, terminating');
    return 'end';
  }

  // Continue to think
  return 'think';
}

/**
 * Route function after think node (RA-02)
 */
function routeAfterThink(state: AgentState): string {
  // Check for errors
  if (state.status === 'error') {
    return 'end';
  }

  // Check for completion (RA-05)
  if (state.isComplete) {
    return 'end';
  }

  // RA-06: Check for detected loop
  if (state.loopDetected) {
    console.log('[Graph] Loop detected in think, terminating');
    return 'end';
  }

  // Get latest action
  const latestAction = state.actionHistory[state.actionHistory.length - 1];
  
  // If no action or action already has result, go back to observe
  if (!latestAction || latestAction.result) {
    return 'observe';
  }

  // Continue to act
  return 'act';
}

/**
 * Route function after act node (RA-03, RA-04)
 */
function routeAfterAct(state: AgentState, config: AgentConfig): string {
  // Check for errors
  if (state.status === 'error') {
    return 'end';
  }

  // Check for completion (RA-05)
  if (state.isComplete) {
    return 'end';
  }

  // RA-05: Check max iterations
  if (state.iterationCount >= config.maxIterations) {
    console.log('[Graph] Max iterations reached:', state.iterationCount);
    return 'end';
  }

  // RA-07: Check consecutive failures
  if (state.consecutiveFailures >= config.maxConsecutiveFailures) {
    console.log('[Graph] Max consecutive failures reached:', state.consecutiveFailures);
    return 'end';
  }

  // RA-06: Check for detected loop
  if (state.loopDetected) {
    console.log('[Graph] Loop detected after action, terminating');
    return 'end';
  }

  // Continue observing
  return 'observe';
}

/**
 * Build terminal state with failure report (ER-06)
 */
function buildTerminalState(state: AgentState, reason: string): Partial<AgentState> {
  const report = buildFailureReport(state);
  return {
    status: 'error',
    error: reason,
    result: report,
    isComplete: true,
  };
}

/**
 * Creates the agent graph
 */
export function createAgentGraph(graphConfig: AgentGraphConfig) {
  const { browserAdapter, tools, llmConfig, agentConfig } = graphConfig;
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...agentConfig };

  // Create node functions
  const observeNode = createObserveNode(browserAdapter);
  const thinkNode = createThinkNode(llmConfig, tools);
  const actNode = createActNode(browserAdapter, tools);

  // Build the graph
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("observe", observeNode)
    .addNode("think", thinkNode)
    .addNode("act", actNode)
    .addEdge(START, "observe")
    .addConditionalEdges("observe", routeAfterObserve, {
      think: "think",
      end: END,
    })
    .addConditionalEdges("think", routeAfterThink, {
      act: "act",
      observe: "observe",
      end: END,
    })
    .addConditionalEdges("act", (state) => routeAfterAct(state, config), {
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
    return this;
  }

  /**
   * Execute a task (RA-*, MS-*)
   */
  async executeTask(goal: string, threadId?: string): Promise<AgentState> {
    if (!this.compiledGraph) {
      throw new Error('Graph not compiled. Call compile() first.');
    }

    if (this.isRunning) {
      throw new Error('Agent is already running a task');
    }

    this.isRunning = true;
    this.currentThreadId = threadId || `thread_${Date.now()}`;

    try {
      console.log(`[BrowserAgent] Starting task: ${goal}`);

      // Initialize state with all fields for RA/MS support
      const initialState: Partial<AgentState> = {
        goal,
        originalGoal: goal, // SA-05: preserve original context
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
        // RA-06: Loop detection state
        actionSignatures: new Map(),
        loopDetected: false,
        // RA-08: Fallback flag
        useFallbackRules: false,
      };

      const config = {
        configurable: {
          thread_id: this.currentThreadId,
        },
      };

      // Run the graph
      const result = await this.compiledGraph.invoke(initialState, config);

      console.log(`[BrowserAgent] Task completed with status: ${result.status}`);
      
      // If the task ended with an error and doesn't have a user-friendly result,
      // generate a failure report
      if (result.status === 'error' && !result.result) {
        const report = buildFailureReport(result);
        return {
          ...result,
          result: report,
          isComplete: true,
        };
      }
      
      return result;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stream task execution (RA-*, MS-*)
   */
  async *streamTask(goal: string, threadId?: string): AsyncGenerator<{ node: string; state: Partial<AgentState> }> {
    if (!this.compiledGraph) {
      throw new Error('Graph not compiled. Call compile() first.');
    }

    if (this.isRunning) {
      throw new Error('Agent is already running a task');
    }

    this.isRunning = true;
    this.currentThreadId = threadId || `thread_${Date.now()}`;

    try {
      console.log(`[BrowserAgent] Starting streamed task: ${goal}`);

      // Initialize state with all fields for RA/MS support
      const initialState: Partial<AgentState> = {
        goal,
        originalGoal: goal, // SA-05: preserve original context
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
        // RA-06: Loop detection state
        actionSignatures: new Map(),
        loopDetected: false,
        // RA-08: Fallback flag
        useFallbackRules: false,
      };

      const config = {
        configurable: {
          thread_id: this.currentThreadId,
        },
      };

      // Stream the graph execution
      for await (const event of await this.compiledGraph.stream(initialState, config)) {
        for (const [node, state] of Object.entries(event)) {
          yield { node, state: state as Partial<AgentState> };
        }
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop the current task
   */
  stop() {
    // TODO: Implement proper cancellation with LangGraph
    this.isRunning = false;
    console.log('[BrowserAgent] Task stop requested');
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
}

