/**
 * Agent Graph
 * 
 * Main LangGraph StateGraph definition for the browser automation agent.
 * Uses a simple two-layer architecture:
 * - Planner: High-level task planning (doesn't know Playwright)
 * - CodeAct: Code generation and execution (knows Playwright API)
 * 
 * Flow: START → planner → codeact → planner → codeact → ... → end
 * CodeAct returns execution results directly to Planner.
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
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
import { 
  PersistentCheckpointer, 
  SqliteCheckpointer, 
  type ThreadMetadata,
  type CheckpointHistoryItem,
} from './checkpointer';
import { MemoryManager, SqliteMemoryStore } from './memory';
import type { MemoryContext } from './state';

// Create module logger for the graph
const log = createAgentLogger('Graph');

/**
 * Coerce a potentially serialized message to a proper BaseMessage instance.
 * This handles messages restored from checkpoints that are plain objects.
 */
function coerceToBaseMessage(msg: unknown): BaseMessage {
  // Already a proper BaseMessage instance
  if (msg instanceof BaseMessage) {
    return msg;
  }
  
  // Handle LangChain serialized format (from checkpoint)
  if (msg && typeof msg === 'object') {
    const obj = msg as Record<string, unknown>;
    
    // Check for lc_serializable format
    if (obj.lc_serializable && obj.lc_kwargs) {
      const kwargs = obj.lc_kwargs as Record<string, unknown>;
      const content = (kwargs.content as string) || '';
      const namespace = obj.lc_namespace as string[] | undefined;
      
      // Determine message type from namespace or structure
      if (namespace && namespace.includes('messages')) {
        // Check if it's an AIMessage (has tool_calls)
        if ('tool_calls' in kwargs || 'invalid_tool_calls' in kwargs) {
          return new AIMessage({ content });
        }
      }
      
      // Default to AIMessage for unknown serialized messages
      return new AIMessage({ content });
    }
    
    // Handle plain object with type indicator
    if ('type' in obj || '_type' in obj) {
      const msgType = (obj.type || obj._type) as string;
      const content = (obj.content as string) || '';
      
      switch (msgType) {
        case 'human':
          return new HumanMessage(content);
        case 'ai':
          return new AIMessage(content);
        case 'system':
          return new SystemMessage(content);
        default:
          return new AIMessage(content);
      }
    }
    
    // Last resort: if it has content, treat as AIMessage
    if ('content' in obj) {
      return new AIMessage((obj.content as string) || '');
    }
  }
  
  // Fallback: convert to string
  return new AIMessage(String(msg));
}

/**
 * Configuration for the agent graph
 */
export interface AgentGraphConfig {
  browserAdapter: IBrowserAdapter;
  llmConfig: PlannerNodeConfig & CodeActNodeConfig;
  agentConfig?: Partial<AgentConfig>;
  /** Path to memory database (enables long-term memory) */
  memoryDbPath?: string;
}

/**
 * Route function after planner node
 * 
 * Planner decides the next action:
 * 1. Give next instruction → go to codeact
 * 2. Complete task → end
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
  // No instruction - this shouldn't happen, end with error
  log.warn('Planner returned no instruction');
  return 'end';
}

/**
 * Creates the agent graph with Planner + CodeAct architecture
 * 
 * Graph flow:
 * START → planner → codeact → planner → codeact → ... → END
 */
