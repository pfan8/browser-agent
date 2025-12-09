/**
 * Mock LLM Service for Testing
 * 
 * Provides predictable LLM responses for testing
 * the agent's planning and thinking capabilities.
 */

import type { TaskStep, Observation, StepResult, ThinkingResult, TaskPlan, PlanningResult } from '../../../electron/agent/types';
import type { LLMAdapter } from '../../../electron/agent/low-level-executor';

export interface MockLLMResponse {
  thought: string;
  action: string;
  reasoning: string;
  confidence: number;
}

export interface MockPlanResponse {
  steps: Array<{
    description: string;
    tool: string;
    args: Record<string, unknown>;
  }>;
  reasoning?: string;
}

export class MockLLMService implements LLMAdapter {
  private thinkingResponses: MockLLMResponse[] = [];
  private planResponses: MockPlanResponse[] = [];
  private thinkCallCount: number = 0;
  private planCallCount: number = 0;

  /**
   * Queue a thinking response
   */
  queueThinkingResponse(response: MockLLMResponse): void {
    this.thinkingResponses.push(response);
  }

  /**
   * Queue multiple thinking responses
   */
  queueThinkingResponses(responses: MockLLMResponse[]): void {
    this.thinkingResponses.push(...responses);
  }

  /**
   * Queue a plan response
   */
  queuePlanResponse(response: MockPlanResponse): void {
    this.planResponses.push(response);
  }

  /**
   * Queue multiple plan responses
   */
  queuePlanResponses(responses: MockPlanResponse[]): void {
    this.planResponses.push(...responses);
  }

  /**
   * Clear all queued responses
   */
  clearResponses(): void {
    this.thinkingResponses = [];
    this.planResponses = [];
  }

  /**
   * Reset call counters
   */
  resetCounters(): void {
    this.thinkCallCount = 0;
    this.planCallCount = 0;
  }

  /**
   * Get think call count
   */
  getThinkCallCount(): number {
    return this.thinkCallCount;
  }

  /**
   * Get plan call count
   */
  getPlanCallCount(): number {
    return this.planCallCount;
  }

  /**
   * Implement LLMAdapter.think
   */
  async think(
    step: TaskStep,
    observation: Observation,
    previousAttempts: StepResult[],
    _context: Record<string, unknown>
  ): Promise<ThinkingResult> {
    this.thinkCallCount++;

    // Use queued response if available
    if (this.thinkingResponses.length > 0) {
      return this.thinkingResponses.shift()!;
    }

    // Generate default response based on step and attempts
    const attemptCount = previousAttempts.length;
    const lastError = previousAttempts[attemptCount - 1]?.error;

    if (attemptCount > 0 && lastError) {
      // Suggest retry with modification
      return {
        thought: `Previous attempt failed with: ${lastError}. Need to try different approach.`,
        action: step.tool,
        reasoning: `Modifying approach based on error. Current page: ${observation.title}`,
        confidence: 0.6,
      };
    }

    // Default success path
    return {
      thought: `Executing ${step.description} using ${step.tool}`,
      action: step.tool,
      reasoning: `Page is at ${observation.url}, proceeding with planned action`,
      confidence: 0.9,
    };
  }

  /**
   * Generate a task plan (for planner testing)
   */
  async generatePlan(
    task: string,
    observation: Observation,
    context: Record<string, unknown>,
    _availableTools?: string
  ): Promise<PlanningResult> {
    this.planCallCount++;

    // Use queued response if available
    if (this.planResponses.length > 0) {
      const response = this.planResponses.shift()!;
      
      const plan: TaskPlan = {
        id: `plan_${Date.now()}`,
        goal: task,
        steps: response.steps.map((s, i) => ({
          id: `step_${i}`,
          description: s.description,
          tool: s.tool,
          args: s.args,
          status: 'pending' as const,
          retryCount: 0,
          maxRetries: 3,
        })),
        currentStepIndex: 0,
        context: context,
        status: 'active' as const,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        success: true,
        plan,
        reasoning: response.reasoning || 'Plan generated successfully',
      };
    }

    // Generate default plan based on task keywords
    const steps = this.inferStepsFromTask(task, observation);

    const plan: TaskPlan = {
      id: `plan_${Date.now()}`,
      goal: task,
      steps,
      currentStepIndex: 0,
      context: context,
      status: 'active' as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      plan,
      reasoning: 'Default plan generated based on task analysis',
    };
  }

