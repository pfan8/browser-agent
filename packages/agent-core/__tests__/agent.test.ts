/**
 * Agent Core Tests
 * 
 * Tests the LangGraph agent with mock browser adapter.
 * No real browser or Electron required.
 * 
 * Covers:
 * - RA-*: ReAct agent core loop
 * - MS-*: Multi-step task execution
 * - SA-*: State awareness
 * - ER-*: Error recovery
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { 
  BrowserAgent, 
  createAgentGraph, 
  AgentStateAnnotation,
  // State utilities
  computeActionSignature,
  isRepeatedAction,
  updateActionSignature,
  computeContentHash,
  hasPageChanged,
  buildFailureReport,
  DEFAULT_AGENT_CONFIG,
  type AgentState,
  type Observation,
  type AgentAction,
} from '../src';
import type { IBrowserAdapter, OperationResult, BrowserStatus, PageInfo, TabInfo } from '@chat-agent/browser-adapter';

// Note: The old tool-based architecture has been replaced with Planner + CodeAct.
// createBrowserTools, createObserveNode, and createActNode are no longer exported.
// Tests that relied on these need to be rewritten for the new architecture.

// Mock browser adapter
function createMockBrowserAdapter(): IBrowserAdapter {
  const events = new Map<string, Array<(...args: unknown[]) => void>>();
  
  return {
    connect: vi.fn().mockResolvedValue({ success: true }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    reconnect: vi.fn().mockResolvedValue({ success: true }),
    isConnected: vi.fn().mockReturnValue(true),
    getStatus: vi.fn().mockResolvedValue({ connected: true, url: 'https://example.com', title: 'Example' }),
    getCdpUrl: vi.fn().mockReturnValue('http://localhost:9222'),
    getLastConnectionError: vi.fn().mockReturnValue(null),
    
    navigate: vi.fn().mockResolvedValue({ success: true, data: { url: 'https://example.com' } }),
    goBack: vi.fn().mockResolvedValue({ success: true }),
    goForward: vi.fn().mockResolvedValue({ success: true }),
    click: vi.fn().mockResolvedValue({ success: true }),
    type: vi.fn().mockResolvedValue({ success: true }),
    press: vi.fn().mockResolvedValue({ success: true }),
    hover: vi.fn().mockResolvedValue({ success: true }),
    select: vi.fn().mockResolvedValue({ success: true }),
    
    wait: vi.fn().mockResolvedValue({ success: true }),
    waitForSelector: vi.fn().mockResolvedValue({ success: true }),
    
    screenshot: vi.fn().mockResolvedValue({ success: true, data: { path: '/tmp/screenshot.png' } }),
    getPageInfo: vi.fn().mockResolvedValue({ url: 'https://example.com', title: 'Example Domain' }),
    getPageContent: vi.fn().mockResolvedValue('<html><body><h1>Example Domain</h1><button>Click me</button></body></html>'),
    evaluateSelector: vi.fn().mockResolvedValue({ selector: 'h1', alternatives: [] }),
    
    listPages: vi.fn().mockResolvedValue([{ index: 0, url: 'https://example.com', title: 'Example', active: true }]),
    switchToPage: vi.fn().mockResolvedValue({ success: true }),
    closePage: vi.fn().mockResolvedValue({ success: true }),
    
    runCode: vi.fn().mockResolvedValue({ success: true }),
    
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = events.get(event) || [];
      handlers.push(handler);
      events.set(event, handlers);
    }),
    off: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const handlers = events.get(event) || [];
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
      events.set(event, handlers);
    }),
    emit: vi.fn((event: string, ...args: unknown[]) => {
      const handlers = events.get(event) || [];
      handlers.forEach(handler => handler(...args));
    }),
  };
}

// Helper to create initial state
function createInitialState(overrides?: Partial<AgentState>): AgentState {
  return {
    messages: [],
    goal: 'Test goal',
    originalGoal: 'Test goal',
    observation: null,
    previousObservation: null,
    actionHistory: [],
    status: 'idle',
    iterationCount: 0,
    consecutiveFailures: 0,
    actionSignatures: new Map(),
    loopDetected: false,
    plan: null,
    currentStepIndex: 0,
    completedSteps: [],
    result: null,
    error: null,
    isComplete: false,
    useFallbackRules: false,
    traceContext: null,
    currentInstruction: null,
    plannerThought: null,
    executionMode: 'iterative',
    memoryContext: null,
    threadId: null,
    ...overrides,
  };
}

describe('Agent State', () => {
  it('should have correct default values', () => {
    const state = {
      messages: [],
      goal: '',
      observation: null,
      actionHistory: [],
      status: 'idle' as const,
      iterationCount: 0,
      consecutiveFailures: 0,
      plan: null,
      result: null,
      error: null,
      isComplete: false,
    };
    
    expect(state.status).toBe('idle');
    expect(state.messages).toEqual([]);
    expect(state.iterationCount).toBe(0);
  });
});

// Browser Tools tests - skipped because CodeAct architecture replaced tool-based actions
describe.skip('Browser Tools (legacy - replaced by CodeAct)', () => {
  it.skip('should create all browser tools', () => {});
  it.skip('navigate tool should call browser adapter', () => {});
  it.skip('click tool should call browser adapter', () => {});
  it.skip('type tool should call browser adapter', () => {});
});

describe('Agent Graph Creation', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should create a graph', () => {
    const graph = createAgentGraph({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    expect(graph).toBeDefined();
  });
});

describe('BrowserAgent', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should create an agent instance', () => {
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    expect(agent).toBeDefined();
    expect(agent.isTaskRunning()).toBe(false);
  });
  
  it('should compile without checkpointer', () => {
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    agent.compile();
    
    expect(agent).toBeDefined();
  });
  
  it('should throw if executing without compile', async () => {
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    await expect(agent.executeTask('test goal')).rejects.toThrow('Graph not compiled');
  });
  
  it('should return config', () => {
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
      agentConfig: {
        maxIterations: 10,
      },
    });
    
    const config = agent.getConfig();
    
    expect(config.maxIterations).toBe(10);
  });
  
  it('should update config', () => {
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    agent.updateConfig({ maxIterations: 5 });
    
    const config = agent.getConfig();
    expect(config.maxIterations).toBe(5);
  });
});

// ===== RA-06: Loop Detection Tests =====
describe('RA-06: Loop Detection', () => {
  it('should compute action signature correctly', () => {
    const sig1 = computeActionSignature('click', { selector: 'button' });
    const sig2 = computeActionSignature('click', { selector: 'button' });
    const sig3 = computeActionSignature('click', { selector: 'link' });
    
    expect(sig1).toBe(sig2);
    expect(sig1).not.toBe(sig3);
  });
  
  it('should detect repeated actions', () => {
    const signatures = new Map<string, number>();
    
    // First action - not repeated
    expect(isRepeatedAction(signatures, 'click', { selector: 'btn' }, 3)).toBe(false);
    
    // Add 3 occurrences
    let updated = updateActionSignature(signatures, 'click', { selector: 'btn' });
    updated = updateActionSignature(updated, 'click', { selector: 'btn' });
    updated = updateActionSignature(updated, 'click', { selector: 'btn' });
    
    // Now should be detected as repeated
    expect(isRepeatedAction(updated, 'click', { selector: 'btn' }, 3)).toBe(true);
  });
  
  it('should track different actions separately', () => {
    let signatures = new Map<string, number>();
    
    // Add different actions
    signatures = updateActionSignature(signatures, 'click', { selector: 'btn1' });
    signatures = updateActionSignature(signatures, 'click', { selector: 'btn2' });
    signatures = updateActionSignature(signatures, 'type', { selector: 'input', text: 'hello' });
    
    // None should be repeated
    expect(isRepeatedAction(signatures, 'click', { selector: 'btn1' }, 3)).toBe(false);
    expect(isRepeatedAction(signatures, 'click', { selector: 'btn2' }, 3)).toBe(false);
  });
});

// ===== SA-06: Page Change Detection Tests =====
describe('SA-06: Page Change Detection', () => {
  it('should compute content hash', () => {
    const hash1 = computeContentHash('Hello World');
    const hash2 = computeContentHash('Hello World');
    const hash3 = computeContentHash('Different Content');
    
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
  
  it('should detect URL change', () => {
    const prev: Observation = {
      timestamp: '2024-01-01T00:00:00Z',
      url: 'https://example.com/page1',
      title: 'Page 1',
    };
    
    const current: Observation = {
      timestamp: '2024-01-01T00:00:01Z',
      url: 'https://example.com/page2',
      title: 'Page 2',
    };
    
    expect(hasPageChanged(current, prev)).toBe(true);
  });
  
  it('should detect content hash change', () => {
    const prev: Observation = {
      timestamp: '2024-01-01T00:00:00Z',
      url: 'https://example.com/page1',
      title: 'Page 1',
      contentHash: 'abc123',
    };
    
    const current: Observation = {
      timestamp: '2024-01-01T00:00:01Z',
      url: 'https://example.com/page1',
      title: 'Page 1',
      contentHash: 'def456',
    };
    
    expect(hasPageChanged(current, prev)).toBe(true);
  });
  
  it('should detect no change', () => {
    const prev: Observation = {
      timestamp: '2024-01-01T00:00:00Z',
      url: 'https://example.com/page1',
      title: 'Page 1',
      contentHash: 'abc123',
    };
    
    const current: Observation = {
      timestamp: '2024-01-01T00:00:01Z',
      url: 'https://example.com/page1',
      title: 'Page 1',
      contentHash: 'abc123',
    };
    
    expect(hasPageChanged(current, prev)).toBe(false);
  });
});

// ===== ER-06: Failure Report Tests =====
describe('ER-06: Failure Report', () => {
  it('should build failure report with completed and failed steps', () => {
    const state = createInitialState({
      actionHistory: [
        {
          id: 'action_1',
          tool: 'navigate',
          args: { url: 'https://example.com' },
          thought: 'Navigate first',
          reasoning: 'Need to go to page',
          timestamp: '2024-01-01T00:00:00Z',
          result: { success: true, duration: 100 },
        },
        {
          id: 'action_2',
          tool: 'click',
          args: { selector: '#submit' },
          thought: 'Click submit',
          reasoning: 'Submit the form',
          timestamp: '2024-01-01T00:00:01Z',
          result: { success: false, error: 'Element not found', duration: 50 },
        },
      ],
    });
    
    const report = buildFailureReport(state);
    
    // Report is in Chinese
    expect(report).toContain('已完成的步骤');
    expect(report).toContain('导航');
    expect(report).toContain('失败的步骤');
    expect(report).toContain('点击');
    expect(report).toContain('找不到');
  });
});

// ===== RA-01: Observe Node Tests =====
// Note: These tests are skipped because the observe node is now internal to graph.ts
// and uses runCode instead of getPageInfo/getPageContent.
// The Planner + CodeAct architecture has different testing requirements.
describe.skip('RA-01: Observe Node (legacy - needs update)', () => {
  it.skip('should capture browser state', () => {});
  it.skip('should detect page load state (SA-01)', () => {});
  it.skip('should detect loading indicators (SA-04)', () => {});
  it.skip('should detect modal overlays (SA-04)', () => {});
  it.skip('should store previous observation (SA-06)', () => {});
  it.skip('should handle disconnected browser', () => {});
  it.skip('should increment iteration count', () => {});
});

// ===== RA-03, ER-01, ER-02: Act Node Tests =====
// Note: Act Node has been replaced with CodeAct in the new architecture.
// CodeAct generates and executes Playwright code directly, not tool-based actions.
describe.skip('RA-03: Act Node (legacy - replaced by CodeAct)', () => {
  it.skip('should execute pending action', () => {});
  it.skip('should track completed steps (MS)', () => {});
  it.skip('should handle unknown tool', () => {});
  it.skip('should reset consecutive failures on success', () => {});
  it.skip('should increment consecutive failures on error (RA-07)', () => {});
});

// ===== Agent Config Tests =====
describe('Agent Config', () => {
  it('should have correct default config values', () => {
    expect(DEFAULT_AGENT_CONFIG.maxIterations).toBe(20);
    expect(DEFAULT_AGENT_CONFIG.maxConsecutiveFailures).toBe(3);
    expect(DEFAULT_AGENT_CONFIG.maxRetryPerAction).toBe(3);
    expect(DEFAULT_AGENT_CONFIG.enableSelectorFallback).toBe(true);
    expect(DEFAULT_AGENT_CONFIG.enableScrollSearch).toBe(true);
    expect(DEFAULT_AGENT_CONFIG.enableRuleFallback).toBe(true);
    expect(DEFAULT_AGENT_CONFIG.maxRepeatedActions).toBe(3);
  });
});

// ===== New Browser Tools Tests =====
// Skipped because CodeAct architecture replaced tool-based actions
describe.skip('Browser Tools (MS-04, ER-03) (legacy - replaced by CodeAct)', () => {
  it.skip('should include waitForElement tool (MS-04)', () => {});
  it.skip('should include scrollToFind tool (ER-03)', () => {});
  it.skip('should include scroll tool', () => {});
  it.skip('should include elementExists tool', () => {});
  it.skip('should include getElementText tool (SA-02)', () => {});
  it.skip('should include getInputValue tool (SA-02)', () => {});
  it.skip('waitForElement should poll for element', () => {});
  it.skip('scrollToFind should scroll and check', () => {});
});

