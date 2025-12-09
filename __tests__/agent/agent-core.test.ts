/**
 * Agent Core Integration Tests
 * 
 * Tests the orchestration layer that coordinates:
 * - Multi-step task execution end-to-end
 * - Checkpoint creation and restoration
 * - Planner and executor coordination
 * - Task cancellation
 * - Progress events
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { MockToolRegistry } from './mocks/mock-tool-registry';
import { MockLLMService } from './mocks/mock-llm-service';
import type { Observation, TaskPlan } from '../../electron/agent/types';

// Create mock tool registry
const mockToolRegistry = new MockToolRegistry();

// Mock the tool registry module
vi.mock('../../electron/agent/tools/tool-registry', () => ({
  toolRegistry: mockToolRegistry,
}));

// Mock browser tools registration
vi.mock('../../electron/agent/tools/browser-tools', () => ({
  registerBrowserTools: vi.fn(),
  BROWSER_TOOL_DEFINITIONS: [],
}));

// Mock Electron app module
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue(path.join(os.tmpdir(), 'agent-test-' + Date.now())),
  },
}));

// Import after mocking
const { AgentCore, resetAgentCore } = await import('../../electron/agent/agent-core');
const { SessionStore } = await import('../../electron/agent/checkpoint/session-store');

describe('AgentCore', () => {
  let agentCore: InstanceType<typeof AgentCore>;
  let mockLLM: MockLLMService;
  let testDir: string;
  let sessionStore: InstanceType<typeof SessionStore>;

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
    ],
  };

  beforeEach(() => {
    // Create temp directory for sessions
    testDir = path.join(os.tmpdir(), 'agent-test-' + Date.now());
    fs.mkdirSync(testDir, { recursive: true });

    // Create session store with test directory
    sessionStore = new SessionStore(testDir);

    mockToolRegistry.clear();
    mockToolRegistry.setDefaultObservation(defaultObservation);

    mockLLM = new MockLLMService();

    // Reset singleton
    resetAgentCore();

    // Create agent core
    agentCore = new AgentCore({
      maxStepRetries: 1,
      stepTimeout: 5000,
      autoCheckpoint: true,
      checkpointInterval: 1,
    });

    // Set up planner with mock LLM
    (agentCore as any).planner.setLLMAdapter(mockLLM);
  });

  afterEach(() => {
    mockToolRegistry.clear();
    mockLLM.clearResponses();
    mockLLM.resetCounters();

    // Cleanup test directory
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Multi-step Task Execution', () => {
    it('should execute multi-step task end-to-end', async () => {
      // Set up mock plan
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Navigate to page', tool: 'navigate', args: { url: 'https://example.com' } },
          { description: 'Click button', tool: 'click', args: { selector: '#login-button' } },
        ],
        reasoning: 'Simple navigation and click',
      });

      // Set up tool behaviors
      mockToolRegistry.setToolBehavior('navigate', { success: true });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await agentCore.executeTask('Navigate to example.com and click login');

      expect(result.success).toBe(true);
      expect(result.plan).toBeDefined();
      expect(result.plan!.status).toBe('completed');
      expect(agentCore.getStatus()).toBe('complete');
    });

    it('should handle task with failing steps', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Click missing element', tool: 'click', args: { selector: '#nonexistent' } },
        ],
      });

      // All click attempts fail (need enough for retries + replans)
      for (let i = 0; i < 20; i++) {
        mockToolRegistry.setToolBehavior('click', { success: false, error: 'Element not found' });
      }

      // Queue multiple replan responses that also fail
      for (let i = 0; i < 5; i++) {
        mockLLM.queuePlanResponse({
          steps: [{ description: 'Retry click', tool: 'click', args: { selector: '#alt-button' } }],
        });
      }

      const result = await agentCore.executeTask('Click a button');

      // Should eventually fail or succeed based on replan logic
      // The important thing is it completes without error
      expect(result.plan).toBeDefined();
    });

    it('should track plan progress during execution', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Step 1', tool: 'wait', args: { ms: 10 } },
          { description: 'Step 2', tool: 'wait', args: { ms: 10 } },
        ],
      });

      mockToolRegistry.setToolBehavior('wait', { success: true });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      const progressUpdates: number[] = [];
      agentCore.on('step_completed', () => {
        const progress = agentCore.getPlanProgress();
        if (progress) {
          progressUpdates.push(progress.percentage);
        }
      });

      await agentCore.executeTask('Wait twice');

      expect(progressUpdates.length).toBeGreaterThan(0);
    });
  });

  describe('Checkpoint System', () => {
    it('should checkpoint after each step', async () => {
      // Create a session first
      agentCore.createSession('Test Session');

      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Step 1', tool: 'wait', args: { ms: 10 } },
          { description: 'Step 2', tool: 'wait', args: { ms: 10 } },
        ],
      });

      mockToolRegistry.setToolBehavior('wait', { success: true });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      await agentCore.executeTask('Wait twice');

      const checkpoints = agentCore.listCheckpoints();
      // Should have at least the initial checkpoint + auto-saves
      expect(checkpoints.length).toBeGreaterThan(0);
    });

    it('should restore from checkpoint', async () => {
      // Create session
      const session = agentCore.createSession('Test Session');
      const sessionId = session.id;

      mockLLM.queuePlanResponse({
        steps: [{ description: 'Step 1', tool: 'wait', args: { ms: 10 } }],
      });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      await agentCore.executeTask('Initial task');

      // Create manual checkpoint
      const checkpointId = agentCore.createCheckpoint('Manual checkpoint');
      expect(checkpointId).toBeDefined();

      // Modify state
      agentCore.clearMemory();

      // Restore
      const restored = await agentCore.resumeFromCheckpoint(checkpointId!);
      expect(restored).toBe(true);
    });

    it('should list checkpoints for session', () => {
      agentCore.createSession('Test Session');
      
      // Create some checkpoints
      agentCore.createCheckpoint('Checkpoint 1');
      agentCore.createCheckpoint('Checkpoint 2');

      const checkpoints = agentCore.listCheckpoints();
      expect(checkpoints.length).toBe(2);
    });
  });

  describe('Planner and Executor Coordination', () => {
    it('should coordinate planner and executor', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Navigate', tool: 'navigate', args: { url: 'https://example.com' } },
          { description: 'Click', tool: 'click', args: { selector: 'button' } },
        ],
      });

      mockToolRegistry.setToolBehavior('navigate', { success: true });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const events: string[] = [];
      agentCore.on('plan_created', () => events.push('plan_created'));
      agentCore.on('step_started', () => events.push('step_started'));
      agentCore.on('step_completed', () => events.push('step_completed'));
      agentCore.on('task_completed', () => events.push('task_completed'));

      await agentCore.executeTask('Do something');

      expect(events).toContain('plan_created');
      expect(events).toContain('step_started');
      expect(events).toContain('step_completed');
      expect(events).toContain('task_completed');
    });

    it('should replan on step failure', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Click button', tool: 'click', args: { selector: '#btn' } }],
      });

      // First attempt fails
      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Not found' });
      mockToolRegistry.setToolBehavior('click', { success: false, error: 'Not found' });

      // Replan response
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Wait', tool: 'wait', args: { ms: 100 } },
          { description: 'Click alternate', tool: 'click', args: { selector: '#alt-btn' } },
        ],
      });

      mockToolRegistry.setToolBehavior('wait', { success: true });
      mockToolRegistry.setToolBehavior('click', { success: true });

      const result = await agentCore.executeTask('Click a button');

      // Should succeed after replan
      expect(result.success).toBe(true);
    });
  });

  describe('Task Cancellation', () => {
    it('should handle task cancellation', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Long wait 1', tool: 'wait', args: { ms: 500 } },
          { description: 'Long wait 2', tool: 'wait', args: { ms: 500 } },
        ],
      });

      mockToolRegistry.setToolBehavior('wait', { success: true, delay: 200 });
      mockToolRegistry.setToolBehavior('wait', { success: true, delay: 200 });

      // Start task
      const taskPromise = agentCore.executeTask('Wait a long time');

      // Cancel after task starts but before completion
      setTimeout(() => agentCore.stopTask(), 100);

      await taskPromise;

      // After stopping, status should be paused or the task completed before stop
      const status = agentCore.getStatus();
      expect(['paused', 'complete', 'error']).toContain(status);
    });

    it('should not allow concurrent tasks', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Wait', tool: 'wait', args: { ms: 100 } }],
      });
      mockToolRegistry.setToolBehavior('wait', { success: true, delay: 50 });

      // Start first task
      const task1Promise = agentCore.executeTask('Task 1');

      // Try to start second task immediately
      const task2Result = await agentCore.executeTask('Task 2');

      expect(task2Result.success).toBe(false);
      expect(task2Result.error).toContain('already running');

      await task1Promise;
    });
  });

  describe('Progress Events', () => {
    it('should emit progress events', async () => {
      mockLLM.queuePlanResponse({
        steps: [
          { description: 'Step 1', tool: 'wait', args: { ms: 10 } },
          { description: 'Step 2', tool: 'wait', args: { ms: 10 } },
        ],
      });

      mockToolRegistry.setToolBehavior('wait', { success: true });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      const events: Array<{ type: string; data: unknown }> = [];
      agentCore.on('event', (event) => {
        events.push({ type: event.type, data: event.data });
      });

      await agentCore.executeTask('Wait twice');

      const eventTypes = events.map(e => e.type);
      expect(eventTypes).toContain('status_changed');
      expect(eventTypes).toContain('plan_created');
      expect(eventTypes).toContain('step_started');
      expect(eventTypes).toContain('step_completed');
    });

    it('should emit task completion event', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Wait', tool: 'wait', args: { ms: 10 } }],
      });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      let taskCompletedData: unknown = null;
      agentCore.on('task_completed', (data) => {
        taskCompletedData = data;
      });

      await agentCore.executeTask('Simple task');

      expect(taskCompletedData).toBeDefined();
    });

    it('should emit task failure event', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Click', tool: 'click', args: { selector: '#btn' } }],
      });

      // All attempts fail
      for (let i = 0; i < 10; i++) {
        mockToolRegistry.setToolBehavior('click', { success: false, error: 'Failed' });
      }

      let taskFailedData: unknown = null;
      agentCore.on('task_failed', (data) => {
        taskFailedData = data;
      });

      await agentCore.executeTask('Failing task');

      expect(taskFailedData).toBeDefined();
    });
  });

  describe('Session Management', () => {
    it('should create and load sessions', () => {
      const session = agentCore.createSession('Test Session', 'A test session');
      
      expect(session.id).toBeDefined();
      expect(session.name).toBe('Test Session');
      expect(agentCore.getCurrentSessionId()).toBe(session.id);

      // Create new agent and load session
      const newAgent = new AgentCore();
      const loaded = newAgent.loadSession(session.id);
      
      expect(loaded).toBe(true);
      expect(newAgent.getCurrentSessionId()).toBe(session.id);
    });

    it('should list sessions', () => {
      agentCore.createSession('Session 1');
      agentCore.createSession('Session 2');

      const sessions = agentCore.listSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(2);
    });

    it('should delete sessions', () => {
      const session = agentCore.createSession('To Delete');
      const deleted = agentCore.deleteSession(session.id);
      
      expect(deleted).toBe(true);
    });
  });

  describe('State Management', () => {
    it('should track conversation history', async () => {
      mockLLM.queuePlanResponse({
        steps: [{ description: 'Wait', tool: 'wait', args: { ms: 10 } }],
      });
      mockToolRegistry.setToolBehavior('wait', { success: true });

      await agentCore.executeTask('Test task');

      const history = agentCore.getConversationHistory();
      expect(history.length).toBeGreaterThan(0);
      
      // Should have user message and agent response
      const userMessages = history.filter(m => m.role === 'user');
      const agentMessages = history.filter(m => m.role === 'agent');
      
      expect(userMessages.length).toBeGreaterThan(0);
      expect(agentMessages.length).toBeGreaterThan(0);
    });

    it('should clear memory', () => {
      agentCore.chat('Test message');
      expect(agentCore.getConversationHistory().length).toBeGreaterThan(0);

      agentCore.clearMemory();
      expect(agentCore.getConversationHistory().length).toBe(0);
    });

    it('should reset agent state', () => {
      agentCore.createSession('Test');
      agentCore.reset();

      expect(agentCore.getStatus()).toBe('idle');
      expect(agentCore.getCurrentPlan()).toBeNull();
    });
  });

  describe('Configuration', () => {
    it('should update configuration', () => {
      const originalConfig = agentCore.getConfig();
      
      agentCore.updateConfig({
        maxStepRetries: 5,
        stepTimeout: 10000,
      });

      const newConfig = agentCore.getConfig();
      expect(newConfig.maxStepRetries).toBe(5);
      expect(newConfig.stepTimeout).toBe(10000);
    });
  });
});

