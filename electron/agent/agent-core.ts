/**
 * Agent Core
 * 
 * Main orchestration layer that coordinates:
 * - ReactAgent: ReAct-style execution with CodeAct integration (new)
 * - High-Level Planner: Task decomposition (legacy)
 * - Low-Level Executor: Step execution (legacy)
 * - Memory Management: Conversation and working memory
 * - Checkpoint Management: State persistence
 * 
 * The agent supports two execution modes:
 * - 'react': Uses ReactAgent with dynamic decision making and CodeAct support
 * - 'plan-execute': Uses the legacy HighLevelPlanner + LowLevelExecutor
 */

import { EventEmitter } from 'events';
import type {
  AgentState,
  AgentStatus,
  AgentConfig,
  TaskPlan,
  Observation,
  AgentEvent,
  Session,
  ReActAction,
} from './types';
import { 
  createEmptyState, 
  deserializeState,
  DEFAULT_AGENT_CONFIG,
} from './types';
import { MemoryManager } from './memory/memory-manager';
import { CheckpointManager } from './checkpoint/checkpoint-manager';
import { SessionStore, sessionStore } from './checkpoint/session-store';
import { HighLevelPlanner } from './high-level-planner';
import { LowLevelExecutor } from './low-level-executor';
import { ReactAgent } from './react-agent';
import { toolRegistry } from './tools/tool-registry';
import { registerBrowserTools } from './tools/browser-tools';
import { createLogger } from '../utils/logger';

// Create module logger
const log = createLogger('AgentCore');

/**
 * Execution mode for the agent
 */
export type ExecutionMode = 'react' | 'plan-execute';

export interface AgentCoreConfig extends Partial<AgentConfig> {
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  /** Execution mode: 'react' (default) or 'plan-execute' (legacy) */
  executionMode?: ExecutionMode;
}

export class AgentCore extends EventEmitter {
  private config: AgentConfig;
  private state: AgentState;
  private memoryManager: MemoryManager;
  private checkpointManager: CheckpointManager;
  private sessionStore: SessionStore;
  private planner: HighLevelPlanner;
  private executor: LowLevelExecutor;
  private reactAgent: ReactAgent;
  private executionMode: ExecutionMode;
  private isRunning: boolean = false;
  private shouldStop: boolean = false;

  constructor(config?: AgentCoreConfig) {
    super();
    
    this.config = { ...DEFAULT_AGENT_CONFIG, ...config };
    this.state = createEmptyState();
    this.memoryManager = new MemoryManager(this.state.memory);
    this.sessionStore = sessionStore;
    this.checkpointManager = new CheckpointManager(this.sessionStore, this.config);
    this.executionMode = config?.executionMode || 'react'; // Default to ReAct mode

    // Initialize planner (legacy)
    this.planner = new HighLevelPlanner(
      this.memoryManager,
      {
        llmModel: this.config.llmModel,
        maxStepsPerPlan: 10,
        maxReplanAttempts: 3,
      },
      config?.anthropicApiKey,
      config?.anthropicBaseUrl
    );

    // Initialize executor (legacy)
    this.executor = new LowLevelExecutor(this.memoryManager, {
      maxRetries: this.config.maxStepRetries,
      stepTimeout: this.config.stepTimeout,
      observationTimeout: this.config.observationTimeout,
      enableScreenshots: this.config.enableScreenshots,
      enableDomSnapshots: this.config.enableDomSnapshots,
    });

    // Initialize ReactAgent (new)
    this.reactAgent = new ReactAgent(this.memoryManager, {
      anthropicApiKey: config?.anthropicApiKey,
      anthropicBaseUrl: config?.anthropicBaseUrl,
      llmModel: this.config.llmModel,
      maxIterations: 20,
      maxConsecutiveFailures: 3,
      enableCodeAct: true,
      enableScreenshots: this.config.enableScreenshots,
      enableDomSnapshots: this.config.enableDomSnapshots,
    });

    // Forward executor events (legacy)
    this.executor.on('event', (event: AgentEvent) => this.emit('event', event));
    this.executor.on('step_started', (data) => this.emitEvent('step_started', data));
    this.executor.on('step_completed', (data) => this.emitEvent('step_completed', data));
    this.executor.on('step_failed', (data) => this.emitEvent('step_failed', data));
    this.executor.on('thinking', (data) => this.emitEvent('thinking', data));

    // Forward planner events (legacy)
    this.planner.on('replanned', (data) => this.emitEvent('plan_updated', data));

    // Forward ReactAgent events (new)
    this.setupReactAgentEvents();

    // Register browser tools
    registerBrowserTools();
  }

