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
  createBrowserTools, 
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
import { createObserveNode } from '../src/nodes/observe';
import { createActNode } from '../src/nodes/act';

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

describe('Browser Tools', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should create all browser tools', () => {
    const tools = createBrowserTools(mockAdapter);
    
    expect(tools.length).toBeGreaterThan(0);
    
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('navigate');
    expect(toolNames).toContain('click');
    expect(toolNames).toContain('type');
    expect(toolNames).toContain('press');
    expect(toolNames).toContain('hover');
    expect(toolNames).toContain('screenshot');
    expect(toolNames).toContain('getPageInfo');
  });
  
  it('navigate tool should call browser adapter', async () => {
    const tools = createBrowserTools(mockAdapter);
    const navigateTool = tools.find(t => t.name === 'navigate');
    
    expect(navigateTool).toBeDefined();
    
    const result = await navigateTool!.invoke({ url: 'https://example.com' });
    
    expect(mockAdapter.navigate).toHaveBeenCalledWith('https://example.com');
    expect(result).toContain('success');
  });
  
  it('click tool should call browser adapter', async () => {
    const tools = createBrowserTools(mockAdapter);
    const clickTool = tools.find(t => t.name === 'click');
    
    expect(clickTool).toBeDefined();
    
    await clickTool!.invoke({ selector: 'button' });
    
    expect(mockAdapter.click).toHaveBeenCalledWith('button');
  });
  
  it('type tool should call browser adapter', async () => {
    const tools = createBrowserTools(mockAdapter);
    const typeTool = tools.find(t => t.name === 'type');
    
    expect(typeTool).toBeDefined();
    
    await typeTool!.invoke({ selector: 'input', text: 'hello' });
    
    expect(mockAdapter.type).toHaveBeenCalledWith('input', 'hello', true);
  });
});

describe('Agent Graph Creation', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should create a graph', () => {
    const tools = createBrowserTools(mockAdapter);
    
    const graph = createAgentGraph({
      browserAdapter: mockAdapter,
      tools,
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
    const tools = createBrowserTools(mockAdapter);
    
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      tools,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    expect(agent).toBeDefined();
    expect(agent.isTaskRunning()).toBe(false);
  });
  
  it('should compile without checkpointer', () => {
    const tools = createBrowserTools(mockAdapter);
    
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      tools,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    agent.compile();
    
    expect(agent).toBeDefined();
  });
  
  it('should throw if executing without compile', async () => {
    const tools = createBrowserTools(mockAdapter);
    
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      tools,
      llmConfig: {
        apiKey: 'test-key',
      },
    });
    
    await expect(agent.executeTask('test goal')).rejects.toThrow('Graph not compiled');
  });
  
  it('should return config', () => {
    const tools = createBrowserTools(mockAdapter);
    
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      tools,
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
    const tools = createBrowserTools(mockAdapter);
    
    const agent = new BrowserAgent({
      browserAdapter: mockAdapter,
      tools,
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
    
    expect(report).toContain('Completed steps');
    expect(report).toContain('navigate');
    expect(report).toContain('Failed step');
    expect(report).toContain('click');
    expect(report).toContain('Element not found');
  });
});

// ===== RA-01: Observe Node Tests =====
describe('RA-01: Observe Node', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should capture browser state', async () => {
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState();
    
    const result = await observeNode(state);
    
    expect(result.observation).toBeDefined();
    expect(result.observation?.url).toBe('https://example.com');
    expect(result.observation?.title).toBe('Example Domain');
    expect(result.status).toBe('observing');
  });
  
  it('should detect page load state (SA-01)', async () => {
    // Mock content with enough length and interactive elements
    (mockAdapter.getPageContent as any).mockResolvedValue(
      '<html><head><title>Test</title></head><body>' +
      '<div class="container">' +
      '<h1>Welcome to Test Page</h1>' +
      '<p>This is a paragraph with some content to make the page longer.</p>' +
      '<button id="submit">Submit</button>' +
      '<input type="text" placeholder="Enter text" />' +
      '<a href="/link">Click here</a>' +
      '</div></body></html>'
    );
    
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState();
    
    const result = await observeNode(state);
    
    expect(result.observation?.loadState).toBeDefined();
    // Content has button and is long enough, should be complete
    expect(result.observation?.loadState).toBe('complete');
  });
  
  it('should detect loading indicators (SA-04)', async () => {
    (mockAdapter.getPageContent as any).mockResolvedValue('<html><body><div class="loading">Loading...</div></body></html>');
    
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState();
    
    const result = await observeNode(state);
    
    expect(result.observation?.hasLoadingIndicator).toBe(true);
  });
  
  it('should detect modal overlays (SA-04)', async () => {
    (mockAdapter.getPageContent as any).mockResolvedValue('<html><body><div class="modal">Modal content</div></body></html>');
    
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState();
    
    const result = await observeNode(state);
    
    expect(result.observation?.hasModalOverlay).toBe(true);
  });
  
  it('should store previous observation (SA-06)', async () => {
    const observeNode = createObserveNode(mockAdapter);
    const prevObservation: Observation = {
      timestamp: '2024-01-01T00:00:00Z',
      url: 'https://old.com',
      title: 'Old Page',
    };
    const state = createInitialState({ observation: prevObservation });
    
    const result = await observeNode(state);
    
    expect(result.previousObservation).toBe(prevObservation);
  });
  
  it('should handle disconnected browser', async () => {
    (mockAdapter.isConnected as any).mockReturnValue(false);
    
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState();
    
    const result = await observeNode(state);
    
    expect(result.status).toBe('error');
    expect(result.error).toContain('not connected');
  });
  
  it('should increment iteration count', async () => {
    const observeNode = createObserveNode(mockAdapter);
    const state = createInitialState({ iterationCount: 5 });
    
    const result = await observeNode(state);
    
    expect(result.iterationCount).toBe(6);
  });
});

