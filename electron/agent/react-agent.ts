/**
 * ReAct Agent
 * 
 * Main agent implementation using the ReAct (Reasoning + Acting) pattern.
 * This is the core loop that:
 * 1. Observes the browser state
 * 2. Thinks about what to do next
 * 3. Acts (executes a tool)
 * 4. Verifies the result
 * 5. Repeats until goal is achieved or max iterations reached
 * 
 * CodeAct is integrated as a sub-tool for complex tasks.
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ReActState,
  ReActAction,
  ReActThinkResult,
  ReActConfig,
  Observation,
  AgentEvent,
  AgentEventType,
  ToolExecutionResult,
  CodeActResult,
  GatingContext,
} from './types';
import { generateId, DEFAULT_REACT_CONFIG } from './types';
import { toolRegistry } from './tools/tool-registry';
import { codeExecutor } from './tools/code-executor';
import { GatingLogic } from './gating-logic';
import { MemoryManager } from './memory/memory-manager';
import { stateAwareness, StateAwareness } from './state-awareness';
import { dangerDetector, DangerDetector } from './safety/danger-detector';
import type { 
  ConfirmationRequest, 
  ConfirmationResponse, 
  PendingAction,
  SafetyConfig 
} from './safety/types';
import { createLogger } from '../utils/logger';

// Create module logger
const log = createLogger('ReactAgent');

// ============================================
// ReAct Agent Configuration
// ============================================

export interface ReactAgentConfig extends Partial<ReActConfig> {
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  llmModel?: string;
  enableScreenshots?: boolean;
  enableDomSnapshots?: boolean;
  safetyConfig?: Partial<SafetyConfig>;
}

// ============================================
// ReAct Agent Implementation
// ============================================

export class ReactAgent extends EventEmitter {
  private config: ReActConfig;
  private anthropicClient: Anthropic | null = null;
  private llmModel: string = 'claude-3-haiku-20240307';
  private memoryManager: MemoryManager;
  private gatingLogic: GatingLogic;
  private stateAwareness: StateAwareness;
  private dangerDetector: DangerDetector;
  private state: ReActState | null = null;
  private shouldStop: boolean = false;
  private isRunning: boolean = false;
  
  // HI-10 ~ HI-14: Confirmation flow
  private pendingConfirmation: ConfirmationRequest | null = null;
  private confirmationResolver: ((response: ConfirmationResponse) => void) | null = null;

  constructor(
    memoryManager: MemoryManager,
    config?: ReactAgentConfig
  ) {
    super();
    this.memoryManager = memoryManager;
    this.config = { ...DEFAULT_REACT_CONFIG, ...config };
    this.gatingLogic = new GatingLogic();
    this.stateAwareness = stateAwareness;
    this.dangerDetector = dangerDetector;
    
    // Apply safety config if provided
    if (config?.safetyConfig) {
      this.dangerDetector.updateConfig(config.safetyConfig);
    }
    
    if (config?.anthropicApiKey) {
      this.createAnthropicClient(config.anthropicApiKey, config.anthropicBaseUrl);
    }
    
    if (config?.llmModel) {
      this.llmModel = config.llmModel;
    }
  }

  // ============================================
  // Configuration
  // ============================================

  /**
   * Create Anthropic client
   */
  private createAnthropicClient(apiKey: string, baseUrl?: string): void {
    const options: { apiKey: string; baseURL?: string } = { apiKey };
    if (baseUrl) {
      options.baseURL = baseUrl;
    }
    this.anthropicClient = new Anthropic(options);
    log.info('Anthropic client created');
  }

  /**
   * Set LLM configuration
   */
  setLLMConfig(config: { apiKey: string; baseUrl?: string }): void {
    this.createAnthropicClient(config.apiKey, config.baseUrl);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReActConfig>): void {
    Object.assign(this.config, config);
  }

  // ============================================
  // Main ReAct Loop
  // ============================================

  /**
   * Execute task using ReAct loop
   */
  async execute(goal: string, context: Record<string, unknown> = {}): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    actions: ReActAction[];
  }> {
    log.info('execute() called with goal:', goal);
    log.debug('Anthropic client available:', !!this.anthropicClient);
    
    if (this.isRunning) {
      log.warn('Agent is already running, rejecting');
      return {
        success: false,
        error: 'Agent is already running',
        actions: [],
      };
    }

    this.isRunning = true;
    this.shouldStop = false;

    // Initialize state
    this.state = {
      status: 'observing',
      goal,
      currentObservation: null,
      actionHistory: [],
      iterationCount: 0,
      maxIterations: this.config.maxIterations,
      consecutiveFailures: 0,
      startTime: new Date().toISOString(),
      context,
    };

    // Initialize state awareness (SA-05: context preservation)
    this.stateAwareness.clear();
    this.stateAwareness.setGoalContext(goal);
    
    // Capture initial state for change detection (SA-06)
    await this.stateAwareness.captureState();

    this.emitEvent('react_iteration_started', { goal, iteration: 0 });

    try {
      // Main ReAct loop
      while (
        this.state.iterationCount < this.state.maxIterations &&
        this.state.consecutiveFailures < this.config.maxConsecutiveFailures &&
        !this.shouldStop
      ) {
        this.state.iterationCount++;
        this.emitEvent('react_iteration_started', { 
          iteration: this.state.iterationCount,
          goal 
        });

        // 1. OBSERVE
        this.state.status = 'observing';
        const observation = await this.observe();
        this.state.currentObservation = observation;
        this.memoryManager.storeObservation(observation);

        // 2. THINK
        this.state.status = 'thinking';
        const thinkResult = await this.think(goal, observation);
        this.emitEvent('react_thinking', { thought: thinkResult.thought });

        // Check for repeated actions (prevent infinite loop)
        const recentActions = this.state.actionHistory.slice(-3);
        const sameToolCount = recentActions.filter(a => a.tool === thinkResult.action).length;
        const sameToolAndArgsCount = recentActions.filter(a => 
          a.tool === thinkResult.action && 
          JSON.stringify(a.args) === JSON.stringify(thinkResult.args)
        ).length;
        
        // If same action with same args repeated 3+ times, force completion
        if (sameToolAndArgsCount >= 2) {
          log.warn('Detected repeated action with same args, forcing completion');
          
          // Generate a summary of what was attempted
          const summary = await this.generateTaskSummary(goal, observation, 'repeated_action');
          
          this.state.status = 'complete';
          this.emitEvent('react_completed', {
            success: false,
            message: summary,
            iterations: this.state.iterationCount,
          });
          
          return {
            success: false,
            error: 'Task could not be completed - repeated actions detected',
            result: summary,
            actions: this.state.actionHistory,
          };
        }
        
        // If same tool type repeated 3+ times (but different args), guide to try different approach
        if (sameToolCount >= 2 && thinkResult.action === 'observe') {
          log.info('Observe repeated multiple times, suggesting alternative actions');
          // Don't block, but the prompt already includes guidance
        }

        // Check if task is complete
        if (thinkResult.isComplete) {
          this.state.status = 'complete';
          this.emitEvent('react_completed', {
            success: true,
            message: thinkResult.completionMessage,
            iterations: this.state.iterationCount,
          });
          
          return {
            success: true,
            result: thinkResult.completionMessage,
            actions: this.state.actionHistory,
          };
        }

        // 3. Check if CodeAct should be triggered
        let action: ReActAction;
        
        if (thinkResult.shouldCallCodeAct && this.config.enableCodeAct) {
          // Execute CodeAct
          action = await this.executeCodeAct(thinkResult);
        } else {
          // Check gating rules
          const gatingContext = this.createGatingContext(observation, goal);
          const gatingDecision = this.gatingLogic.shouldTriggerCodeAct(gatingContext);
          
          if (gatingDecision.shouldUseCodeAct && this.config.enableCodeAct) {
            // Gating triggered CodeAct
            this.emitEvent('codeact_triggered', { rules: gatingDecision.triggeredRules });
            action = await this.executeCodeActFromGating(gatingDecision, observation);
          } else {
            // HI-10 ~ HI-14: Safety check before acting
            const safetyResult = await this.checkActionSafety(thinkResult, observation);
            
            if (safetyResult.requiresConfirmation) {
              // HI-11: Request confirmation
              const confirmed = await this.requestConfirmation(safetyResult.confirmationRequest!);
              
              if (!confirmed) {
                // HI-13: User rejected - skip this action
                this.emitEvent('action_rejected', { 
                  action: thinkResult.action,
                  reason: 'User rejected dangerous action'
                });
                
                // Create a skipped action record
                action = {
                  id: generateId('action'),
                  thought: thinkResult.thought,
                  tool: thinkResult.action,
                  args: thinkResult.args,
                  reasoning: 'Action skipped due to user rejection',
                  confidence: 0,
                  requiresCodeAct: false,
                  timestamp: new Date().toISOString(),
                  result: {
                    success: false,
                    error: 'Action rejected by user',
                    observation,
                    duration: 0,
                  },
                };
                
                // Continue to next iteration
                this.state.actionHistory.push(action);
                continue;
              }
              
              // HI-12: User confirmed - proceed
              this.emitEvent('action_confirmed', { action: thinkResult.action });
            }
            
            // 4. ACT (normal tool execution)
            action = await this.act(thinkResult, observation);
          }
        }

        // Record action
        this.state.actionHistory.push(action);

        // 5. VERIFY (RA-04: Enhanced verification with state-awareness)
        this.state.status = 'verifying';
        
        // Use state-awareness for verification (SA-02)
        const verificationResult = await this.verifyActionResult(action, thinkResult);
        
        // Log detailed action result for debugging
        log.debug(`Action result for ${action.tool}:`, {
          success: action.result?.success,
          error: action.result?.error,
          hasData: !!action.result?.data,
        });
        log.debug(`Verification result for ${action.tool}:`, {
          verified: verificationResult.verified,
          confidence: verificationResult.confidence,
          details: verificationResult.details,
        });
        
        // For read-only operations (observe, listPages, screenshot, etc.), 
        // we only need action.result.success - verification is not meaningful
        const isReadOnlyAction = ['observe', 'listPages', 'screenshot', 'queryDOM', 'getPageInfo'].includes(action.tool);
        const isSuccess = action.result?.success && (isReadOnlyAction || verificationResult.verified);
        
        if (isSuccess) {
          this.state.consecutiveFailures = 0;
          this.stateAwareness.updateGoalProgress(action.tool, true);
          log.info(`Action completed successfully: ${action.tool}`);
          this.emitEvent('react_action_completed', { action, verification: verificationResult });
        } else {
          this.state.consecutiveFailures++;
          log.warn(`Action failed (consecutiveFailures: ${this.state.consecutiveFailures}): ${action.tool}`, {
            actionSuccess: action.result?.success,
            actionError: action.result?.error,
            verified: verificationResult.verified,
            verificationDetails: verificationResult.details,
          });
          
          // Error recovery attempt (ER-01 ~ ER-03)
          const recoveryResult = await this.attemptErrorRecovery(action, observation);
          if (recoveryResult.recovered && recoveryResult.result) {
            this.state.consecutiveFailures = 0;
            // Merge recovery result with observation to satisfy ReActActionResult type
            action.result = {
              success: recoveryResult.result.success,
              data: recoveryResult.result.data,
              error: recoveryResult.result.error,
              observation: action.result?.observation || observation,
              duration: recoveryResult.result.duration || 0,
            };
            log.info(`Action recovered: ${action.tool}`);
            this.emitEvent('react_action_recovered', { action, recovery: recoveryResult });
          } else {
            log.error(`Action failed and could not recover: ${action.tool}`, action.result?.error);
            this.emitEvent('react_action_failed', { 
              action, 
              error: action.result?.error,
              verification: verificationResult 
            });
          }
        }
        
        // Check intermediate states (SA-04: loading/modal detection)
        const intermediateState = await this.stateAwareness.getIntermediateState();
        if (intermediateState.isBlocked) {
          // Wait for loading/modal to complete (MS-03, MS-05)
          await this.waitForIntermediateState(intermediateState);
        }
      }

      // Loop ended without completion
      const isTooManyFailures = this.state.consecutiveFailures >= this.config.maxConsecutiveFailures;
      const reason = this.shouldStop
        ? 'Stopped by user'
        : isTooManyFailures
          ? 'Too many consecutive failures'
          : 'Max iterations reached';

      log.warn(`Task loop ended: ${reason}`, {
        consecutiveFailures: this.state.consecutiveFailures,
        iterationCount: this.state.iterationCount,
      });

      // Generate summary for the user
      const observation = this.state.currentObservation || {
        timestamp: new Date().toISOString(),
        url: 'unknown',
        title: 'unknown',
      };
      const summaryReason: 'consecutive_failures' | 'max_iterations' = isTooManyFailures ? 'consecutive_failures' : 'max_iterations';
      const summary = await this.generateTaskSummary(goal, observation, summaryReason);

      this.state.status = 'error';
      this.emitEvent('react_completed', {
        success: false,
        error: reason,
        message: summary,
        iterations: this.state.iterationCount,
      });

      return {
        success: false,
        error: reason,
        result: summary,
        actions: this.state.actionHistory,
      };
    } catch (error) {
      this.state!.status = 'error';
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      // Generate error summary
      const observation = this.state?.currentObservation || {
        timestamp: new Date().toISOString(),
        url: 'unknown',
        title: 'unknown',
      };
      const summary = await this.generateTaskSummary(goal, observation, 'error');
      
      this.emitEvent('react_completed', {
        success: false,
        error: errorMsg,
        message: summary,
        iterations: this.state?.iterationCount || 0,
      });

      return {
        success: false,
        error: errorMsg,
        result: summary,
        actions: this.state?.actionHistory || [],
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Check if running
   */
  isExecuting(): boolean {
    return this.isRunning;
  }

  /**
   * Get current state
   */
  getState(): ReActState | null {
    return this.state;
  }

  // ============================================
  // ReAct Steps Implementation
  // ============================================

  /**
   * OBSERVE: Get current page state
   */
  private async observe(): Promise<Observation> {
    const result = await toolRegistry.execute('observe', {
      includeScreenshot: false, // TODO: maybe some scenarios need screenshots?
      includeElements: this.config.enableDomSnapshots,
    });

    if (result.success && result.data) {
      return result.data as Observation;
    }

    // Fallback
    const pageInfo = await toolRegistry.execute('getPageInfo', {});
    const info = pageInfo.data as Record<string, unknown> | undefined;
    
    return {
      timestamp: new Date().toISOString(),
      url: 'unknown',
      title: 'unknown',
      ...info,  // 展开所有 info 信息让 agent 自己分析
      error: result.error,
    };
  }

  /**
   * THINK: Decide what action to take
   */
  private async think(goal: string, observation: Observation): Promise<ReActThinkResult> {
    if (!this.anthropicClient) {
      log.debug('No Anthropic client, using rule-based thinking');
      // Fallback to rule-based thinking
      return this.ruleBasedThink(goal, observation);
    }

    try {
      const prompt = this.buildThinkPrompt(goal, observation);
      log.debug('Sending to LLM...');
      log.debug('Prompt (first 500 chars):', prompt.substring(0, 500));
      
      const response = await this.anthropicClient.messages.create({
        model: this.llmModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        system: this.getThinkSystemPrompt(),
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        log.error('Unexpected response type:', content.type);
        throw new Error('Unexpected response type');
      }

      log.debug('LLM Response:', content.text);
      const result = this.parseThinkResponse(content.text);
      log.debug('Parsed result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      log.error('Think failed:', error);
      return this.ruleBasedThink(goal, observation);
    }
  }

  /**
   * ACT: Execute the decided action
   */
  private async act(
    thinkResult: ReActThinkResult,
    observation: Observation
  ): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();

    this.state!.status = 'acting';
    this.emitEvent('react_action_started', { 
      tool: thinkResult.action, 
      args: thinkResult.args 
    });

    const action: ReActAction = {
      id: actionId,
      thought: thinkResult.thought,
      tool: thinkResult.action,
      args: thinkResult.args,
      reasoning: thinkResult.reasoning,
      confidence: thinkResult.confidence,
      requiresCodeAct: false,
      timestamp: new Date().toISOString(),
    };

    try {
      log.info(`Executing action: ${thinkResult.action}`, thinkResult.args);
      
      const toolResult = await this.executeWithTimeout(
        thinkResult.action,
        thinkResult.args,
        this.config.actionTimeout
      );

      if (toolResult.success) {
        log.info(`Action ${thinkResult.action} succeeded`);
      } else {
        log.warn(`Action ${thinkResult.action} failed:`, toolResult.error);
      }

      // Get new observation after action
      const newObservation = await this.observe();

      action.result = {
        success: toolResult.success,
        data: toolResult.data,
        error: toolResult.error,
        observation: newObservation,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Action ${thinkResult.action} threw exception:`, errorMsg);
      
      action.result = {
        success: false,
        error: errorMsg,
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  /**
   * Execute CodeAct based on think result
   */
  private async executeCodeAct(thinkResult: ReActThinkResult): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();

    this.emitEvent('codeact_executing', { task: thinkResult.codeActTask });

    const action: ReActAction = {
      id: actionId,
      thought: thinkResult.thought,
      tool: 'call_code_solver',
      args: { task: thinkResult.codeActTask },
      reasoning: thinkResult.reasoning,
      confidence: thinkResult.confidence,
      requiresCodeAct: true,
      timestamp: new Date().toISOString(),
    };

    try {
      // Get DOM for CodeAct
      const domResult = await toolRegistry.execute('queryDOM', {});
      const html = domResult.success && domResult.data 
        ? (domResult.data as { html: string }).html || ''
        : '';

      // Execute CodeAct
      const codeResult = await codeExecutor.parseDOM(html, thinkResult.codeActTask || thinkResult.thought);

      const newObservation = await this.observe();

      if (codeResult.success) {
        this.emitEvent('codeact_completed', { result: codeResult.result });
        
        action.result = {
          success: true,
          data: codeResult.result,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      } else {
        this.emitEvent('codeact_failed', { error: codeResult.error });
        
        action.result = {
          success: false,
          error: codeResult.error,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      const observation = this.state!.currentObservation || {
        timestamp: new Date().toISOString(),
        url: 'unknown',
        title: 'unknown',
      };

      action.result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  /**
   * Execute CodeAct triggered by gating logic
   */
  private async executeCodeActFromGating(
    gatingDecision: { suggestedTask?: string; triggeredRules: string[] },
    observation: Observation
  ): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();
    const task = gatingDecision.suggestedTask || 'Process page data';

    this.emitEvent('codeact_executing', { task, triggeredBy: gatingDecision.triggeredRules });

    const action: ReActAction = {
      id: actionId,
      thought: `Gating triggered CodeAct: ${gatingDecision.triggeredRules.join(', ')}`,
      tool: 'call_code_solver',
      args: { task },
      reasoning: `Gating rules triggered: ${gatingDecision.triggeredRules.join(', ')}`,
      confidence: 0.8,
      requiresCodeAct: true,
      timestamp: new Date().toISOString(),
    };

    try {
      // Get DOM snapshot
      const domHtml = observation.domSnapshot || '';
      
      // Execute appropriate CodeAct based on triggered rules
      let codeResult: CodeActResult;
      
      if (gatingDecision.triggeredRules.includes('selector_failures')) {
        // Find element using fuzzy matching
        const elements = observation.visibleElements || [];
        codeResult = await codeExecutor.findElement(elements, this.state!.goal);
      } else {
        // General DOM parsing
        codeResult = await codeExecutor.parseDOM(domHtml, task);
      }

      const newObservation = await this.observe();

      if (codeResult.success) {
        this.emitEvent('codeact_completed', { result: codeResult.result });
        
        action.result = {
          success: true,
          data: codeResult.result,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      } else {
        this.emitEvent('codeact_failed', { error: codeResult.error });
        
        action.result = {
          success: false,
          error: codeResult.error,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      action.result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  // ============================================
  // Helper Methods
  // ============================================

  // ============================================
  // Safety Check and Confirmation (HI-10 ~ HI-14)
  // ============================================

  /**
   * HI-10: Check if action requires confirmation
   */
  private async checkActionSafety(
    thinkResult: ReActThinkResult,
    observation: Observation
  ): Promise<{
    requiresConfirmation: boolean;
    confirmationRequest?: ConfirmationRequest;
  }> {
    // Build pending action for detection
    const pendingAction: PendingAction = {
      tool: thinkResult.action,
      args: thinkResult.args,
      thought: thinkResult.thought,
      reasoning: thinkResult.reasoning,
      targetElement: observation.visibleElements?.find(el => 
        thinkResult.args.selector && el.selector === thinkResult.args.selector
      ) ? {
        selector: thinkResult.args.selector as string,
        tag: observation.visibleElements!.find(el => el.selector === thinkResult.args.selector)!.tag,
        text: observation.visibleElements!.find(el => el.selector === thinkResult.args.selector)!.text || '',
        attributes: observation.visibleElements!.find(el => el.selector === thinkResult.args.selector)!.attributes,
        boundingBox: observation.visibleElements!.find(el => el.selector === thinkResult.args.selector)!.boundingBox,
      } : undefined,
    };

    // Detect danger
    const detectionResult = await this.dangerDetector.detect(pendingAction, {
      url: observation.url,
      title: observation.title,
      html: observation.domSnapshot,
      visibleElements: observation.visibleElements,
    });

    if (!detectionResult.isDangerous) {
      return { requiresConfirmation: false };
    }

    // Build confirmation request
    const confirmationRequest: ConfirmationRequest = {
      id: generateId('confirm'),
      timestamp: new Date().toISOString(),
      action: pendingAction,
      risk: detectionResult.risk,
      preview: {
        description: `${thinkResult.action}(${JSON.stringify(thinkResult.args)})`,
        expectedOutcome: thinkResult.reasoning,
        potentialRisks: detectionResult.risk.reasons,
        elementHighlight: pendingAction.targetElement ? {
          selector: pendingAction.targetElement.selector,
          color: detectionResult.risk.level === 'critical' ? 'red' : 
                 detectionResult.risk.level === 'high' ? 'orange' : 'yellow',
          label: `Risk: ${detectionResult.risk.level}`,
        } : undefined,
      },
      timeout: this.dangerDetector.getConfig().confirmationTimeout,
      status: 'pending',
    };

    return {
      requiresConfirmation: true,
      confirmationRequest,
    };
  }

  /**
   * HI-11 ~ HI-14: Request and handle confirmation
   */
  private async requestConfirmation(request: ConfirmationRequest): Promise<boolean> {
    this.pendingConfirmation = request;
    
    // Emit confirmation request event
    this.emitEvent('confirmation_requested', {
      request,
      riskLevel: request.risk.level,
      description: request.preview.description,
    });

    // Wait for response with timeout
    return new Promise<boolean>((resolve) => {
      // Set up timeout (HI-14)
      const timeoutId = setTimeout(() => {
        if (this.pendingConfirmation?.id === request.id) {
          this.pendingConfirmation.status = 'timeout';
          this.emitEvent('confirmation_timeout', { requestId: request.id });
          this.pendingConfirmation = null;
          this.confirmationResolver = null;
          resolve(false);
        }
      }, request.timeout);

      // Store resolver for external confirmation
      this.confirmationResolver = (response: ConfirmationResponse) => {
        clearTimeout(timeoutId);
        
        if (response.requestId === request.id) {
          this.pendingConfirmation!.status = response.status === 'confirmed' ? 'confirmed' : 'rejected';
          this.emitEvent('confirmation_received', { response });
          this.pendingConfirmation = null;
          this.confirmationResolver = null;
          resolve(response.status === 'confirmed');
        }
      };
    });
  }

  /**
   * External method to provide confirmation response
   */
  confirmAction(confirmed: boolean, comment?: string): void {
    if (this.confirmationResolver && this.pendingConfirmation) {
      this.confirmationResolver({
        requestId: this.pendingConfirmation.id,
        status: confirmed ? 'confirmed' : 'rejected',
        timestamp: new Date().toISOString(),
        userComment: comment,
      });
    }
  }

  /**
   * Get pending confirmation
   */
  getPendingConfirmation(): ConfirmationRequest | null {
    return this.pendingConfirmation;
  }

  /**
   * Cancel pending confirmation
   */
  cancelPendingConfirmation(): void {
    if (this.pendingConfirmation) {
      this.pendingConfirmation.status = 'cancelled';
      this.emitEvent('confirmation_cancelled', { requestId: this.pendingConfirmation.id });
      
      if (this.confirmationResolver) {
        this.confirmationResolver({
          requestId: this.pendingConfirmation.id,
          status: 'rejected',
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ============================================
  // Verification and Error Recovery (RA-04, ER-01~ER-06)
  // ============================================

  /**
   * RA-04: Verify action result using state-awareness
   */
  private async verifyActionResult(
    action: ReActAction,
    thinkResult: ReActThinkResult
  ): Promise<{ verified: boolean; confidence: number; details: string }> {
    try {
      const result = await this.stateAwareness.verifyOperation(action.tool, {
        selector: action.args.selector,
        text: action.args.text,
        value: action.args.value,
        url: action.args.url,
        previousUrl: action.result?.observation?.url,
        expectNavigation: action.tool === 'navigate' || action.tool === 'click',
      });
      
      return {
        verified: result.verified,
        confidence: result.confidence,
        details: result.details,
      };
    } catch {
      return {
        verified: action.result?.success || false,
        confidence: 0.5,
        details: 'Verification fallback',
      };
    }
  }

  /**
   * ER-01~ER-03: Attempt error recovery
   */
  private async attemptErrorRecovery(
    action: ReActAction,
    observation: Observation
  ): Promise<{ recovered: boolean; result?: ToolExecutionResult; strategy?: string }> {
    const errorMsg = action.result?.error?.toLowerCase() || '';
    
    // ER-01: Selector retry with alternative strategies
    if (errorMsg.includes('element not found') || errorMsg.includes('selector')) {
      // Try alternative selectors
      const alternatives = await this.tryAlternativeSelectors(action, observation);
      if (alternatives.success) {
        return { recovered: true, result: alternatives.result, strategy: 'alternative_selector' };
      }
    }
    
    // ER-02: Wait and retry for async loading
    if (errorMsg.includes('timeout') || errorMsg.includes('not found')) {
      await this.stateAwareness.waitForPageLoad(5000);
      const retryResult = await this.executeWithTimeout(action.tool, action.args, this.config.actionTimeout);
      if (retryResult.success) {
        return { recovered: true, result: retryResult, strategy: 'wait_retry' };
      }
    }
    
    // ER-03: Scroll to find element
    if (errorMsg.includes('not found') || errorMsg.includes('not visible')) {
      const scrollResult = await this.tryScrollToElement(action);
      if (scrollResult.success) {
        return { recovered: true, result: scrollResult.result, strategy: 'scroll_find' };
      }
    }
    
    return { recovered: false };
  }

  /**
   * Try alternative selectors for the same target element
   */
  private async tryAlternativeSelectors(
    action: ReActAction,
    observation: Observation
  ): Promise<{ success: boolean; result?: ToolExecutionResult }> {
    const originalSelector = action.args.selector as string;
    if (!originalSelector) return { success: false };

    // Use CodeAct to find best matching element
    if (observation.visibleElements && observation.visibleElements.length > 0) {
      const findResult = await codeExecutor.findElement(observation.visibleElements, originalSelector);
      
      if (findResult.success && findResult.result) {
        const match = findResult.result as { found?: boolean; selector?: string };
        if (match.found && match.selector) {
          const retryResult = await this.executeWithTimeout(
            action.tool,
            { ...action.args, selector: match.selector },
            this.config.actionTimeout
          );
          
          if (retryResult.success) {
            return { success: true, result: retryResult };
          }
        }
      }
    }

    return { success: false };
  }

  /**
   * Try scrolling to find the element
   */
  private async tryScrollToElement(action: ReActAction): Promise<{ success: boolean; result?: ToolExecutionResult }> {
    const scrollDirections = ['down', 'up'];
    
    for (const direction of scrollDirections) {
      // Execute scroll
      const scrollCode = direction === 'down'
        ? 'await page.evaluate(() => window.scrollBy(0, 500))'
        : 'await page.evaluate(() => window.scrollBy(0, -500))';
      
      await toolRegistry.execute('runCode', { code: scrollCode });
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Retry action
      const retryResult = await this.executeWithTimeout(
        action.tool,
        action.args,
        this.config.actionTimeout
      );
      
      if (retryResult.success) {
        return { success: true, result: retryResult };
      }
    }
    
    return { success: false };
  }

  /**
   * MS-03, MS-05: Wait for intermediate state to resolve
   */
  private async waitForIntermediateState(state: { isLoading: boolean; hasModal: boolean; blockedBy?: string }): Promise<void> {
    const maxWait = 10000;
    const startTime = Date.now();
    
    this.emitEvent('waiting_for_state', { blockedBy: state.blockedBy });
    
    while (Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const currentState = await this.stateAwareness.getIntermediateState();
      
      if (!currentState.isBlocked) {
        this.emitEvent('state_resolved', { duration: Date.now() - startTime });
        return;
      }
    }
    
    this.emitEvent('state_timeout', { blockedBy: state.blockedBy });
  }

  // ============================================
  // Multi-Step Task Support (MS-01~MS-05)
  // ============================================

  /**
   * MS-04: Wait for element to appear with polling
   */
  async waitForElement(selector: string, timeout: number = 10000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const result = await toolRegistry.execute('waitForSelector', { 
        selector, 
        state: 'visible',
        timeout: Math.min(2000, timeout - (Date.now() - startTime))
      });
      
      if (result.success) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }

  /**
   * Check if goal is complete using state-awareness (SA-03)
   */
  private async checkGoalCompletion(
    goal: string,
    observation: Observation
  ): Promise<{ completed: boolean; confidence: number; reason: string }> {
    return this.stateAwareness.isGoalCompleted(goal, observation);
  }

  /**
   * Generate a summary of the task execution
   */
  private async generateTaskSummary(
    goal: string,
    observation: Observation,
    reason: 'completed' | 'repeated_action' | 'max_iterations' | 'consecutive_failures' | 'error'
  ): Promise<string> {
    const actionHistory = this.state?.actionHistory || [];
    const actionsSummary = actionHistory.slice(-5).map(a => 
      `- ${a.result?.success ? '✓' : '✗'} ${a.tool}${a.result?.error ? `: ${a.result.error}` : ''}`
    ).join('\n');

    let summary = '';
    
    switch (reason) {
      case 'completed':
        summary = `## 任务完成\n\n**目标**: ${goal}\n\n**当前页面**: ${observation.title} (${observation.url})\n\n**执行摘要**:\n${actionsSummary}`;
        break;
        
      case 'repeated_action':
        summary = `## 任务未能完成\n\n**目标**: ${goal}\n\n**问题**: 检测到重复动作，无法继续执行。\n\n**当前页面**: ${observation.title} (${observation.url})\n\n**已尝试的操作**:\n${actionsSummary}\n\n**建议**: `;
        
        // Provide specific suggestions based on the goal
        if (goal.toLowerCase().includes('切换') || goal.toLowerCase().includes('switch') || goal.toLowerCase().includes('tab')) {
          summary += `目标可能在其他浏览器标签页中。请尝试:\n1. 使用 "listPages" 命令查看所有打开的标签页\n2. 找到目标页面后使用 "switchToPage" 切换`;
        } else if (goal.toLowerCase().includes('点击') || goal.toLowerCase().includes('click')) {
          summary += `目标元素可能不在当前可见区域，请尝试滚动页面或检查选择器是否正确`;
        } else {
          summary += `请检查目标是否正确，或尝试更具体的描述`;
        }
        break;
        
      case 'consecutive_failures':
        summary = `## 任务执行失败\n\n**目标**: ${goal}\n\n**问题**: 连续多次操作失败 (${this.state?.consecutiveFailures} 次)。\n\n**当前页面**: ${observation.title} (${observation.url})\n\n**失败的操作**:\n${actionsSummary}\n\n**建议**: `;
        
        // Analyze failures and provide suggestions
        const failedActions = actionHistory.filter(a => !a.result?.success);
        const lastError = failedActions[failedActions.length - 1]?.result?.error || '';
        
        if (goal.toLowerCase().includes('切换') || goal.toLowerCase().includes('switch') || goal.toLowerCase().includes('tab')) {
          summary += `目标 "${goal}" 可能在其他浏览器标签页中，而不是当前页面。请尝试:\n`;
          summary += `1. 输入 "listPages" 查看所有打开的标签页\n`;
          summary += `2. 找到包含目标的标签页后，使用 "switchToPage [序号]" 切换`;
        } else if (lastError.includes('not found') || lastError.includes('selector')) {
          summary += `目标元素未找到。可能的原因:\n1. 元素不在当前页面\n2. 页面还在加载中\n3. 选择器不正确`;
        } else {
          summary += `请检查:\n1. 目标是否在当前页面\n2. 是否需要先进行其他操作（如登录）\n3. 尝试更具体的描述`;
        }
        break;
        
      case 'max_iterations':
        summary = `## 任务超时\n\n**目标**: ${goal}\n\n**问题**: 已达到最大迭代次数 (${this.state?.maxIterations})。\n\n**当前页面**: ${observation.title} (${observation.url})\n\n**已执行的操作**:\n${actionsSummary}`;
        break;
        
      case 'error':
        summary = `## 任务执行错误\n\n**目标**: ${goal}\n\n**当前页面**: ${observation.title} (${observation.url})\n\n**已尝试的操作**:\n${actionsSummary}`;
        break;
    }
    
    log.info(`Task summary generated (${reason}):`, summary.substring(0, 200));
    return summary;
  }

  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout(
    toolName: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Tool execution timed out after ${timeout}ms`,
          duration: timeout,
        });
      }, timeout);

      toolRegistry.execute(toolName, args)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: 0,
          });
        });
    });
  }

  /**
   * Create gating context
   */
  private createGatingContext(observation: Observation, goal: string): GatingContext {
    return GatingLogic.createContext(
      observation,
      goal,
      this.state?.goal || goal,
      this.state?.actionHistory || []
    );
  }

  /**
   * Emit agent event
   */
  private emitEvent(type: AgentEventType | string, data: unknown): void {
    const event: AgentEvent = {
      type: type as AgentEventType,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  // ============================================
  // Prompt Building
  // ============================================

  /**
   * Get system prompt for thinking
   */
  private getThinkSystemPrompt(): string {
    const tools = toolRegistry.getToolDescriptionsForPrompt();
    
    return `你是一个浏览器自动化 ReAct Agent。你通过 观察(Observe) → 思考(Think) → 行动(Act) 的循环来完成用户任务。

## 可用工具

${tools}

## 特殊工具: call_code_solver

当你需要执行以下复杂任务时，可以调用 call_code_solver:
- 解析大量 DOM 结构
- 数据排序、过滤、比较
- 找到最匹配的元素
- 批量数据提取
- 复杂选择器生成

## 输出格式 (JSON)

{
  "thought": "你对当前状态的分析",
  "action": "工具名称 (如果 isComplete=true 则忽略)",
  "args": { "参数名": "参数值" },
  "reasoning": "为什么选择这个行动",
  "confidence": 0.0-1.0,
  "shouldCallCodeAct": false,
  "codeActTask": "如果 shouldCallCodeAct=true，描述要执行的代码任务",
  "isComplete": false,
  "completionMessage": "如果任务完成，说明完成情况"
}

## 重要规则

1. **关于 observe 和页面状态**:
   - **"当前页面状态"就是最新的 observe 结果**，不需要再次调用 observe
   - 如果已经有页面信息，直接分析并采取下一步行动
   - 只有在页面发生变化后（如导航、点击后）才需要新的 observe

2. **多标签页操作**:
   - 如果用户要"切换到"某个页面/标签，目标很可能在另一个浏览器标签页中
   - **首先使用 listPages** 查看所有打开的标签页
   - 然后使用 **switchToPage** 切换到目标标签页
   - 不要在当前页面反复 observe 试图找到其他标签页的内容

3. **任务完成判断**:
   - 询问/查看类任务：直接根据已有信息回答，设置 isComplete=true
   - 操作类任务：执行完成后设置 isComplete=true，并在 completionMessage 中说明结果
   - **必须在 completionMessage 中给用户一个明确的回复**

4. **避免无限循环**:
   - 如果连续2次调用同一个工具但没有进展，**必须换一种方法**
   - 如果在当前页面找不到目标，考虑使用 listPages 查看其他标签页

5. 每次只执行一个行动
6. 选择器优先使用: id > data-testid > name > text > class

只输出 JSON，不要包含其他内容。`;
  }

  /**
   * Build think prompt
   * ReAct pattern: Observation includes both page state AND last action result
   */
  private buildThinkPrompt(goal: string, observation: Observation): string {
    let prompt = `## 任务目标
${goal}

`;

    // FIRST: Show last action result prominently (this is the key observation in ReAct)
    if (this.state && this.state.actionHistory.length > 0) {
      const lastAction = this.state.actionHistory[this.state.actionHistory.length - 1];
      prompt += `## 上一步执行结果\n`;
      prompt += `- 动作: ${lastAction.tool}(${JSON.stringify(lastAction.args)})\n`;
      prompt += `- 状态: ${lastAction.result?.success ? '✓ 成功' : '✗ 失败'}\n`;
      
      if (lastAction.result?.error) {
        prompt += `- 错误: ${lastAction.result.error}\n`;
      }
      
      // Show action result data (important for listPages, queryDOM, etc.)
      if (lastAction.result?.success && lastAction.result?.data) {
        const dataStr = JSON.stringify(lastAction.result.data, null, 2);
        // Show more data for important actions like listPages
        const maxLen = ['listPages', 'queryDOM', 'getPageInfo'].includes(lastAction.tool) ? 1000 : 300;
        prompt += `- 返回数据:\n\`\`\`json\n${dataStr.slice(0, maxLen)}${dataStr.length > maxLen ? '\n...(truncated)' : ''}\n\`\`\`\n`;
      }
      prompt += '\n';
    }

    // SECOND: Current page state
    prompt += `## 当前页面状态\n`;
    prompt += `- URL: ${observation.url}\n`;
    prompt += `- 标题: ${observation.title}\n`;

    if (observation.visibleElements && observation.visibleElements.length > 0) {
      prompt += `\n## 可见交互元素 (前20个)\n`;
      observation.visibleElements.slice(0, 20).forEach((el, i) => {
        const text = el.text ? `"${el.text.slice(0, 50)}"` : '';
        prompt += `${i + 1}. [${el.tag}] ${text} → ${el.selector}\n`;
      });
    }

    // THIRD: Action history summary (excluding last action which is already shown above)
    if (this.state && this.state.actionHistory.length > 1) {
      prompt += `\n## 历史动作摘要 (共 ${this.state.actionHistory.length} 步)\n`;
      const olderActions = this.state.actionHistory.slice(-6, -1); // Last 5, excluding the most recent
      
      olderActions.forEach((action, i) => {
        const status = action.result?.success ? '✓' : '✗';
        prompt += `${i + 1}. ${status} ${action.tool}\n`;
      });
      
      // Add warnings based on action history
      const observeCount = this.state.actionHistory.filter(a => a.tool === 'observe').length;
      if (observeCount >= 2) {
        prompt += `\n**⚠️ 注意**: 你已经执行了 ${observeCount} 次 observe。当前页面状态已经是最新的，不需要再次 observe。`;
        prompt += `\n如果需要切换到其他标签页，请使用 **listPages** 查看所有打开的页面，然后用 **switchToPage** 切换。\n`;
      }
      
      const failedCount = this.state.actionHistory.slice(-5).filter(a => !a.result?.success).length;
      if (failedCount >= 2) {
        prompt += `\n**⚠️ 警告**: 最近 ${failedCount} 个动作失败了。请尝试不同的方法或使用 listPages 查看其他标签页。\n`;
      }
    }

    prompt += `\n请根据上述观察结果，决定下一步行动。`;

    return prompt;
  }

  /**
   * Parse think response
   */
  private parseThinkResponse(response: string): ReActThinkResult {
    try {
      let jsonStr = response.trim();
      
      // Handle markdown code blocks
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Try to find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      return {
        thought: parsed.thought || '',
        action: parsed.action || 'observe',
        args: parsed.args || {},
        reasoning: parsed.reasoning || '',
        confidence: parsed.confidence || 0.5,
        shouldCallCodeAct: parsed.shouldCallCodeAct || false,
        codeActTask: parsed.codeActTask,
        isComplete: parsed.isComplete || false,
        completionMessage: parsed.completionMessage,
      };
    } catch (error) {
      log.error('Failed to parse think response:', error);
      
      // Fallback
      return {
        thought: 'Failed to parse LLM response',
        action: 'observe',
        args: {},
        reasoning: 'Fallback to observation',
        confidence: 0.3,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }
  }

  /**
   * Rule-based thinking fallback
   */
  private ruleBasedThink(goal: string, _observation: Observation): ReActThinkResult {
    const lowerGoal = goal.toLowerCase();
    
    // Check for navigation
    const urlMatch = goal.match(/https?:\/\/[^\s]+/);
    if (urlMatch || lowerGoal.includes('go to') || lowerGoal.includes('navigate') || lowerGoal.includes('打开')) {
      const url = urlMatch ? urlMatch[0] : this.extractUrlFromGoal(goal);
      if (url) {
        return {
          thought: `Need to navigate to ${url}`,
          action: 'navigate',
          args: { url },
          reasoning: 'Goal contains URL or navigation keywords',
          confidence: 0.9,
          shouldCallCodeAct: false,
          isComplete: false,
        };
      }
    }

    // Check for click
    if (lowerGoal.includes('click') || lowerGoal.includes('点击')) {
      const target = this.extractClickTarget(goal);
      return {
        thought: `Need to click on ${target}`,
        action: 'click',
        args: { selector: target },
        reasoning: 'Goal contains click keywords',
        confidence: 0.8,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }

    // Check for type/input
    if (lowerGoal.includes('type') || lowerGoal.includes('input') || lowerGoal.includes('输入')) {
      const textMatch = goal.match(/["']([^"']+)["']/);
      return {
        thought: `Need to type text`,
        action: 'type',
        args: { 
          selector: 'input, textarea',
          text: textMatch ? textMatch[1] : '',
        },
        reasoning: 'Goal contains typing keywords',
        confidence: 0.7,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }

    // Default: observe
    return {
      thought: 'Need more information about the page',
      action: 'observe',
      args: { includeElements: true },
      reasoning: 'Default to observation',
      confidence: 0.5,
      shouldCallCodeAct: false,
      isComplete: false,
    };
  }

  /**
   * Extract URL from goal
   */
  private extractUrlFromGoal(goal: string): string | null {
    const domainMatch = goal.match(/(?:go to|navigate to|open|visit|打开)\s+([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (domainMatch) {
      return `https://${domainMatch[1]}`;
    }
    return null;
  }

  /**
   * Extract click target from goal
   */
  private extractClickTarget(goal: string): string {
    const patterns = [
      /click (?:on )?["']([^"']+)["']/i,
      /click (?:on )?the\s+([^\s.!?]+)/i,
      /点击["']?([^"']+)["']?/,
      /click\s+([^\s.!?]+)/i,
    ];

    for (const pattern of patterns) {
      const match = goal.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'button';
  }
}

// Export factory function
export function createReactAgent(
  memoryManager: MemoryManager,
  config?: ReactAgentConfig
): ReactAgent {
  return new ReactAgent(memoryManager, config);
}