  /**
   * Setup event forwarding from ReactAgent
   */
  private setupReactAgentEvents(): void {
    this.reactAgent.on('event', (event: AgentEvent) => this.emit('event', event));
    
    this.reactAgent.on('react_iteration_started', (data) => {
      this.emitEvent('react_iteration_started', data);
    });
    
    this.reactAgent.on('react_thinking', (data) => {
      this.emitEvent('thinking', data);
    });
    
    this.reactAgent.on('react_action_started', (data) => {
      this.emitEvent('step_started', { step: { description: `${data.tool}`, tool: data.tool } });
    });
    
    this.reactAgent.on('react_action_completed', (data) => {
      const action = data.action as ReActAction;
      this.emitEvent('step_completed', { 
        step: { description: action.thought, tool: action.tool },
        result: action.result 
      });
    });
    
    this.reactAgent.on('react_action_failed', (data) => {
      const action = data.action as ReActAction;
      this.emitEvent('step_failed', { 
        step: { description: action.thought, tool: action.tool },
        error: data.error 
      });
    });
    
    this.reactAgent.on('react_completed', (data) => {
      if (data.success) {
        this.emitEvent('task_completed', data);
      } else {
        this.emitEvent('task_failed', data);
      }
    });
    
    this.reactAgent.on('codeact_triggered', (data) => {
      this.emitEvent('codeact_triggered', data);
    });
    
    this.reactAgent.on('codeact_executing', (data) => {
      this.emitEvent('codeact_executing', data);
    });
    
    this.reactAgent.on('codeact_completed', (data) => {
      this.emitEvent('codeact_completed', data);
    });
    
    this.reactAgent.on('codeact_failed', (data) => {
      this.emitEvent('codeact_failed', data);
    });
  }

  // ============================================
  // Session Management
  // ============================================

  /**
   * Create a new session
   */
  createSession(name: string, description?: string): Session {
    const session = this.sessionStore.createSession(name, description);
    this.state = deserializeState(session.state);
    this.memoryManager = new MemoryManager(this.state.memory);
    this.checkpointManager.setSession(session.id);
    
    this.emitEvent('status_changed', { status: 'idle', sessionId: session.id });
    return session;
  }

  /**
   * Load an existing session
   */
  loadSession(sessionId: string): boolean {
    const session = this.sessionStore.loadSession(sessionId);
    if (!session) {
      return false;
    }

    this.state = deserializeState(session.state);
    this.memoryManager = new MemoryManager(this.state.memory);
    this.checkpointManager.setSession(sessionId);
    
    this.emitEvent('status_changed', { status: this.state.status, sessionId });
    return true;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.checkpointManager.getCurrentSessionId();
  }

  /**
   * List all sessions
   */
  listSessions() {
    return this.sessionStore.listSessions();
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    return this.sessionStore.deleteSession(sessionId);
  }

  // ============================================
  // Task Execution
  // ============================================

  /**
   * Execute a task (main entry point)
   * Uses ReactAgent (default) or legacy Plan-Execute based on executionMode
   */
  async executeTask(task: string): Promise<{
    success: boolean;
    plan?: TaskPlan;
    actions?: ReActAction[];
    error?: string;
    result?: unknown; // Task completion summary
  }> {
    log.info(`executeTask called: "${task.substring(0, 100)}"`);
    log.debug(`Execution mode: ${this.executionMode}`);
    
    if (this.isRunning) {
      log.warn('Agent is already running, rejecting task');
      return { success: false, error: 'Agent is already running a task' };
    }

    // Ensure we have a session
    if (!this.checkpointManager.getCurrentSessionId()) {
      this.createSession(`Task: ${task.slice(0, 30)}...`);
    }

    // Add user message to conversation
    this.memoryManager.addMessage('user', task);
    this.state.currentTask = task;

    // Route to appropriate execution mode
    if (this.executionMode === 'react') {
      log.debug('Routing to ReactAgent...');
      return this.executeTaskReact(task);
    } else {
      log.debug('Routing to Plan-Execute mode...');
      return this.executeTaskPlanExecute(task);
    }
  }

