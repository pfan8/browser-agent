/**
 * Playwright Adapter Tests
 * 
 * Tests for PlaywrightAdapter with context-based architecture.
 * All browser operations are done via runCode - only connection and context management are tested.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock playwright - must be defined before imports
vi.mock('playwright', () => {
  const mockPage = {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(() => Promise.resolve('Example Page')),
    evaluate: vi.fn(() => Promise.resolve('complete')),
    on: vi.fn(),
  };

  const mockContext = {
    pages: vi.fn(() => [mockPage]),
    newPage: vi.fn(() => Promise.resolve(mockPage)),
    on: vi.fn(),
  };

  const mockBrowser = {
    contexts: vi.fn(() => [mockContext]),
    newContext: vi.fn(() => Promise.resolve(mockContext)),
    close: vi.fn(() => Promise.resolve()),
    isConnected: vi.fn(() => true),
    on: vi.fn(),
  };

  return {
    chromium: {
      connectOverCDP: vi.fn(() => Promise.resolve(mockBrowser)),
    },
    Browser: vi.fn(),
    BrowserContext: vi.fn(),
    Page: vi.fn(),
  };
});

import { chromium } from 'playwright';
import { PlaywrightAdapter } from '../src/playwright-adapter';
import type { IBrowserAdapter } from '../src/types';

describe('PlaywrightAdapter', () => {
  let adapter: PlaywrightAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PlaywrightAdapter();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // Initialization Tests
  // ============================================

  describe('initialization', () => {
    it('should create an instance', () => {
      expect(adapter).toBeDefined();
      expect(adapter).toBeInstanceOf(PlaywrightAdapter);
    });

    it('should implement IBrowserAdapter interface', () => {
      const browserAdapter: IBrowserAdapter = adapter;
      expect(browserAdapter.connect).toBeDefined();
      expect(browserAdapter.disconnect).toBeDefined();
      expect(browserAdapter.reconnect).toBeDefined();
      expect(browserAdapter.isConnected).toBeDefined();
      expect(browserAdapter.getStatus).toBeDefined();
      expect(browserAdapter.getCdpUrl).toBeDefined();
      expect(browserAdapter.getLastConnectionError).toBeDefined();
      expect(browserAdapter.runCode).toBeDefined();
      expect(browserAdapter.getContextsInfo).toBeDefined();
      expect(browserAdapter.switchContext).toBeDefined();
      expect(browserAdapter.on).toBeDefined();
      expect(browserAdapter.off).toBeDefined();
      expect(browserAdapter.emit).toBeDefined();
    });

    it('should default to localhost:9222 for CDP URL', () => {
      expect(adapter.getCdpUrl()).toBe('http://localhost:9222');
    });

    it('should accept custom config', () => {
      const customAdapter = new PlaywrightAdapter({
        defaultTimeout: 10000,
        screenshotPath: '/custom/path',
      });
      expect(customAdapter).toBeDefined();
    });
  });

  // ============================================
  // Connection Tests
  // ============================================

  describe('Connection', () => {
    it('should connect to browser via CDP', async () => {
      const result = await adapter.connect('http://localhost:9222');

      expect(result.success).toBe(true);
      expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222', {
        timeout: 30000,
      });
    });

    it('should use default CDP URL if not provided', async () => {
      await adapter.connect();

      expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222', {
        timeout: 30000,
      });
    });

    it('should handle connection failure', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await adapter.connect();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should emit connected event on successful connection', async () => {
      const connectedHandler = vi.fn();
      adapter.on('connected', connectedHandler);

      await adapter.connect();

      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should emit connectionError event on failure', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Connection refused'));
      
      const errorHandler = vi.fn();
      adapter.on('connectionError', errorHandler);

      await adapter.connect();

      expect(errorHandler).toHaveBeenCalled();
    });

    it('should store last connection error', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Connection refused'));

      await adapter.connect();

      expect(adapter.getLastConnectionError()).toBe('Connection refused');
    });

    it('should clear connection error on successful connect', async () => {
      // First, fail a connection
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('First error'));
      await adapter.connect();
      expect(adapter.getLastConnectionError()).toBe('First error');

      // Then succeed
      await adapter.connect();
      expect(adapter.getLastConnectionError()).toBeNull();
    });

    it('should return connected status after connect', async () => {
      expect(adapter.isConnected()).toBe(false);
      
      await adapter.connect();
      
      expect(adapter.isConnected()).toBe(true);
    });

    it('should disconnect from browser', async () => {
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);

      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('should emit disconnected event on disconnect', async () => {
      const disconnectedHandler = vi.fn();
      adapter.on('disconnected', disconnectedHandler);

      await adapter.connect();
      await adapter.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('should reconnect to browser', async () => {
      await adapter.connect('http://localhost:9222');
      
      const result = await adapter.reconnect();
      
      expect(result.success).toBe(true);
      expect(chromium.connectOverCDP).toHaveBeenCalledTimes(2);
    });
  });

  // ============================================
  // Status Tests
  // ============================================

  describe('Status', () => {
    it('should return disconnected status when not connected', async () => {
      const status = await adapter.getStatus();
      expect(status.connected).toBe(false);
    });

    it('should return connected status after connection', async () => {
      await adapter.connect();
      const status = await adapter.getStatus();

      expect(status.connected).toBe(true);
    });
  });

  // ============================================
  // Context Management Tests
  // ============================================

  describe('Context Management', () => {
    it('should get contexts info', async () => {
      await adapter.connect();
      
      const contextsInfo = await adapter.getContextsInfo();
      
      expect(contextsInfo).toHaveLength(1);
      expect(contextsInfo[0].index).toBe(0);
      expect(contextsInfo[0].isActive).toBe(true);
      expect(contextsInfo[0].pageCount).toBe(1);
    });

    it('should switch context', async () => {
      await adapter.connect();
      
      // Only one context, switching to 0 should work
      const result = await adapter.switchContext(0);
      expect(result.success).toBe(true);
    });

    it('should fail to switch to invalid context index', async () => {
      await adapter.connect();
      
      const result = await adapter.switchContext(999);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid context index');
    });

    it('should get current context index', async () => {
      await adapter.connect();
      
      const index = adapter.getCurrentContextIndex();
      expect(index).toBe(0);
    });

    it('should return -1 for context index when not connected', () => {
      const index = adapter.getCurrentContextIndex();
      expect(index).toBe(-1);
    });
  });

  // ============================================
  // runCode Tests
  // ============================================

  describe('runCode', () => {
    it('should return error when not connected', async () => {
      const result = await adapter.runCode('return { success: true }');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });

    it('should execute simple code', async () => {
      await adapter.connect();
      
      const result = await adapter.runCode('return { success: true, value: 42 }');
      
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ success: true, value: 42 });
    });

    it('should provide context and browser objects', async () => {
      await adapter.connect();
      
      const result = await adapter.runCode(`
        const pages = context.pages();
        return { success: true, pageCount: pages.length, hasBrowser: !!browser };
      `);
      
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ success: true, pageCount: 1, hasBrowser: true });
    });

    it('should handle code execution errors', async () => {
      await adapter.connect();
      
      const result = await adapter.runCode(`
        const x = undefined;
        x.toString();
        return { success: true };
      `);
      
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should support async function definitions', async () => {
      await adapter.connect();
      
      const result = await adapter.runCode(`
        async function execute(context, browser) {
          return { success: true, message: 'Hello from function' };
        }
      `);
      
      expect(result.success).toBe(true);
      expect(result.result).toEqual({ success: true, message: 'Hello from function' });
    });

    it('should emit operation event on code execution', async () => {
      await adapter.connect();
      
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);
      
      await adapter.runCode('return { success: true }');
      
      expect(operationHandler).toHaveBeenCalled();
    });
  });

  // ============================================
  // Event Emission Tests
  // ============================================

  describe('Event Emission', () => {
    it('should register context-level page event handler', async () => {
      await adapter.connect();
      const context = adapter.getContext() as any;
      
      // Verify that the context.on was called with 'page' event
      expect(context.on).toHaveBeenCalledWith('page', expect.any(Function));
    });
  });
});
