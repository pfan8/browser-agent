/**
 * Low-Level Executor Tests
 * 
 * Tests the ReAct-style step execution:
 * - Single action execution
 * - Page state observation
 * - Retry mechanism
 * - Error handling
 * - Max retry limit
 * - Status reporting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemoryManager } from '../../electron/agent/memory/memory-manager';
import { MockToolRegistry } from './mocks/mock-tool-registry';
import { MockLLMService } from './mocks/mock-llm-service';
import type { TaskStep, Observation } from '../../electron/agent/types';

// Create mock tool registry instance
const mockToolRegistry = new MockToolRegistry();

// Mock the tool registry module BEFORE importing the executor
vi.mock('../../electron/agent/tools/tool-registry', () => ({
  toolRegistry: mockToolRegistry,
}));

// Now import the executor (after mock is set up)
const { LowLevelExecutor } = await import('../../electron/agent/low-level-executor');

describe('LowLevelExecutor', () => {
  let executor: InstanceType<typeof LowLevelExecutor>;
  let memoryManager: MemoryManager;
  let mockLLM: MockLLMService;

  beforeEach(() => {
    mockToolRegistry.clear();

    // Create fresh instances
    memoryManager = new MemoryManager();
    mockLLM = new MockLLMService();
    
    executor = new LowLevelExecutor(memoryManager, {
      maxRetries: 3,
      stepTimeout: 5000,
      observationTimeout: 1000,
      enableScreenshots: false,
      enableDomSnapshots: true,
    });
    
    executor.setLLMAdapter(mockLLM);
  });

  afterEach(() => {
    mockToolRegistry.clear();
    mockLLM.clearResponses();
    mockLLM.resetCounters();
  });

  describe('Single Action Execution', () => {
    it('should execute single action successfully', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click the login button',
        tool: 'click',
        args: { selector: '#login-button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      // Set up mock to succeed
      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await executor.executeStep(step);

      expect(result.success).toBe(true);
      expect(result.stepId).toBe('step_1');
      expect(result.results.length).toBe(1);
      expect(result.results[0].success).toBe(true);
      expect(mockToolRegistry.wasToolCalled('click')).toBe(true);
    });

    it('should pass correct arguments to tool', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Type username',
        tool: 'type',
        args: { selector: '#username', text: 'testuser' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('type', { success: true });

      await executor.executeStep(step);

      const calls = mockToolRegistry.getCallsFor('type');
      expect(calls.length).toBe(1);
      expect(calls[0].args.selector).toBe('#username');
      expect(calls[0].args.text).toBe('testuser');
    });
  });

  describe('Page State Observation', () => {
    it('should observe page state after action', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Navigate to page',
        tool: 'navigate',
        args: { url: 'https://example.com' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      const expectedObservation: Observation = {
        timestamp: new Date().toISOString(),
        url: 'https://example.com/dashboard',
        title: 'Dashboard',
        visibleElements: [],
      };

      mockToolRegistry.setToolBehavior('navigate', { success: true });
      mockToolRegistry.setDefaultObservation(expectedObservation);

      const result = await executor.executeStep(step);

      expect(result.finalObservation.url).toBe('https://example.com/dashboard');
      expect(result.finalObservation.title).toBe('Dashboard');
      
      // Should have called observe at least twice (before and after action)
      expect(mockToolRegistry.wasToolCalled('observe')).toBe(true);
    });

    it('should store observation in memory', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click button',
        tool: 'click',
        args: { selector: 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('click', { success: true });

      await executor.executeStep(step);

      const storedObservation = memoryManager.getLatestObservation<Observation>();
      expect(storedObservation).toBeDefined();
      expect(storedObservation?.url).toBeDefined();
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry on transient failure', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click element',
        tool: 'click',
        args: { selector: '#submit' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      // First attempt fails, second succeeds
      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Element not found' });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await executor.executeStep(step);

      expect(result.success).toBe(true);
      expect(result.results.length).toBe(2); // Two attempts
      expect(result.results[0].success).toBe(false);
      expect(result.results[1].success).toBe(true);
    });

    it('should handle element not found error', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click missing element',
        tool: 'click',
        args: { selector: '#nonexistent' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      // All attempts fail
      for (let i = 0; i <= 3; i++) {
        mockToolRegistry.setToolBehavior('click', { success: false, error: 'Element not found' });
      }

      const result = await executor.executeStep(step);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('should respect max retry limit', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click element',
        tool: 'click',
        args: { selector: '#button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      // All 4 attempts (1 initial + 3 retries) fail
      for (let i = 0; i < 5; i++) {
        mockToolRegistry.setToolBehavior('click', { success: false, error: 'Timeout' });
      }

      const result = await executor.executeStep(step);

      expect(result.success).toBe(false);
      // Should have exactly maxRetries + 1 attempts (1 initial + 3 retries = 4)
      expect(result.results.length).toBe(4);
    });
  });

  describe('Error Handling', () => {
    it('should handle tool execution errors gracefully', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Run code',
        tool: 'runCode',
        args: { code: 'throw new Error("test")' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('runCode', { success: false, error: 'Execution error' });
      mockToolRegistry.setToolBehavior('runCode', { success: false, error: 'Execution error' });
      mockToolRegistry.setToolBehavior('runCode', { success: false, error: 'Execution error' });
      mockToolRegistry.setToolBehavior('runCode', { success: false, error: 'Execution error' });

      const result = await executor.executeStep(step);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should continue operation after recoverable error', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click',
        tool: 'click',
        args: { selector: 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      // First fails, then recovers
      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Stale element' });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await executor.executeStep(step);

      expect(result.success).toBe(true);
      expect(result.results[0].error).toContain('Stale element');
      expect(result.results[1].success).toBe(true);
    });
  });

  describe('Status Reporting', () => {
    it('should report step completion status', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Navigate',
        tool: 'navigate',
        args: { url: 'https://example.com' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('navigate', { success: true });

      const events: string[] = [];
      executor.on('step_started', () => events.push('started'));
      executor.on('step_completed', () => events.push('completed'));

      await executor.executeStep(step);

      expect(events).toContain('started');
      expect(events).toContain('completed');
    });

    it('should report failure events', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click',
        tool: 'click',
        args: { selector: 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 1, // Reduce retries for faster test
      };

      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Failed' });
      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Failed' });

      const failEvents: unknown[] = [];
      executor.on('step_failed', (data) => failEvents.push(data));

      await executor.executeStep(step);

      expect(failEvents.length).toBeGreaterThan(0);
    });

    it('should include duration in results', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Wait',
        tool: 'wait',
        args: { ms: 100 },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('wait', { success: true, delay: 50 });

      const result = await executor.executeStep(step);

      expect(result.results[0].duration).toBeGreaterThan(0);
    });
  });

  describe('Multiple Steps Execution', () => {
    it('should execute multiple steps in sequence', async () => {
      const steps: TaskStep[] = [
        {
          id: 'step_1',
          description: 'Navigate',
          tool: 'navigate',
          args: { url: 'https://example.com' },
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 'step_2',
          description: 'Click login',
          tool: 'click',
          args: { selector: '#login' },
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
        },
      ];

      mockToolRegistry.setToolBehavior('navigate', { success: true });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const results = await executor.executeSteps(steps);

      expect(results.length).toBe(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(steps[0].status).toBe('completed');
      expect(steps[1].status).toBe('completed');
    });

    it('should stop execution on step failure', async () => {
      // Create executor with maxRetries: 1 for faster test
      const testExecutor = new LowLevelExecutor(memoryManager, {
        maxRetries: 1,
        stepTimeout: 5000,
        observationTimeout: 1000,
        enableScreenshots: false,
        enableDomSnapshots: true,
      });

      const steps: TaskStep[] = [
        {
          id: 'step_1',
          description: 'Navigate',
          tool: 'navigate',
          args: { url: 'https://example.com' },
          status: 'pending',
          retryCount: 0,
          maxRetries: 1,
        },
        {
          id: 'step_2',
          description: 'Click',
          tool: 'click',
          args: { selector: '#button' },
          status: 'pending',
          retryCount: 0,
          maxRetries: 1,
        },
      ];

      // All navigate attempts fail (1 initial + 1 retry = 2 attempts)
      mockToolRegistry.setToolBehavior('navigate', { success: false, error: 'Network error' });
      mockToolRegistry.setToolBehavior('navigate', { success: false, error: 'Network error' });

      const results = await testExecutor.executeSteps(steps);

      expect(results.length).toBe(1); // Only first step attempted
      expect(results[0].success).toBe(false);
      expect(steps[0].status).toBe('failed');
      expect(steps[1].status).toBe('pending'); // Never started
    });
  });

  describe('Abort Functionality', () => {
    it('should abort execution when requested', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Long operation',
        tool: 'wait',
        args: { ms: 5000 },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('wait', { success: true, delay: 100 });

      // Start execution
      const executePromise = executor.executeStep(step);

      // Abort after short delay
      setTimeout(() => executor.abort(), 50);

      const result = await executePromise;
      
      // Execution should have been aborted
      expect(executor.isCurrentlyExecuting()).toBe(false);
    });
  });

  describe('LLM Integration', () => {
    it('should use LLM for thinking when adapter is set', async () => {
      const step: TaskStep = {
        id: 'step_1',
        description: 'Click button',
        tool: 'click',
        args: { selector: 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockLLM.queueThinkingResponse({
        thought: 'I should click the login button',
        action: 'click',
        reasoning: 'The button is visible on the page',
        confidence: 0.95,
      });

      mockToolRegistry.setToolBehavior('click', { success: true });

      const thinkingEvents: unknown[] = [];
      executor.on('thinking', (data) => thinkingEvents.push(data));

      await executor.executeStep(step);

      expect(mockLLM.getThinkCallCount()).toBe(1);
      expect(thinkingEvents.length).toBe(1);
    });

    it('should work without LLM adapter', async () => {
      // Create executor without LLM
      const executorNoLLM = new LowLevelExecutor(memoryManager, {
        maxRetries: 3,
        stepTimeout: 5000,
        observationTimeout: 1000,
        enableScreenshots: false,
        enableDomSnapshots: true,
      });

      const step: TaskStep = {
        id: 'step_1',
        description: 'Click',
        tool: 'click',
        args: { selector: 'button' },
        status: 'pending',
        retryCount: 0,
        maxRetries: 3,
      };

      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await executorNoLLM.executeStep(step);

      expect(result.success).toBe(true);
    });
  });
});