  /**
   * Infer steps from task description
   */
  private inferStepsFromTask(task: string, observation: Observation): TaskStep[] {
    const steps: TaskStep[] = [];
    const lowerTask = task.toLowerCase();

    // Navigation step if URL mentioned
    const urlMatch = task.match(/https?:\/\/[^\s]+/);
    if (urlMatch || lowerTask.includes('go to') || lowerTask.includes('navigate')) {
      steps.push({
        id: `step_${steps.length}`,
        description: 'Navigate to target page',
        tool: 'navigate',
        args: { url: urlMatch ? urlMatch[0] : observation.url },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
    }

    // Login flow detection
    if (lowerTask.includes('login') || lowerTask.includes('sign in')) {
      steps.push({
        id: `step_${steps.length}`,
        description: 'Enter username',
        tool: 'type',
        args: { selector: '#username', text: 'testuser' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
      steps.push({
        id: `step_${steps.length}`,
        description: 'Enter password',
        tool: 'type',
        args: { selector: '#password', text: 'testpass' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
      steps.push({
        id: `step_${steps.length}`,
        description: 'Click login button',
        tool: 'click',
        args: { selector: '#login-button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
    }

    // Click detection
    if (lowerTask.includes('click')) {
      const buttonMatch = task.match(/click (?:on )?["']?([^"']+)["']?/i);
      steps.push({
        id: `step_${steps.length}`,
        description: `Click on ${buttonMatch ? buttonMatch[1] : 'element'}`,
        tool: 'click',
        args: { selector: buttonMatch ? buttonMatch[1] : 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
    }

    // Type detection
    if (lowerTask.includes('type') || lowerTask.includes('enter') || lowerTask.includes('input')) {
      const typeMatch = task.match(/(?:type|enter|input) ["']([^"']+)["']/i);
      steps.push({
        id: `step_${steps.length}`,
        description: `Type text`,
        tool: 'type',
        args: { selector: 'input', text: typeMatch ? typeMatch[1] : 'text' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
    }

    // If no steps inferred, add a default observe step
    if (steps.length === 0) {
      steps.push({
        id: `step_0`,
        description: 'Observe current page state',
        tool: 'observe',
        args: {},
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      });
    }

    return steps;
  }

  /**
   * Re-plan on failure
   */
  async replan(
    currentPlan: TaskPlan,
    failedStep: TaskStep,
    error: string,
    observation: Observation
  ): Promise<PlanningResult> {
    this.planCallCount++;

    // Use queued response if available
    if (this.planResponses.length > 0) {
      const replanContext = {
        ...currentPlan.context,
        previousError: error,
        replanCount: ((currentPlan.context.replanCount as number) || 0) + 1,
      };
      return this.generatePlan(currentPlan.goal, observation, replanContext);
    }

    // Generate alternative approach
    const newSteps: TaskStep[] = [];
    
    // Add a wait step first
    newSteps.push({
      id: `step_${newSteps.length}`,
      description: 'Wait for page to stabilize',
      tool: 'wait',
      args: { ms: 1000 },
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
    });

    // Retry the failed step with modified approach
    newSteps.push({
      id: `step_${newSteps.length}`,
      description: `Retry: ${failedStep.description}`,
      tool: failedStep.tool,
      args: { ...failedStep.args },
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
    });

    // Add remaining steps from original plan
    const failedIndex = currentPlan.steps.findIndex(s => s.id === failedStep.id);
    for (let i = failedIndex + 1; i < currentPlan.steps.length; i++) {
      const step = currentPlan.steps[i];
      newSteps.push({
        ...step,
        id: `step_${newSteps.length}`,
        status: 'pending',
        retryCount: 0,
      });
    }

    const plan: TaskPlan = {
      id: `plan_${Date.now()}`,
      goal: currentPlan.goal,
      steps: newSteps,
      currentStepIndex: 0,
      context: {
        ...currentPlan.context,
        previousError: error,
        replanCount: ((currentPlan.context.replanCount as number) || 0) + 1,
      },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      plan,
      reasoning: `Re-planned after failure: ${error}`,
    };
  }
}

// Export singleton for tests
export const mockLLMService = new MockLLMService();

