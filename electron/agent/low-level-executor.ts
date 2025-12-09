/**
 * Low-Level Executor (ReAct)
 * 
 * Executes individual task steps using the ReAct pattern:
 * Observe → Think → Act → Verify
 * 
 * Handles retries, error recovery, and detailed observation.
 */

import { EventEmitter } from 'events';
import type {
  TaskStep,
  StepResult,
  ExecutionResult,
  Observation,
  ThinkingResult,
  ToolExecutionResult,
  AgentConfig,
  AgentEvent,
} from './types';
import { generateId, DEFAULT_AGENT_CONFIG } from './types';
import { toolRegistry } from './tools/tool-registry';
import { MemoryManager } from './memory/memory-manager';

export interface ExecutorConfig {
  maxRetries: number;
  stepTimeout: number;
  observationTimeout: number;
  enableScreenshots: boolean;
  enableDomSnapshots: boolean;
}

export interface LLMAdapter {
  think(
    step: TaskStep,
    observation: Observation,
    previousAttempts: StepResult[],
    context: Record<string, unknown>
  ): Promise<ThinkingResult>;
}

export class LowLevelExecutor extends EventEmitter {
  private config: ExecutorConfig;
  private memoryManager: MemoryManager;
  private llmAdapter: LLMAdapter | null = null;
  private isExecuting: boolean = false;
  private shouldAbort: boolean = false;

  constructor(
    memoryManager: MemoryManager,
    config?: Partial<ExecutorConfig>
  ) {
    super();
    this.memoryManager = memoryManager;
    this.config = {
      maxRetries: config?.maxRetries ?? DEFAULT_AGENT_CONFIG.maxStepRetries,
      stepTimeout: config?.stepTimeout ?? DEFAULT_AGENT_CONFIG.stepTimeout,
      observationTimeout: config?.observationTimeout ?? DEFAULT_AGENT_CONFIG.observationTimeout,
      enableScreenshots: config?.enableScreenshots ?? DEFAULT_AGENT_CONFIG.enableScreenshots,
      enableDomSnapshots: config?.enableDomSnapshots ?? DEFAULT_AGENT_CONFIG.enableDomSnapshots,
    };
  }

  /**
   * Set the LLM adapter for thinking/reasoning
   */
  setLLMAdapter(adapter: LLMAdapter): void {
    this.llmAdapter = adapter;
  }

  /**
   * Execute a single step with ReAct pattern
   */
  async executeStep(
    step: TaskStep,
    context: Record<string, unknown> = {}
  ): Promise<ExecutionResult> {
    this.isExecuting = true;
    this.shouldAbort = false;
    
    const results: StepResult[] = [];
    let finalObservation: Observation;

    this.emitEvent('step_started', { step });

    try {
      // Initial observation
      finalObservation = await this.observe();
      this.memoryManager.storeObservation(finalObservation);

      let attempt = 0;
      let success = false;

      while (attempt <= this.config.maxRetries && !success && !this.shouldAbort) {
        const startTime = Date.now();
        attempt++;

        try {
          // 1. THINK - Determine the best action (if LLM adapter available)
          let actionArgs = step.args;
          
          if (this.llmAdapter) {
            const thinking = await this.think(step, finalObservation, results, context);
            this.emitEvent('thinking', { step, thinking });
            
            // LLM might suggest modified args or a different approach
            if (thinking.confidence > 0.7) {
              // Could parse thinking.action to modify args if needed
              // For now, we trust the original step args
            }
          }

          // 2. ACT - Execute the tool
          const toolResult = await this.executeToolWithTimeout(step.tool, actionArgs);

          // 3. OBSERVE - Get new page state
          finalObservation = await this.observe();
          this.memoryManager.storeObservation(finalObservation);

          const stepResult: StepResult = {
            success: toolResult.success,
            action: `${step.tool}(${JSON.stringify(actionArgs)})`,
            observation: finalObservation,
            error: toolResult.error,
            duration: Date.now() - startTime,
            retryAttempt: attempt,
          };

          results.push(stepResult);

          if (toolResult.success) {
            // 4. VERIFY - Check if the step achieved its goal
            const verified = await this.verifyStepSuccess(step, finalObservation, toolResult);
            
            if (verified) {
              success = true;
              this.emitEvent('step_completed', { step, result: stepResult });
            } else {
              // Tool succeeded but verification failed - might need different approach
              stepResult.success = false;
              stepResult.error = 'Verification failed - action completed but goal not achieved';
              this.emitEvent('step_failed', { 
                step, 
                result: stepResult, 
                willRetry: attempt < this.config.maxRetries 
              });
            }
          } else {
            this.emitEvent('step_failed', { 
              step, 
              result: stepResult, 
              willRetry: attempt < this.config.maxRetries 
            });
          }
        } catch (error) {
          const stepResult: StepResult = {
            success: false,
            action: `${step.tool}(${JSON.stringify(step.args)})`,
            observation: finalObservation,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: Date.now() - startTime,
            retryAttempt: attempt,
          };

          results.push(stepResult);
          this.emitEvent('step_failed', { 
            step, 
            result: stepResult, 
            willRetry: attempt < this.config.maxRetries,
            error 
          });
        }

        // Wait before retry
        if (!success && attempt < this.config.maxRetries && !this.shouldAbort) {
          await this.sleep(Math.min(1000 * attempt, 3000)); // Exponential backoff, max 3s
        }
      }

      this.isExecuting = false;

      return {
        stepId: step.id,
        success,
        results,
        finalObservation,
        error: success ? undefined : results[results.length - 1]?.error,
      };
    } catch (error) {
      this.isExecuting = false;
      
      return {
        stepId: step.id,
        success: false,
        results,
        finalObservation: finalObservation!,
        error: error instanceof Error ? error.message : 'Execution failed',
      };
    }
  }

