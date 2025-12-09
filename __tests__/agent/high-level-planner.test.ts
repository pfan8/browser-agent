/**
 * High-Level Planner Tests
 * 
 * Tests the task decomposition and replanning capabilities:
 * - Complex task decomposition into steps
 * - Valid plan structure generation
 * - Replanning on step failure
 * - Progress tracking
 * - Ambiguous task handling
 * - Checkpoint restoration with step skipping
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../../electron/agent/memory/memory-manager';
import { MockLLMService } from './mocks/mock-llm-service';
import { MockToolRegistry } from './mocks/mock-tool-registry';
import type { Observation, TaskPlan, TaskStep, ExecutionResult, StepResult } from '../../electron/agent/types';

// Create mock tool registry
const mockToolRegistry = new MockToolRegistry();

// Mock the tool registry module
vi.mock('../../electron/agent/tools/tool-registry', () => ({
  toolRegistry: mockToolRegistry,
}));

// Import planner after mocking
const { HighLevelPlanner } = await import('../../electron/agent/high-level-planner');

describe('HighLevelPlanner', () => {
  let planner: InstanceType<typeof HighLevelPlanner>;
  let memoryManager: MemoryManager;
  let mockLLM: MockLLMService;

  const defaultObservation: Observation = {
    timestamp: new Date().toISOString(),
    url: 'https://example.com',
    title: 'Example Page',
    visibleElements: [
      {
        selector: '#login-button',
        tag: 'button',
        text: 'Login',
        attributes: { id: 'login-button' },
        isVisible: true,
        isInteractable: true,
      },
      {
        selector: '#username',
        tag: 'input',
        text: '',
        attributes: { id: 'username', type: 'text' },
        isVisible: true,
        isInteractable: true,
      },
    ],
  };

  beforeEach(() => {
    mockToolRegistry.clear();
    
    memoryManager = new MemoryManager();
    mockLLM = new MockLLMService();
    
    planner = new HighLevelPlanner(memoryManager, {
      llmModel: 'claude-3-haiku-20240307',
      maxStepsPerPlan: 10,
      maxReplanAttempts: 3,
    });
    
    // Use mock LLM adapter
    planner.setLLMAdapter(mockLLM);
  });

  afterEach(() => {
    mockToolRegistry.clear();
    mockLLM.clearResponses();
    mockLLM.resetCounters();
  });

  describe('Task Decomposition', () => {
    it('should decompose complex task into steps', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Navigate to login page', tool: 'navigate', args: { url: 'https://example.com/login' } },
          { description: 'Enter username', tool: 'type', args: { selector: '#username', text: 'testuser' } },
          { description: 'Enter password', tool: 'type', args: { selector: '#password', text: 'testpass' } },
          { description: 'Click login button', tool: 'click', args: { selector: '#login-button' } },
        ],
        reasoning: 'Login flow requires navigation, credential entry, and button click',
      });

      const result = await planner.createPlan(
        'Login to the website with username testuser',
        defaultObservation
      );

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.steps.length).toBe(4);
      expect(result.plan!.steps[0].tool).toBe('navigate');
      expect(result.plan!.steps[3].tool).toBe('click');
    });

    it('should handle simple single-action tasks', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Click the button', tool: 'click', args: { selector: '#submit' } },
        ],
      });

      const result = await planner.createPlan(
        'Click the submit button',
        defaultObservation
      );

      expect(result.success).toBe(true);
      expect(result.plan!.steps.length).toBe(1);
    });

    it('should fall back to rule-based planning without LLM', async () => {
      // Create planner without LLM adapter
      const plannerNoLLM = new HighLevelPlanner(memoryManager, {
        llmModel: 'claude-3-haiku-20240307',
        maxStepsPerPlan: 10,
        maxReplanAttempts: 3,
      });

      const result = await plannerNoLLM.createPlan(
        'Go to https://google.com',
        defaultObservation
      );

      expect(result.success).toBe(true);
      expect(result.plan!.steps.length).toBeGreaterThan(0);
      expect(result.plan!.steps[0].tool).toBe('navigate');
    });
  });

  describe('Plan Structure', () => {
    it('should generate valid plan structure', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Step 1', tool: 'click', args: { selector: 'button' } },
          { description: 'Step 2', tool: 'wait', args: { ms: 1000 } },
        ],
      });

      const result = await planner.createPlan('Test task', defaultObservation);

      expect(result.plan).toBeDefined();
      const plan = result.plan!;
      
      // Check plan properties
      expect(plan.id).toBeDefined();
      expect(plan.goal).toBe('Test task');
      expect(plan.status).toBe('active');
      expect(plan.currentStepIndex).toBe(0);
      expect(plan.createdAt).toBeDefined();
      expect(plan.updatedAt).toBeDefined();
      
      // Check step properties
      plan.steps.forEach(step => {
        expect(step.id).toBeDefined();
        expect(step.description).toBeDefined();
        expect(step.tool).toBeDefined();
        expect(step.args).toBeDefined();
        expect(step.status).toBe('pending');
        expect(step.retryCount).toBe(0);
        expect(step.maxRetries).toBe(3);
      });
    });

    it('should include context in plan', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Step', tool: 'click', args: {} }],
      });

      const context = { sessionId: 'test-123', user: 'testuser' };
      const result = await planner.createPlan('Test', defaultObservation, context);

      expect(result.plan!.context).toEqual(context);
    });
  });

  describe('Replanning', () => {
    it('should replan on step failure', async () => {
      // Initial plan
      const initialPlan: TaskPlan = {
        id: 'plan_1',
        goal: 'Complete login',
        steps: [
          { id: 'step_1', description: 'Click login', tool: 'click', args: { selector: '#login' }, status: 'failed', retryCount: 3, maxRetries: 3 },
          { id: 'step_2', description: 'Fill form', tool: 'type', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Wait for page load', tool: 'wait', args: { ms: 1000 } },
          { description: 'Click login with different selector', tool: 'click', args: { selector: 'button.login' } },
          { description: 'Fill form', tool: 'type', args: {} },
        ],
        reasoning: 'Added wait and changed selector due to previous failure',
      });

      const failedStep = initialPlan.steps[0];
      const result = await planner.replan(
        initialPlan,
        failedStep,
        'Element not found',
        defaultObservation
      );

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.steps.length).toBeGreaterThan(0);
    });

    it('should fail after max replan attempts', async () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [{ id: 'step_1', description: 'Click', tool: 'click', args: {}, status: 'failed', retryCount: 0, maxRetries: 3 }],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Queue responses for each replan attempt
      for (let i = 0; i < 4; i++) {
        mockLLM.queuePlanResponse({
          steps: [{ description: 'Retry', tool: 'click', args: {} }],
        });
      }

      // Exhaust all replan attempts
      for (let i = 0; i < 3; i++) {
        await planner.replan(plan, plan.steps[0], 'Error', defaultObservation);
      }

      // Next attempt should fail
      const result = await planner.replan(plan, plan.steps[0], 'Error', defaultObservation);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Max replan attempts');
    });

    it('should include error context in replanned plan', async () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [{ id: 'step_1', description: 'Click', tool: 'click', args: {}, status: 'failed', retryCount: 0, maxRetries: 3 }],
        currentStepIndex: 0,
        context: { originalContext: true },
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockLLM.queuePlanResponse({
        steps: [{ description: 'Retry', tool: 'click', args: {} }],
      });

      const result = await planner.replan(plan, plan.steps[0], 'Element not found', defaultObservation);

      expect(result.plan!.context.previousError).toBe('Element not found');
      expect(result.plan!.context.replanCount).toBe(1);
    });
  });

  describe('Progress Tracking', () => {
    it('should track progress correctly', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
          { id: 'step_2', description: 'Step 2', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
          { id: 'step_3', description: 'Step 3', tool: 'click', args: {}, status: 'in_progress', retryCount: 0, maxRetries: 3 },
          { id: 'step_4', description: 'Step 4', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 2,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const progress = planner.getPlanProgress(plan);

      expect(progress.total).toBe(4);
      expect(progress.completed).toBe(2);
      expect(progress.failed).toBe(0);
      expect(progress.pending).toBe(2); // in_progress + pending
      expect(progress.percentage).toBe(50);
    });

    it('should update plan progress after step completion', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
          { id: 'step_2', description: 'Step 2', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const stepResult: ExecutionResult = {
        stepId: 'step_1',
        success: true,
        results: [{
          success: true,
          action: 'click',
          observation: defaultObservation,
          duration: 100,
          retryAttempt: 1,
        }],
        finalObservation: defaultObservation,
      };

      const updatedPlan = planner.updatePlanProgress(plan, stepResult);

      expect(updatedPlan.steps[0].status).toBe('completed');
      expect(updatedPlan.currentStepIndex).toBe(1);
    });

    it('should mark plan as complete when all steps succeed', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const stepResult: ExecutionResult = {
        stepId: 'step_1',
        success: true,
        results: [{ success: true, action: 'click', observation: defaultObservation, duration: 100, retryAttempt: 1 }],
        finalObservation: defaultObservation,
      };

      const updatedPlan = planner.updatePlanProgress(plan, stepResult);

      expect(updatedPlan.status).toBe('completed');
    });
  });

  describe('Ambiguous Task Handling', () => {
    it('should handle ambiguous tasks with fallback', async () => {
      // Create planner without LLM
      const plannerNoLLM = new HighLevelPlanner(memoryManager);

      const result = await plannerNoLLM.createPlan(
        'Do something',
        defaultObservation
      );

      // Should fall back to observe step
      expect(result.success).toBe(true);
      expect(result.plan!.steps.length).toBeGreaterThan(0);
    });

    it('should extract URL from natural language', async () => {
      const plannerNoLLM = new HighLevelPlanner(memoryManager);

      const result = await plannerNoLLM.createPlan(
        'Navigate to google.com',
        defaultObservation
      );

      expect(result.success).toBe(true);
      expect(result.plan!.steps[0].tool).toBe('navigate');
      expect(result.plan!.steps[0].args.url).toContain('google.com');
    });

    it('should detect login intent', async () => {
      const plannerNoLLM = new HighLevelPlanner(memoryManager);

      const result = await plannerNoLLM.createPlan(
        'Login with username admin and password secret',
        defaultObservation
      );

      expect(result.success).toBe(true);
      // Should have steps for typing username, password, and clicking login
      const tools = result.plan!.steps.map(s => s.tool);
      expect(tools).toContain('type');
      expect(tools).toContain('click');
    });
  });

  describe('Checkpoint Restoration', () => {
    it('should skip completed steps on restore', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
          { id: 'step_2', description: 'Step 2', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
          { id: 'step_3', description: 'Step 3', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 1,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const currentStep = planner.getCurrentStep(plan);

      // Should return step_2, not step_1
      expect(currentStep).toBeDefined();
      expect(currentStep!.id).toBe('step_2');
    });

    it('should return null when plan is complete', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 0,
        context: {},
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const currentStep = planner.getCurrentStep(plan);
      expect(currentStep).toBeNull();
    });

    it('should skip remaining steps correctly', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [
          { id: 'step_1', description: 'Step 1', tool: 'click', args: {}, status: 'completed', retryCount: 0, maxRetries: 3 },
          { id: 'step_2', description: 'Step 2', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
          { id: 'step_3', description: 'Step 3', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 },
        ],
        currentStepIndex: 1,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const updatedPlan = planner.skipRemainingSteps(plan, 1);

      expect(updatedPlan.steps[0].status).toBe('completed'); // Not changed
      expect(updatedPlan.steps[1].status).toBe('skipped');
      expect(updatedPlan.steps[2].status).toBe('skipped');
    });
  });

  describe('Plan Management', () => {
    it('should cancel a plan', () => {
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [{ id: 'step_1', description: 'Step', tool: 'click', args: {}, status: 'pending', retryCount: 0, maxRetries: 3 }],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const cancelledPlan = planner.cancelPlan(plan);

      expect(cancelledPlan.status).toBe('cancelled');
      expect(planner.isPlanComplete(cancelledPlan)).toBe(true);
    });

    it('should check if plan is complete', () => {
      const completedPlan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [],
        currentStepIndex: 0,
        context: {},
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const activePlan: TaskPlan = { ...completedPlan, status: 'active' };
      const failedPlan: TaskPlan = { ...completedPlan, status: 'failed' };

      expect(planner.isPlanComplete(completedPlan)).toBe(true);
      expect(planner.isPlanComplete(activePlan)).toBe(false);
      expect(planner.isPlanComplete(failedPlan)).toBe(true);
    });

    it('should reset replan count', () => {
      expect(planner.getReplanCount()).toBe(0);
      
      // Trigger a replan
      const plan: TaskPlan = {
        id: 'plan_1',
        goal: 'Test',
        steps: [{ id: 'step_1', description: 'Step', tool: 'click', args: {}, status: 'failed', retryCount: 0, maxRetries: 3 }],
        currentStepIndex: 0,
        context: {},
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockLLM.queuePlanResponse({ steps: [{ description: 'Retry', tool: 'click', args: {} }] });
      planner.replan(plan, plan.steps[0], 'Error', defaultObservation);
      
      expect(planner.getReplanCount()).toBe(1);
      
      planner.resetReplanCount();
      expect(planner.getReplanCount()).toBe(0);
    });
  });
});