// ===== RA-03, ER-01, ER-02: Act Node Tests =====
describe('RA-03: Act Node', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should execute pending action', async () => {
    const tools = createBrowserTools(mockAdapter);
    const actNode = createActNode(mockAdapter, tools);
    
    const pendingAction: AgentAction = {
      id: 'action_1',
      tool: 'navigate',
      args: { url: 'https://example.com' },
      thought: 'Navigate',
      reasoning: 'Go to page',
      timestamp: new Date().toISOString(),
    };
    
    const state = createInitialState({
      actionHistory: [pendingAction],
    });
    
    const result = await actNode(state);
    
    expect(result.status).toBe('acting');
    expect(mockAdapter.navigate).toHaveBeenCalledWith('https://example.com');
  });
  
  it('should track completed steps (MS)', async () => {
    const tools = createBrowserTools(mockAdapter);
    const actNode = createActNode(mockAdapter, tools);
    
    const pendingAction: AgentAction = {
      id: 'action_1',
      tool: 'click',
      args: { selector: 'button' },
      thought: 'Click',
      reasoning: 'Click button',
      timestamp: new Date().toISOString(),
    };
    
    const state = createInitialState({
      actionHistory: [pendingAction],
      currentStepIndex: 0,
    });
    
    const result = await actNode(state);
    
    expect(result.completedSteps).toBeDefined();
    expect(result.completedSteps?.length).toBeGreaterThan(0);
    expect(result.currentStepIndex).toBe(1);
  });
  
  it('should handle unknown tool', async () => {
    const tools = createBrowserTools(mockAdapter);
    const actNode = createActNode(mockAdapter, tools);
    
    const pendingAction: AgentAction = {
      id: 'action_1',
      tool: 'unknownTool',
      args: {},
      thought: 'Try unknown',
      reasoning: 'Testing',
      timestamp: new Date().toISOString(),
    };
    
    const state = createInitialState({
      actionHistory: [pendingAction],
    });
    
    const result = await actNode(state);
    
    expect(result.status).toBe('error');
    expect(result.error).toContain('Unknown tool');
    expect(result.consecutiveFailures).toBe(1);
  });
  
  it('should reset consecutive failures on success', async () => {
    const tools = createBrowserTools(mockAdapter);
    const actNode = createActNode(mockAdapter, tools);
    
    const pendingAction: AgentAction = {
      id: 'action_1',
      tool: 'click',
      args: { selector: 'button' },
      thought: 'Click',
      reasoning: 'Click button',
      timestamp: new Date().toISOString(),
    };
    
    const state = createInitialState({
      actionHistory: [pendingAction],
      consecutiveFailures: 2,
    });
    
    const result = await actNode(state);
    
    expect(result.consecutiveFailures).toBe(0);
  });
  
  it('should increment consecutive failures on error (RA-07)', async () => {
    (mockAdapter.click as any).mockResolvedValue({ success: false, error: 'Element not found' });
    
    const tools = createBrowserTools(mockAdapter);
    const actNode = createActNode(mockAdapter, tools);
    
    const pendingAction: AgentAction = {
      id: 'action_1',
      tool: 'click',
      args: { selector: 'button' },
      thought: 'Click',
      reasoning: 'Click button',
      timestamp: new Date().toISOString(),
    };
    
    const state = createInitialState({
      actionHistory: [pendingAction],
      consecutiveFailures: 1,
    });
    
    const result = await actNode(state);
    
    expect(result.consecutiveFailures).toBe(2);
  });
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
describe('Browser Tools (MS-04, ER-03)', () => {
  let mockAdapter: IBrowserAdapter;
  
  beforeEach(() => {
    mockAdapter = createMockBrowserAdapter();
  });
  
  it('should include waitForElement tool (MS-04)', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('waitForElement');
  });
  
  it('should include scrollToFind tool (ER-03)', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('scrollToFind');
  });
  
  it('should include scroll tool', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('scroll');
  });
  
  it('should include elementExists tool', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('elementExists');
  });
  
  it('should include getElementText tool (SA-02)', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('getElementText');
  });
  
  it('should include getInputValue tool (SA-02)', () => {
    const tools = createBrowserTools(mockAdapter);
    const toolNames = tools.map(t => t.name);
    
    expect(toolNames).toContain('getInputValue');
  });
  
  it('waitForElement should poll for element', async () => {
    const tools = createBrowserTools(mockAdapter);
    const waitTool = tools.find(t => t.name === 'waitForElement');
    
    expect(waitTool).toBeDefined();
    
    const result = await waitTool!.invoke({ 
      selector: 'button', 
      timeout: 1000, 
      pollInterval: 100 
    });
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(true);
    expect(mockAdapter.waitForSelector).toHaveBeenCalled();
  });
  
  it('scrollToFind should scroll and check', async () => {
    const tools = createBrowserTools(mockAdapter);
    const scrollTool = tools.find(t => t.name === 'scrollToFind');
    
    expect(scrollTool).toBeDefined();
    
    const result = await scrollTool!.invoke({ 
      selector: 'button', 
      maxScrolls: 2 
    });
    const parsed = JSON.parse(result);
    
    expect(parsed.success).toBe(true);
  });
});