  /**
   * Observe the current page state
   */
  async observe(): Promise<Observation> {
    const observeResult = await toolRegistry.execute('observe', {
      includeScreenshot: this.config.enableScreenshots,
      includeElements: this.config.enableDomSnapshots,
    });

    if (observeResult.success && observeResult.data) {
      return observeResult.data as Observation;
    }

    // Fallback observation if tool fails
    const pageInfoResult = await toolRegistry.execute('getPageInfo', {});
    const pageInfo = pageInfoResult.data as { url: string; title: string } | undefined;

    return {
      timestamp: new Date().toISOString(),
      url: pageInfo?.url || 'unknown',
      title: pageInfo?.title || 'unknown',
      error: observeResult.error,
    };
  }

  /**
   * Think about the best action for the current step
   */
  private async think(
    step: TaskStep,
    observation: Observation,
    previousAttempts: StepResult[],
    context: Record<string, unknown>
  ): Promise<ThinkingResult> {
    if (!this.llmAdapter) {
      // Default thinking without LLM
      return {
        thought: `Executing step: ${step.description}`,
        action: step.tool,
        reasoning: 'Using predefined step configuration',
        confidence: 0.8,
      };
    }

    return this.llmAdapter.think(step, observation, previousAttempts, context);
  }

  /**
   * Execute a tool with timeout
   */
  private async executeToolWithTimeout(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolExecutionResult> {
    return new Promise(async (resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Tool execution timed out after ${this.config.stepTimeout}ms`,
          duration: this.config.stepTimeout,
        });
      }, this.config.stepTimeout);

      try {
        const result = await toolRegistry.execute(toolName, args);
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
          duration: 0,
        });
      }
    });
  }

  /**
   * Verify that a step achieved its intended goal
   */
  private async verifyStepSuccess(
    step: TaskStep,
    observation: Observation,
    toolResult: ToolExecutionResult
  ): Promise<boolean> {
    // Basic verification - tool succeeded
    if (!toolResult.success) {
      return false;
    }

    // Check for common failure indicators in observation
    if (observation.error) {
      return false;
    }

    // Tool-specific verification
    switch (step.tool) {
      case 'navigate':
        // Verify URL changed (or stayed same if expected)
        const targetUrl = step.args.url as string;
        if (targetUrl && !observation.url.includes(targetUrl.replace(/^https?:\/\//, '').split('/')[0])) {
          // URL doesn't contain expected domain - might be redirect
          // Still consider it success if no error
        }
        return true;

      case 'click':
        // Click verification is tricky - we trust the tool result
        // Could add element-specific verification in the future
        return true;

      case 'type':
        // Type verification - trust the tool result
        return true;

      case 'waitForSelector':
        // If waitForSelector succeeded, the element was found
        return true;

      default:
        // For other tools, trust the tool result
        return true;
    }
  }

  /**
   * Abort the current execution
   */
  abort(): void {
    this.shouldAbort = true;
  }

  /**
   * Check if currently executing
   */
  isCurrentlyExecuting(): boolean {
    return this.isExecuting;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Emit an agent event
   */
  private emitEvent(type: string, data: unknown): void {
    const event: AgentEvent = {
      type: type as AgentEvent['type'],
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ExecutorConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): ExecutorConfig {
    return { ...this.config };
  }

  /**
   * Execute multiple steps in sequence
   */
  async executeSteps(
    steps: TaskStep[],
    context: Record<string, unknown> = {},
    onStepComplete?: (stepIndex: number, result: ExecutionResult) => void
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (let i = 0; i < steps.length; i++) {
      if (this.shouldAbort) {
        break;
      }

      const step = steps[i];
      step.status = 'in_progress';

      const result = await this.executeStep(step, context);
      results.push(result);

      step.status = result.success ? 'completed' : 'failed';
      step.result = result.results[result.results.length - 1];
      step.retryCount = result.results.length - 1;

      if (onStepComplete) {
        onStepComplete(i, result);
      }

      // Stop if step failed and no more retries possible
      if (!result.success) {
        break;
      }
    }

    return results;
  }
}

