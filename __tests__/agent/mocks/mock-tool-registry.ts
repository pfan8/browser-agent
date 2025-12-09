/**
 * Mock Tool Registry for Testing
 * 
 * Provides a mock implementation of the tool registry
 * that doesn't require an actual browser connection.
 */

import type { ToolDefinition, ToolExecutionResult, Observation } from '../../../electron/agent/types';

export interface MockToolBehavior {
  success?: boolean;
  data?: unknown;
  error?: string;
  delay?: number;
}

export class MockToolRegistry {
  private behaviors: Map<string, MockToolBehavior[]> = new Map();
  private callHistory: Array<{ name: string; args: Record<string, unknown>; timestamp: number }> = [];
  private defaultObservation: Observation = {
    timestamp: new Date().toISOString(),
    url: 'https://example.com',
    title: 'Example Page',
    visibleElements: [
      {
        selector: '#login-button',
        tag: 'button',
        text: 'Login',
        attributes: { id: 'login-button', type: 'submit' },
        isVisible: true,
        isInteractable: true,
      },
      {
        selector: '#username',
        tag: 'input',
        text: '',
        attributes: { id: 'username', type: 'text', placeholder: 'Username' },
        isVisible: true,
        isInteractable: true,
      },
    ],
  };

  /**
   * Set behavior for a tool
   * Multiple calls push behaviors to a queue (FIFO)
   */
  setToolBehavior(toolName: string, behavior: MockToolBehavior): void {
    if (!this.behaviors.has(toolName)) {
      this.behaviors.set(toolName, []);
    }
    this.behaviors.get(toolName)!.push(behavior);
  }

  /**
   * Set the default observation returned by 'observe' tool
   */
  setDefaultObservation(observation: Observation): void {
    this.defaultObservation = observation;
  }

  /**
   * Clear all behaviors
   */
  clearBehaviors(): void {
    this.behaviors.clear();
  }

  /**
   * Clear call history
   */
  clearHistory(): void {
    this.callHistory = [];
  }

  /**
   * Get call history
   */
  getCallHistory(): Array<{ name: string; args: Record<string, unknown>; timestamp: number }> {
    return [...this.callHistory];
  }

  /**
   * Get calls for a specific tool
   */
  getCallsFor(toolName: string): Array<{ args: Record<string, unknown>; timestamp: number }> {
    return this.callHistory
      .filter(call => call.name === toolName)
      .map(({ args, timestamp }) => ({ args, timestamp }));
  }

  /**
   * Check if tool was called
   */
  wasToolCalled(toolName: string): boolean {
    return this.callHistory.some(call => call.name === toolName);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return ['navigate', 'click', 'type', 'press', 'hover', 'select', 'wait', 
            'waitForSelector', 'screenshot', 'getPageInfo', 'observe', 
            'runCode', 'listPages', 'switchToPage'].includes(name);
  }

  /**
   * Get all tool definitions (mock)
   */
  getAllDefinitions(): ToolDefinition[] {
    return [
      { name: 'navigate', description: 'Navigate to URL', category: 'browser', parameters: [], returns: 'void' },
      { name: 'click', description: 'Click element', category: 'browser', parameters: [], returns: 'void' },
      { name: 'type', description: 'Type text', category: 'browser', parameters: [], returns: 'void' },
      { name: 'observe', description: 'Observe page', category: 'observation', parameters: [], returns: 'Observation' },
      { name: 'getPageInfo', description: 'Get page info', category: 'observation', parameters: [], returns: 'PageInfo' },
    ];
  }

  /**
   * Execute a tool (mock implementation)
   */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    this.callHistory.push({ name, args, timestamp: Date.now() });

    // Get queued behavior or use default
    const behaviorQueue = this.behaviors.get(name);
    const behavior = behaviorQueue?.shift();

    // Add delay if specified
    if (behavior?.delay) {
      await new Promise(resolve => setTimeout(resolve, behavior.delay));
    }

    // Handle specific tools with default behavior
    if (name === 'observe') {
      if (behavior) {
        return {
          success: behavior.success !== false,
          data: behavior.data ?? this.defaultObservation,
          error: behavior.error,
          duration: behavior.delay || 10,
        };
      }
      return {
        success: true,
        data: this.defaultObservation,
        duration: 10,
      };
    }

    if (name === 'getPageInfo') {
      if (behavior) {
        return {
          success: behavior.success !== false,
          data: behavior.data ?? { url: this.defaultObservation.url, title: this.defaultObservation.title },
          error: behavior.error,
          duration: behavior.delay || 5,
        };
      }
      return {
        success: true,
        data: { url: this.defaultObservation.url, title: this.defaultObservation.title },
        duration: 5,
      };
    }

    // Use provided behavior or default success
    if (behavior) {
      return {
        success: behavior.success !== false,
        data: behavior.data,
        error: behavior.error,
        duration: behavior.delay || 10,
      };
    }

    // Default: success
    return {
      success: true,
      data: null,
      duration: 10,
    };
  }

  /**
   * Get tool descriptions for prompt
   */
  getToolDescriptionsForPrompt(): string {
    return this.getAllDefinitions()
      .map(d => `- ${d.name}: ${d.description}`)
      .join('\n');
  }

  /**
   * Get tool names
   */
  getToolNames(): string[] {
    return ['navigate', 'click', 'type', 'press', 'hover', 'select', 'wait', 
            'waitForSelector', 'screenshot', 'getPageInfo', 'observe', 
            'runCode', 'listPages', 'switchToPage'];
  }

  /**
   * Register a tool (mock - just tracks it)
   */
  register(_definition: ToolDefinition, _executor: unknown): void {
    // No-op for mock
  }

  /**
   * Clear all
   */
  clear(): void {
    this.clearBehaviors();
    this.clearHistory();
  }
}

// Create a singleton for tests that need it
export const mockToolRegistry = new MockToolRegistry();