export function createAgentGraph(graphConfig: AgentGraphConfig) {
  const { browserAdapter, llmConfig, agentConfig } = graphConfig;
  const config: AgentConfig = { ...DEFAULT_AGENT_CONFIG, ...agentConfig };

  // Create node functions
  const plannerNode = createPlannerNode(llmConfig);
  const codeActNode = createCodeActNode(browserAdapter, {
    ...llmConfig,
    mode: config.executionMode,
  });

  // Build the graph: planner ↔ codeact loop
  const graph = new StateGraph(AgentStateAnnotation)
    .addNode("planner", plannerNode)
    .addNode("codeact", codeActNode)
    .addEdge(START, "planner")
    .addEdge("codeact", "planner")
    .addConditionalEdges("planner", routeAfterPlanner, {
      codeact: "codeact",
      end: END,
    })

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
  private persistentCheckpointer: PersistentCheckpointer | null = null;
  private memoryManager: MemoryManager | null = null;

  constructor(graphConfig: AgentGraphConfig) {
    this.graph = createAgentGraph(graphConfig);
    this.browserAdapter = graphConfig.browserAdapter;
    this.config = { ...DEFAULT_AGENT_CONFIG, ...graphConfig.agentConfig };
    
    // Initialize memory manager if path provided
    if (graphConfig.memoryDbPath) {
      const memoryStore = new SqliteMemoryStore(graphConfig.memoryDbPath);
      this.memoryManager = new MemoryManager(memoryStore);
      log.info('Memory manager initialized', { dbPath: graphConfig.memoryDbPath });
    }
  }

  /**
   * Compile the graph with optional checkpointer
   */
  compile(checkpointer?: unknown) {
    // Check if it's a PersistentCheckpointer or SqliteCheckpointer
    if (checkpointer instanceof PersistentCheckpointer) {
      this.persistentCheckpointer = checkpointer;
      this.compiledGraph = this.graph.compile({
        checkpointer: checkpointer.getCheckpointer() as any,
      });
    } else if (checkpointer instanceof SqliteCheckpointer) {
      // Legacy support
      this.persistentCheckpointer = checkpointer as PersistentCheckpointer;
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

  /**
   * Create a new session/thread
   */
  createSession(name?: string, description?: string): ThreadMetadata | null {
    if (!this.persistentCheckpointer) {
      log.warn('No SQLite checkpointer configured, sessions not persisted');
      return null;
    }
    
    const threadId = `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return this.persistentCheckpointer.createThread(threadId, name, description);
  }

  /**
   * Get all sessions
   */
  listSessions(limit: number = 50): ThreadMetadata[] {
    if (!this.persistentCheckpointer) {
      return [];
    }
    return this.persistentCheckpointer.listThreads(limit);
  }

  /**
   * Get a specific session
   */
  getSession(threadId: string): ThreadMetadata | null {
    if (!this.persistentCheckpointer) {
      return null;
    }
    return this.persistentCheckpointer.getThread(threadId);
  }

  /**
   * Delete a session
   */
  deleteSession(threadId: string): boolean {
    if (!this.persistentCheckpointer) {
      return false;
    }
    return this.persistentCheckpointer.deleteThread(threadId);
  }

  /**
   * Update thread activity (message count)
   */
  private updateThreadActivity(threadId: string, messageCount: number): void {
    if (!this.persistentCheckpointer) return;
    this.persistentCheckpointer.updateThreadActivity(threadId, messageCount);
  }

  // ============================================
  // Checkpoint History Methods (LangGraph Native)
  // ============================================

  /**
   * Get checkpoint history for a thread
   * Uses LangGraph's native getStateHistory API
   */
  async getCheckpointHistory(threadId: string): Promise<CheckpointHistoryItem[]> {
    if (!this.compiledGraph) {
      throw new Error('Graph not compiled. Call compile() first.');
    }

    const history: CheckpointHistoryItem[] = [];
    
    try {
      const config = { configurable: { thread_id: threadId } };
      
      // Use getStateHistory to get all checkpoints
      for await (const snapshot of this.compiledGraph.getStateHistory(config)) {
        const checkpoint = this.snapshotToHistoryItem(threadId, snapshot);
        if (checkpoint) {
          history.push(checkpoint);
        }
      }
      
      log.debug('Retrieved checkpoint history', { threadId, count: history.length });
      return history;
    } catch (error) {
      log.warn('Failed to get checkpoint history', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Convert a LangGraph state snapshot to a CheckpointHistoryItem
   */
  private snapshotToHistoryItem(
    threadId: string, 
    snapshot: any
  ): CheckpointHistoryItem | null {
    try {
      const config = snapshot.config?.configurable || {};
      const checkpointId = config.checkpoint_id || config.thread_ts || '';
      const parentId = snapshot.parentConfig?.configurable?.checkpoint_id;
      
      // Extract metadata
      const metadata = snapshot.metadata || {};
      const step = metadata.step ?? 0;
      const source = metadata.source || 'unknown';
      const writes = metadata.writes;
      
      // Get values (state at this checkpoint)
      const values = snapshot.values || {};
      
      // Extract message preview from state
      const messages = values.messages || [];
      const lastMessage = messages[messages.length - 1];
      let messagePreview = '';
      let isUserMessage = false;
      
      if (lastMessage) {
        // Check if it's a user message (HumanMessage)
        isUserMessage = lastMessage._getType?.() === 'human' || 
                        lastMessage.type === 'human' ||
                        (lastMessage.lc_namespace && lastMessage.lc_namespace.includes('HumanMessage'));
        
        // Get content
        const content = typeof lastMessage.content === 'string' 
          ? lastMessage.content 
          : JSON.stringify(lastMessage.content);
        messagePreview = content.substring(0, 100);
      }
      
      // Try to get createdAt from checkpoint or use current time
      const createdAt = config.checkpoint_ts 
        ? new Date(config.checkpoint_ts).toISOString()
        : new Date().toISOString();
      
      return {
        checkpointId,
        threadId,
        parentCheckpointId: parentId,
        createdAt,
        step,
        metadata: {
          source,
          writes,
        },
        messagePreview,
        isUserMessage,
      };
    } catch (error) {
      log.debug('Failed to convert snapshot to history item', { error });
      return null;
    }
  }

  /**
   * Get state at a specific checkpoint
   */
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
        } 
      };
      
      const snapshot = await this.compiledGraph.getState(config);
      
      if (!snapshot || !snapshot.values) {
        return null;
      }
      
      const state = snapshot.values as Record<string, unknown>;
      
      // Restore Map types
      if (state.actionSignatures && (state.actionSignatures as any).__type === 'Map') {
        state.actionSignatures = new Map((state.actionSignatures as any).data);
      }
      
      // Restore BaseMessage instances from serialized format
      if (state.messages && Array.isArray(state.messages)) {
        state.messages = (state.messages as unknown[]).map(coerceToBaseMessage);
      }
      
      return state as Partial<AgentState>;
    } catch (error) {
      log.warn('Failed to get state at checkpoint', {
        threadId,
        checkpointId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Restore to a specific checkpoint and continue from there
   * Returns the restored state
   */
  async restoreToCheckpoint(
    threadId: string, 
    checkpointId: string
  ): Promise<Partial<AgentState> | null> {
    if (!this.compiledGraph) {
      throw new Error('Graph not compiled. Call compile() first.');
    }

    try {
      const state = await this.getStateAtCheckpoint(threadId, checkpointId);
      
      if (!state) {
        log.warn('Checkpoint not found for restore', { threadId, checkpointId });
        return null;
      }
      
      log.info('Restored to checkpoint', { 
        threadId, 
        checkpointId,
        messageCount: (state.messages as unknown[] | undefined)?.length || 0,
      });
      
      // Update the current thread ID for subsequent operations
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

  /**
   * Load the latest session state (most recent checkpoint)
   */
  async loadSessionState(threadId: string): Promise<Partial<AgentState> | null> {
    if (!this.compiledGraph) {
      return null;
    }

    try {
      const config = { configurable: { thread_id: threadId } };
      const snapshot = await this.compiledGraph.getState(config);
      
      if (!snapshot || !snapshot.values) {
        return null;
      }
      
      const state = snapshot.values as Record<string, unknown>;
      
      // Restore Map types
      if (state.actionSignatures && (state.actionSignatures as any).__type === 'Map') {
        state.actionSignatures = new Map((state.actionSignatures as any).data);
      }
      
      // Restore BaseMessage instances from serialized format
      if (state.messages && Array.isArray(state.messages)) {
        state.messages = (state.messages as unknown[]).map(coerceToBaseMessage);
      }
      
      return state as Partial<AgentState>;
    } catch (error) {
      log.warn('Failed to load session state', {
        threadId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Build memory context for a task
   */
  private async buildMemoryContext(goal: string): Promise<MemoryContext | null> {
    if (!this.memoryManager) {
      return null;
    }
    
    try {
      const context = await this.memoryManager.buildContextForTask(goal);
      
      return {
        userPreferences: context.userPrefs?.language 
          ? `Language: ${context.userPrefs.language}`
          : undefined,
        relevantFacts: context.relevantFacts.map(f => f.content),
        recentTasks: context.recentTasks
          .filter(t => t.success)
          .map(t => t.goal.substring(0, 50)),
        contextSummary: context.contextSummary || undefined,
      };
    } catch (error) {
      log.warn('Failed to build memory context', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Extract and save memories from task result
   */
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
        actionHistory: state.actionHistory.map(a => ({
          tool: a.tool,
          args: a.args,
          result: a.result ? { success: a.result.success } : undefined,
        })),
        observation: state.observation ? { url: state.observation.url } : undefined,
        threadId,
        duration,
      });
    } catch (error) {
      log.warn('Failed to extract memories', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }

  /**
   * Get memory manager (for external access)
   */
  getMemoryManager(): MemoryManager | null {
    return this.memoryManager;
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
   * @param goal - The task goal/instruction
   * @param threadId - Optional thread ID for session continuity
   * @param continueSession - If true, will load previous session state
   */
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
      // Try to load previous session state if continuing
      let previousState: Partial<AgentState> | null = null;
      if (continueSession && threadId) {
        previousState = await this.loadSessionState(threadId);
        if (previousState) {
          log.infoWithTrace(traceContext, 'Continuing previous session', {
            threadId,
            previousMessageCount: previousState.messages?.length || 0,
          });
        }
      }

      // Ensure thread exists in SQLite if using persistence
      // Only set the name when creating a new thread, not when continuing
      if (this.persistentCheckpointer) {
        const threadName = continueSession ? undefined : goal.substring(0, 50);
        this.persistentCheckpointer.createThread(this.currentThreadId, threadName);
      }

      // Build memory context from long-term memory
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

      // Build initial state, merging with previous state if continuing
      const initialState: Partial<AgentState> = {
        // Previous state (if continuing)
        ...(previousState || {}),
        // Current task state (override previous)
        goal,
        originalGoal: previousState?.originalGoal || goal,
        status: 'idle',
        iterationCount: 0,
        consecutiveFailures: 0,
        // Keep previous action history if continuing
        actionHistory: continueSession ? (previousState?.actionHistory || []) : [],
        // Keep previous messages if continuing
        messages: continueSession ? (previousState?.messages || []) : [],
        observation: null,
        previousObservation: null,
        plan: null,
        currentStepIndex: 0,
        completedSteps: continueSession ? (previousState?.completedSteps || []) : [],
        result: null,
        error: null,
        isComplete: false,
        actionSignatures: continueSession 
          ? (previousState?.actionSignatures || new Map()) 
          : new Map(),
        loopDetected: false,
        useFallbackRules: false,
        traceContext,
        currentInstruction: null,
        plannerThought: null,
        executionMode: this.config.executionMode,
        // Memory context
        memoryContext,
        threadId: this.currentThreadId,
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

      // Update thread activity for UI display
      // Note: Checkpointing is handled automatically by LangGraph SqliteSaver
      const messageCount = result.messages?.length || 0;
      this.updateThreadActivity(this.currentThreadId, messageCount);

      // Extract and save memories from task result
      const isSuccess = result.status === 'complete' && !result.error;
      await this.extractMemories(goal, isSuccess, result, this.currentThreadId, duration);
      
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
          memoryContext: null,
          threadId: this.currentThreadId,
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
   * @param goal - The task goal/instruction
   * @param threadId - Optional thread ID for session continuity
   * @param continueSession - If true, will load previous session state
   */
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

    // Track final state for saving
    let finalState: AgentState | null = null;

    try {
      // Try to load previous session state if continuing
      let previousState: Partial<AgentState> | null = null;
      if (continueSession && threadId) {
        previousState = await this.loadSessionState(threadId);
        if (previousState) {
          log.infoWithTrace(traceContext, 'Continuing previous session (stream)', {
            threadId,
            previousMessageCount: previousState.messages?.length || 0,
          });
        }
      }

      // Ensure thread exists in SQLite if using persistence
      // Only set the name when creating a new thread, not when continuing
      if (this.persistentCheckpointer) {
        const threadName = continueSession ? undefined : goal.substring(0, 50);
        this.persistentCheckpointer.createThread(this.currentThreadId, threadName);
      }

      // Build memory context from long-term memory
      const memoryContext = await this.buildMemoryContext(goal);

      log.infoWithTrace(traceContext, 'Starting streamed task', { 
        goal: goal.substring(0, 100),
        threadId: this.currentThreadId,
        mode: this.config.executionMode,
        continueSession,
        hasMemoryContext: !!memoryContext,
      });

      // Build initial state, merging with previous state if continuing
      const initialState: Partial<AgentState> = {
        // Previous state (if continuing)
        ...(previousState || {}),
        // Current task state (override previous)
        goal,
        originalGoal: previousState?.originalGoal || goal,
        status: 'idle',
        iterationCount: 0,
        consecutiveFailures: 0,
        // Keep previous action history if continuing
        actionHistory: continueSession ? (previousState?.actionHistory || []) : [],
        // Keep previous messages if continuing
        messages: continueSession ? (previousState?.messages || []) : [],
        observation: null,
        previousObservation: null,
        plan: null,
        currentStepIndex: 0,
        completedSteps: continueSession ? (previousState?.completedSteps || []) : [],
        result: null,
        error: null,
        isComplete: false,
        actionSignatures: continueSession 
          ? (previousState?.actionSignatures || new Map()) 
          : new Map(),
        loopDetected: false,
        useFallbackRules: false,
        traceContext,
        currentInstruction: null,
        plannerThought: null,
        executionMode: this.config.executionMode,
        // Memory context
        memoryContext,
        threadId: this.currentThreadId,
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
          
          // Track final state by merging events
          if (finalState) {
            finalState = { ...finalState, ...(state as AgentState) };
          } else {
            finalState = state as AgentState;
          }
          
          yield { node, state: state as Partial<AgentState>, traceContext };
        }
      }
      
      // Update thread activity and extract memories after completion
      // Note: Checkpointing is handled automatically by LangGraph SqliteSaver
      if (finalState && this.currentThreadId) {
        const messageCount = finalState.messages?.length || 0;
        this.updateThreadActivity(this.currentThreadId, messageCount);
        
        // Extract and save memories from task result
        const duration = Date.now() - startTime;
        const isSuccess = finalState.status === 'complete' && !finalState.error;
        await this.extractMemories(goal, isSuccess, finalState, this.currentThreadId, duration);
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