  /**
   * Execute task using ReactAgent (new mode)
   */
  private async executeTaskReact(task: string): Promise<{
    success: boolean;
    plan?: TaskPlan;
    actions?: ReActAction[];
    error?: string;
    result?: unknown;
  }> {
    log.debug('executeTaskReact starting...');
    this.isRunning = true;
    this.shouldStop = false;
    this.setStatus('executing');

    try {
      // Create initial checkpoint
      this.checkpointManager.createCheckpoint(
        this.state,
        'Task started',
        `Goal: ${task}`
      );

      // Execute with ReactAgent
      log.debug('Calling reactAgent.execute()...');
      const result = await this.reactAgent.execute(task, {
        sessionId: this.state.sessionId,
      });
      log.info('ReactAgent result:', { success: result.success, error: result.error, actionsCount: result.actions?.length });

      // Finalize
      if (result.success) {
        this.setStatus('complete');
        const successMessage = result.result ? String(result.result) : `Task completed successfully: ${task}`;
        this.memoryManager.addMessage('agent', successMessage);
      } else {
        this.setStatus('error');
        // Include the full summary in the message
        const failureMessage = result.result 
          ? String(result.result) 
          : `Task failed: ${result.error || 'Unknown error'}`;
        this.memoryManager.addMessage('agent', failureMessage);
        log.info('Task failure summary:', failureMessage);
      }

      // Save final state
      this.checkpointManager.saveState(this.state);

      return {
        success: result.success,
        actions: result.actions,
        error: result.error,
        result: result.result, // Include the summary
      };
    } catch (error) {
      this.setStatus('error');
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error('executeTaskReact error:', errorMsg);
      this.memoryManager.addMessage('agent', `Error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute task using Plan-Execute (legacy mode)
   */
  private async executeTaskPlanExecute(task: string): Promise<{
    success: boolean;
    plan?: TaskPlan;
    error?: string;
  }> {
    this.isRunning = true;
    this.shouldStop = false;
    this.setStatus('planning');

    try {
      // 1. Get initial observation
      const observation = await this.observe();

      // 2. Create plan
      this.emitEvent('status_changed', { status: 'planning' });
      const planResult = await this.planner.createPlan(task, observation, {
        sessionId: this.state.sessionId,
      });

      if (!planResult.success || !planResult.plan) {
        this.setStatus('error');
        this.memoryManager.addMessage('agent', `Failed to create plan: ${planResult.error}`);
        return { success: false, error: planResult.error };
      }

      this.state.plan = planResult.plan;
      this.emitEvent('plan_created', { plan: planResult.plan });

      // Create initial checkpoint
      this.checkpointManager.createCheckpoint(
        this.state,
        'Plan created',
        `Goal: ${task}`
      );

      // 3. Execute plan
      const success = await this.executePlan(planResult.plan);

      // 4. Finalize
      if (success) {
        this.setStatus('complete');
        this.memoryManager.addMessage('agent', `Task completed successfully: ${task}`);
        this.emitEvent('task_completed', { task, plan: this.state.plan });
      } else {
        this.setStatus('error');
        this.memoryManager.addMessage('agent', `Task failed: ${task}`);
        this.emitEvent('task_failed', { task, plan: this.state.plan, error: 'Execution failed' });
      }

      // Save final state
      this.checkpointManager.saveState(this.state);

      return { success, plan: this.state.plan };
    } catch (error) {
      this.setStatus('error');
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.memoryManager.addMessage('agent', `Error: ${errorMsg}`);
      return { success: false, error: errorMsg };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Execute a plan step by step
   */
  private async executePlan(plan: TaskPlan): Promise<boolean> {
    this.setStatus('executing');

    while (!this.planner.isPlanComplete(plan) && !this.shouldStop) {
      const currentStep = this.planner.getCurrentStep(plan);
      
      if (!currentStep) {
        break;
      }

      // Execute current step
      const result = await this.executor.executeStep(currentStep, plan.context);

      // Update plan with result
      plan = this.planner.updatePlanProgress(plan, result);
      this.state.plan = plan;

      // Auto-checkpoint
      if (this.config.autoCheckpoint) {
        this.checkpointManager.autoSave(this.state);
      }

      // Handle step failure
      if (!result.success) {
        // Attempt to replan
        const observation = await this.observe();
        const replanResult = await this.planner.replan(
          plan,
          currentStep,
          result.error || 'Step failed',
          observation
        );

        if (replanResult.success && replanResult.plan) {
          // Continue with new plan - save old plan before updating
          const oldPlan = this.state.plan;
          plan = replanResult.plan;
          this.state.plan = plan;
          this.emitEvent('plan_updated', { oldPlan, newPlan: plan });
          continue;
        } else {
          // Replan failed, task failed
          return false;
        }
      }
    }

    return plan.status === 'completed';
  }

  /**
   * Stop current task execution
   */
  stopTask(): void {
    this.shouldStop = true;
    this.executor.abort();
    this.reactAgent.stop();
    this.setStatus('paused');
    this.emitEvent('status_changed', { status: 'paused' });
  }

  /**
   * Resume from checkpoint
   */
  async resumeFromCheckpoint(checkpointId: string): Promise<boolean> {
    const restoredState = this.checkpointManager.restoreCheckpoint(checkpointId);
    
    if (!restoredState) {
      return false;
    }

    this.state = restoredState;
    this.memoryManager = new MemoryManager(this.state.memory);
    
    this.emitEvent('checkpoint_restored', { checkpointId });

    // If there's an active plan, continue execution
    if (this.state.plan && this.state.plan.status === 'active' && this.state.currentTask) {
      const success = await this.executePlan(this.state.plan);
      return success;
    }

    return true;
  }

  /**
   * Resume from latest checkpoint
   */
  async resumeFromLatest(): Promise<boolean> {
    const restoredState = this.checkpointManager.restoreLatest();
    
    if (!restoredState) {
      return false;
    }

    this.state = restoredState;
    this.memoryManager = new MemoryManager(this.state.memory);
    
    if (this.state.plan && this.state.plan.status === 'active') {
      return this.executePlan(this.state.plan);
    }

    return true;
  }

  // ============================================
  // Observation & Chat
  // ============================================

  /**
   * Get current page observation
   */
  async observe(): Promise<Observation> {
    const result = await toolRegistry.execute('observe', {
      includeScreenshot: this.config.enableScreenshots,
      includeElements: this.config.enableDomSnapshots,
    });

    if (result.success && result.data) {
      const observation = result.data as Observation;
      this.memoryManager.storeObservation(observation);
      return observation;
    }

    // Fallback
    return {
      timestamp: new Date().toISOString(),
      url: 'unknown',
      title: 'unknown',
      error: result.error,
    };
  }

  /**
   * Send a chat message (without executing as task)
   */
  async chat(message: string): Promise<string> {
    this.memoryManager.addMessage('user', message);
    
    // For now, just acknowledge
    // This could be enhanced to use LLM for conversation
    const response = `Received: ${message}. Use executeTask() for task execution.`;
    this.memoryManager.addMessage('agent', response);
    
    return response;
  }

  // ============================================
  // Checkpoint Management
  // ============================================

  /**
   * Create a manual checkpoint
   */
  createCheckpoint(name: string, description?: string): string | null {
    const info = this.checkpointManager.createCheckpoint(this.state, name, description);
    return info.id;
  }

  /**
   * List checkpoints
   */
  listCheckpoints() {
    return this.checkpointManager.listCheckpoints();
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    return this.checkpointManager.deleteCheckpoint(checkpointId);
  }

  // ============================================
  // State & Status
  // ============================================

  /**
   * Get current agent state
   */
  getState(): AgentState {
    return { ...this.state };
  }

  /**
   * Get current status
   */
  getStatus(): AgentStatus {
    return this.state.status;
  }

  /**
   * Check if agent is currently running
   */
  isTaskRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current plan
   */
  getCurrentPlan(): TaskPlan | null {
    return this.state.plan;
  }

  /**
   * Get plan progress
   */
  getPlanProgress(): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    percentage: number;
  } | null {
    if (!this.state.plan) {
      return null;
    }
    return this.planner.getPlanProgress(this.state.plan);
  }

  /**
   * Get conversation history
   */
  getConversationHistory(limit?: number) {
    return this.memoryManager.getRecentMessages(limit);
  }

  /**
   * Get memory summary
   */
  getMemorySummary(): string {
    return this.memoryManager.getSummary();
  }

  // ============================================
  // Configuration
  // ============================================

  /**
   * Update configuration
   */
  updateConfig(config: Partial<AgentConfig> & { executionMode?: ExecutionMode }): void {
    Object.assign(this.config, config);
    
    // Update execution mode if provided
    if (config.executionMode) {
      this.executionMode = config.executionMode;
    }
    
    // Update sub-components (legacy)
    this.executor.updateConfig({
      maxRetries: this.config.maxStepRetries,
      stepTimeout: this.config.stepTimeout,
      observationTimeout: this.config.observationTimeout,
      enableScreenshots: this.config.enableScreenshots,
      enableDomSnapshots: this.config.enableDomSnapshots,
    });

    this.planner.updateConfig({
      llmModel: this.config.llmModel,
    });

    // Update ReactAgent (new)
    this.reactAgent.updateConfig({
      actionTimeout: this.config.stepTimeout,
    });
  }

  /**
   * Set API key (uses existing baseUrl if any)
   */
  setApiKey(apiKey: string): void {
    this.planner.setApiKey(apiKey);
  }

  /**
   * Set LLM configuration (API key and optional base URL)
   */
  setLLMConfig(config: { apiKey: string; baseUrl?: string }): void {
    this.planner.setLLMConfig(config);
    this.reactAgent.setLLMConfig(config);
  }

  /**
   * Get current execution mode
   */
  getExecutionMode(): ExecutionMode {
    return this.executionMode;
  }

  /**
   * Set execution mode
   */
  setExecutionMode(mode: ExecutionMode): void {
    this.executionMode = mode;
  }

  /**
   * Get current configuration
   */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  // ============================================
  // Private Helpers
  // ============================================

  private setStatus(status: AgentStatus): void {
    this.state.status = status;
    this.state.updatedAt = new Date().toISOString();
    this.emitEvent('status_changed', { status });
  }

  private emitEvent(type: string, data: unknown): void {
    const event: AgentEvent = {
      type: type as AgentEvent['type'],
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  // ============================================
  // Cleanup
  // ============================================

  /**
   * Clear all memory
   */
  clearMemory(): void {
    this.memoryManager.clearAll();
    this.state.memory = this.memoryManager.getMemory();
  }

  /**
   * Reset agent to initial state
   */
  reset(): void {
    this.shouldStop = true;
    this.isRunning = false;
    this.state = createEmptyState();
    this.memoryManager = new MemoryManager(this.state.memory);
    this.planner.resetReplanCount();
    this.setStatus('idle');
  }
}

// Export singleton for convenience
let agentCoreInstance: AgentCore | null = null;

// Track the last LLM config to avoid unnecessary updates
let lastLLMConfig: { apiKey?: string; baseUrl?: string } = {};

export function getAgentCore(config?: AgentCoreConfig): AgentCore {
  if (!agentCoreInstance) {
    agentCoreInstance = new AgentCore(config);
    // Store initial config
    if (config?.anthropicApiKey) {
      lastLLMConfig = {
        apiKey: config.anthropicApiKey,
        baseUrl: config.anthropicBaseUrl,
      };
    }
  } else if (config) {
    agentCoreInstance.updateConfig(config);
    // Only update LLM config if it actually changed
    if (config.anthropicApiKey && 
        (config.anthropicApiKey !== lastLLMConfig.apiKey || 
         config.anthropicBaseUrl !== lastLLMConfig.baseUrl)) {
      agentCoreInstance.setLLMConfig({
        apiKey: config.anthropicApiKey,
        baseUrl: config.anthropicBaseUrl,
      });
      lastLLMConfig = {
        apiKey: config.anthropicApiKey,
        baseUrl: config.anthropicBaseUrl,
      };
    }
  }
  return agentCoreInstance;
}

export function resetAgentCore(): void {
  if (agentCoreInstance) {
    agentCoreInstance.reset();
    agentCoreInstance = null;
  }
}

