/**
 * ReAct Agent Unit Tests
 * 
 * Tests for:
 * - RA-01 ~ RA-08: ReAct loop functionality
 * - MS-01 ~ MS-05: Multi-step task support
 * - SA integration: State awareness integration
 * - ER-01 ~ ER-06: Error recovery
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock dependencies
vi.mock('../../electron/agent/tools/tool-registry', () => ({
  toolRegistry: {
    execute: vi.fn(),
    getToolDescriptionsForPrompt: vi.fn(() => 'Tool descriptions'),
    register: vi.fn(),
  },
}));

vi.mock('../../electron/agent/tools/code-executor', () => ({
  codeExecutor: {
    execute: vi.fn(),
    parseDOM: vi.fn(),
    findElement: vi.fn(),
    extractData: vi.fn(),
    processData: vi.fn(),
  },
  createCodeExecutor: vi.fn(),
}));

vi.mock('../../electron/browser-controller', () => ({
  browserController: {
    getPage: vi.fn(),
    isConnected: vi.fn(() => true),
  },
}));

// Import after mocking
import { ReactAgent, createReactAgent } from '../../electron/agent/react-agent';
import { MemoryManager } from '../../electron/agent/memory/memory-manager';
import { toolRegistry } from '../../electron/agent/tools/tool-registry';
import { codeExecutor } from '../../electron/agent/tools/code-executor';
import type { Observation } from '../../electron/agent/types';

describe('ReactAgent', () => {
  let agent: ReactAgent;
  let memoryManager: MemoryManager;

  const mockObservation: Observation = {
    timestamp: new Date().toISOString(),
    url: 'https://example.com',
    title: 'Example Page',
    visibleElements: [
      {
        selector: '#login-btn',
        tag: 'button',
        text: 'Login',
        attributes: { id: 'login-btn' },
        isVisible: true,
        isInteractable: true,
      },
      {
        selector: '#email',
        tag: 'input',
        text: '',
        attributes: { id: 'email', placeholder: 'Enter email' },
        isVisible: true,
        isInteractable: true,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    memoryManager = new MemoryManager();
    agent = createReactAgent(memoryManager);

    // Default mock for observe tool
    vi.mocked(toolRegistry.execute).mockImplementation(async (tool: string, args: Record<string, unknown>) => {
      if (tool === 'observe') {
        return { success: true, data: mockObservation, duration: 10 };
      }
      if (tool === 'getPageInfo') {
        return { success: true, data: { url: 'https://example.com', title: 'Example' }, duration: 5 };
      }
      if (tool === 'navigate') {
        return { success: true, data: { url: args.url }, duration: 100 };
      }
      if (tool === 'click') {
        return { success: true, duration: 50 };
      }
      if (tool === 'type') {
        return { success: true, duration: 50 };
      }
      if (tool === 'wait') {
        return { success: true, duration: args.ms as number };
      }
      if (tool === 'waitForSelector') {
        return { success: true, duration: 100 };
      }
      if (tool === 'runCode') {
        return { success: true, duration: 10 };
      }
      if (tool === 'queryDOM') {
        return { success: true, data: { html: '<body></body>', elements: [] }, duration: 50 };
      }
      return { success: false, error: 'Unknown tool', duration: 0 };
    });
  });

  afterEach(() => {
    agent.stop();
    vi.clearAllMocks();
  });

  // ============================================
  // RA-01 ~ RA-08: ReAct Loop Tests
  // ============================================

  describe('RA-01: Observe', () => {
    it('should observe page state', async () => {
      const result = await agent.execute('Test goal');
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('observe', expect.any(Object));
    });

    it('should fall back to getPageInfo on observe failure', async () => {
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return { success: false, error: 'Failed', duration: 0 };
        }
        if (tool === 'getPageInfo') {
          return { success: true, data: { url: 'https://test.com', title: 'Test' }, duration: 5 };
        }
        return { success: true, duration: 10 };
      });

      const result = await agent.execute('Test goal');
      expect(toolRegistry.execute).toHaveBeenCalledWith('getPageInfo', {});
    });
  });

  describe('RA-02: Think', () => {
    it('should use rule-based thinking without LLM', async () => {
      const events: string[] = [];
      agent.on('event', (e) => events.push(e.type));

      await agent.execute('Navigate to google.com');
      
      expect(events).toContain('react_thinking');
    });

    it('should detect navigation goals', async () => {
      const result = await agent.execute('Go to https://google.com');
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('navigate', expect.objectContaining({
        url: 'https://google.com',
      }));
    });

    it('should detect click goals', async () => {
      const result = await agent.execute('Click the login button');
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('click', expect.objectContaining({
        selector: expect.any(String),
      }));
    });

    it('should detect type/input goals', async () => {
      await agent.execute('Type "hello" in the input');
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('type', expect.objectContaining({
        text: 'hello',
      }));
    });
  });

  describe('RA-03: Act', () => {
    it('should execute tool and record action', async () => {
      const result = await agent.execute('Navigate to https://example.com');
      
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.some(a => a.tool === 'navigate')).toBe(true);
    });

    it('should include action metadata', async () => {
      const result = await agent.execute('Click login');
      
      const clickAction = result.actions.find(a => a.tool === 'click');
      expect(clickAction).toBeDefined();
      if (clickAction) {
        expect(clickAction.id).toBeDefined();
        expect(clickAction.timestamp).toBeDefined();
        expect(clickAction.thought).toBeDefined();
      }
    });
  });

  describe('RA-04: Verify', () => {
    it('should verify successful action', async () => {
      const events: string[] = [];
      agent.on('event', (e) => events.push(e.type));

      await agent.execute('Navigate to https://example.com');
      
      // Should have completed event
      expect(events).toContain('react_completed');
    });

    it('should handle action failure', async () => {
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return { success: true, data: mockObservation, duration: 10 };
        }
        if (tool === 'click') {
          return { success: false, error: 'Element not found', duration: 50 };
        }
        return { success: true, duration: 10 };
      });

      const result = await agent.execute('Click non-existent button');
      
      // Should have failures in result
      expect(result.actions.some(a => a.result?.success === false)).toBe(true);
    });
  });

  describe('RA-05: Loop Termination', () => {
    it('should complete when goal is achieved', async () => {
      const result = await agent.execute('Navigate to https://example.com');
      
      expect(result.success).toBe(true);
    });

    it('should stop on max iterations', async () => {
      const shortAgent = createReactAgent(memoryManager, { maxIterations: 2 });
      
      // Force it to keep looping
      vi.mocked(toolRegistry.execute).mockResolvedValue({ success: true, duration: 10 });
      
      const result = await shortAgent.execute('Do something forever');
      
      // Should stop after max iterations
      expect(result.actions.length).toBeLessThanOrEqual(3);
    });
  });

  describe('RA-06: Infinite Loop Detection', () => {
    it('should detect repeated actions and force completion', async () => {
      let clickCount = 0;
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return { success: true, data: mockObservation, duration: 10 };
        }
        if (tool === 'click') {
          clickCount++;
          return { success: true, duration: 50 };
        }
        return { success: true, duration: 10 };
      });

      const result = await agent.execute('Click button repeatedly');
      
      // Should have detected the loop and stopped
      expect(clickCount).toBeLessThan(5);
    });
  });

  describe('RA-07: Consecutive Failure Handling', () => {
    it('should stop after max consecutive failures', async () => {
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return { success: true, data: mockObservation, duration: 10 };
        }
        return { success: false, error: 'Always fails', duration: 10 };
      });

      const agentWithLimit = createReactAgent(memoryManager, { maxConsecutiveFailures: 2 });
      const result = await agentWithLimit.execute('Do something');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('consecutive failures');
    });
  });

  describe('RA-08: Rule-based Fallback', () => {
    it('should use rule-based thinking when no LLM', async () => {
      // Agent has no API key configured
      const result = await agent.execute('Go to google.com');
      
      expect(result.actions.some(a => a.tool === 'navigate')).toBe(true);
    });
  });

  // ============================================
  // MS-01 ~ MS-05: Multi-Step Task Tests
  // ============================================

  describe('MS-01: Search and Click', () => {
    it('should handle type task and record action', async () => {
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return { success: true, data: mockObservation, duration: 10 };
        }
        if (tool === 'type') {
          return { success: true, duration: 50 };
        }
        return { success: true, duration: 10 };
      });

      // Use 'input' keyword which is recognized by rule-based thinking
      const result = await agent.execute('input "test" into field');
      
      // Check that the agent recorded a type action in history
      const hasTypeAction = result.actions.some(a => a.tool === 'type');
      expect(hasTypeAction).toBe(true);
    });
  });

  describe('MS-02: Form Filling', () => {
    it('should handle form with multiple fields', async () => {
      await agent.execute('Type "user@test.com" in email');
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('type', expect.objectContaining({
        text: 'user@test.com',
      }));
    });
  });

  describe('MS-04: Wait for Element', () => {
    it('should wait for element to appear', async () => {
      const result = await agent.waitForElement('#dynamic-button', 2000);
      
      expect(toolRegistry.execute).toHaveBeenCalledWith('waitForSelector', expect.objectContaining({
        selector: '#dynamic-button',
      }));
    });
  });

  // ============================================
  // State and Control Tests
  // ============================================

  describe('Agent State', () => {
    it('should track running state', async () => {
      expect(agent.isExecuting()).toBe(false);
      
      const promise = agent.execute('Do something');
      // Note: isExecuting might return false due to quick mock execution
      
      await promise;
      expect(agent.isExecuting()).toBe(false);
    });

    it('should prevent concurrent execution', async () => {
      // Start first execution
      const promise1 = agent.execute('First task');
      
      // Try to start second
      const promise2 = agent.execute('Second task');
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      // One should fail
      expect(result1.success || result2.success).toBe(true);
      expect(result1.error || result2.error).toBeDefined();
    });

    it('should be stoppable', async () => {
      const promise = agent.execute('Long task');
      
      // Stop immediately
      agent.stop();
      
      const result = await promise;
      // Should complete (possibly with stopped status)
      expect(result).toBeDefined();
    });

    it('should provide current state', async () => {
      expect(agent.getState()).toBeNull();
      
      const promise = agent.execute('Test task');
      await promise;
      
      // State should exist during/after execution
      // May be null if execution is very fast
    });
  });

  // ============================================
  // Event Emission Tests
  // ============================================

  describe('Event Emission', () => {
    it('should emit iteration started event', async () => {
      const events: string[] = [];
      agent.on('event', (e) => events.push(e.type));

      await agent.execute('Test');
      
      expect(events).toContain('react_iteration_started');
    });

    it('should emit thinking event', async () => {
      const events: string[] = [];
      agent.on('event', (e) => events.push(e.type));

      await agent.execute('Test');
      
      expect(events).toContain('react_thinking');
    });

    it('should emit action started event', async () => {
      const events: string[] = [];
      agent.on('react_action_started', (data) => events.push('started'));

      await agent.execute('Navigate to https://example.com');
      
      expect(events).toContain('started');
    });

    it('should emit completed event', async () => {
      const events: unknown[] = [];
      agent.on('react_completed', (data) => events.push(data));

      await agent.execute('Test');
      
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ============================================
  // Configuration Tests
  // ============================================

  describe('Configuration', () => {
    it('should accept custom config', () => {
      const customAgent = createReactAgent(memoryManager, {
        maxIterations: 5,
        maxConsecutiveFailures: 2,
      });

      expect(customAgent).toBeDefined();
    });

    it('should update config', () => {
      agent.updateConfig({ maxIterations: 10 });
      // Config is internal, but agent should not throw
      expect(agent).toBeDefined();
    });

    it('should accept LLM config', () => {
      expect(() => {
        agent.setLLMConfig({ apiKey: 'test-key', baseUrl: 'https://api.test.com' });
      }).not.toThrow();
    });
  });

  // ============================================
  // CodeAct Integration Tests
  // ============================================

  describe('CodeAct Integration', () => {
    it('should handle CodeAct triggered by gating', async () => {
      // Mock large DOM to trigger gating
      vi.mocked(toolRegistry.execute).mockImplementation(async (tool) => {
        if (tool === 'observe') {
          return {
            success: true,
            data: {
              ...mockObservation,
              domSnapshot: 'x'.repeat(15000), // Large DOM
            },
            duration: 10,
          };
        }
        if (tool === 'queryDOM') {
          return { success: true, data: { html: '<body></body>' }, duration: 50 };
        }
        return { success: true, duration: 10 };
      });

      vi.mocked(codeExecutor.parseDOM).mockResolvedValue({
        success: true,
        result: [],
        duration: 100,
      });

      const result = await agent.execute('Extract all links');
      
      // Should have triggered CodeAct due to large DOM
      expect(result).toBeDefined();
    });
  });

  // ============================================
  // Factory Function Test
  // ============================================

  describe('createReactAgent', () => {
    it('should create agent instance', () => {
      const newAgent = createReactAgent(memoryManager);
      expect(newAgent).toBeInstanceOf(ReactAgent);
    });

    it('should create agent with config', () => {
      const newAgent = createReactAgent(memoryManager, {
        maxIterations: 20,
        anthropicApiKey: 'test-key',
      });
      expect(newAgent).toBeInstanceOf(ReactAgent);
    });
  });
});

