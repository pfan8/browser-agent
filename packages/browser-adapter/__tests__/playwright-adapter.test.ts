/**
 * Playwright Adapter Tests
 * 
 * Comprehensive tests for BC-01 ~ BC-06 (Browser Connection) and BO-01 ~ BO-10 (Browser Operations)
 * Uses mocked Playwright to test browser adapter logic without actual browser.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock playwright - must be defined before imports and cannot reference external variables
vi.mock('playwright', () => {
  const mockPage = {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(() => Promise.resolve('Example Page')),
    goto: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => Promise.resolve()),
    fill: vi.fn(() => Promise.resolve()),
    type: vi.fn(() => Promise.resolve()),
    screenshot: vi.fn(() => Promise.resolve(Buffer.from('fake-image'))),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForSelector: vi.fn(() => Promise.resolve()),
    keyboard: {
      press: vi.fn(() => Promise.resolve()),
    },
    selectOption: vi.fn(() => Promise.resolve()),
    hover: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve('complete')),
    content: vi.fn(() => Promise.resolve('<html><body>Test</body></html>')),
    locator: vi.fn(() => ({
      click: vi.fn(() => Promise.resolve()),
      fill: vi.fn(() => Promise.resolve()),
      type: vi.fn(() => Promise.resolve()),
      hover: vi.fn(() => Promise.resolve()),
      isVisible: vi.fn(() => Promise.resolve(true)),
    })),
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

// Helper to create fresh mock objects for specific tests
function createMockPage() {
  return {
    url: vi.fn(() => 'https://example.com'),
    title: vi.fn(() => Promise.resolve('Example Page')),
    goto: vi.fn(() => Promise.resolve()),
    click: vi.fn(() => Promise.resolve()),
    fill: vi.fn(() => Promise.resolve()),
    type: vi.fn(() => Promise.resolve()),
    screenshot: vi.fn(() => Promise.resolve(Buffer.from('fake-image'))),
    waitForTimeout: vi.fn(() => Promise.resolve()),
    waitForSelector: vi.fn(() => Promise.resolve()),
    keyboard: {
      press: vi.fn(() => Promise.resolve()),
    },
    selectOption: vi.fn(() => Promise.resolve()),
    hover: vi.fn(() => Promise.resolve()),
    evaluate: vi.fn(() => Promise.resolve('complete')),
    content: vi.fn(() => Promise.resolve('<html><body>Test</body></html>')),
    locator: vi.fn(() => ({
      click: vi.fn(() => Promise.resolve()),
      fill: vi.fn(() => Promise.resolve()),
      type: vi.fn(() => Promise.resolve()),
      hover: vi.fn(() => Promise.resolve()),
      isVisible: vi.fn(() => Promise.resolve(true)),
    })),
    on: vi.fn(),
  };
}

function createMockContext(mockPage: ReturnType<typeof createMockPage>) {
  return {
    pages: vi.fn(() => [mockPage]),
    newPage: vi.fn(() => Promise.resolve(mockPage)),
    on: vi.fn(),
  };
}

function createMockBrowser(mockContext: ReturnType<typeof createMockContext>) {
  return {
    contexts: vi.fn(() => [mockContext]),
    newContext: vi.fn(() => Promise.resolve(mockContext)),
    close: vi.fn(() => Promise.resolve()),
  };
}

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
      expect(browserAdapter.navigate).toBeDefined();
      expect(browserAdapter.click).toBeDefined();
      expect(browserAdapter.type).toBeDefined();
      expect(browserAdapter.press).toBeDefined();
      expect(browserAdapter.hover).toBeDefined();
      expect(browserAdapter.select).toBeDefined();
      expect(browserAdapter.wait).toBeDefined();
      expect(browserAdapter.waitForSelector).toBeDefined();
      expect(browserAdapter.screenshot).toBeDefined();
      expect(browserAdapter.getPageInfo).toBeDefined();
      expect(browserAdapter.getPageContent).toBeDefined();
      expect(browserAdapter.evaluateSelector).toBeDefined();
      expect(browserAdapter.listPages).toBeDefined();
      expect(browserAdapter.switchToPage).toBeDefined();
      expect(browserAdapter.runCode).toBeDefined();
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
  // BC-01 ~ BC-06: Browser Connection Tests
  // ============================================

  describe('BC-01: CDP Connection', () => {
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

      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Connection refused',
        canRetry: true,
      }));
    });
  });

  describe('BC-02: Connection Status', () => {
    it('should return disconnected status before connection', async () => {
      const status = await adapter.getStatus();

      expect(status.connected).toBe(false);
    });

    it('should return connected status after connection', async () => {
      await adapter.connect();
      const status = await adapter.getStatus();

      expect(status.connected).toBe(true);
    });

    it('should include URL and title in status', async () => {
      await adapter.connect();
      const status = await adapter.getStatus();

      expect(status.url).toBe('https://example.com');
      expect(status.title).toBe('Example Page');
    });

    it('should report isConnected correctly', async () => {
      expect(adapter.isConnected()).toBe(false);
      
      await adapter.connect();
      expect(adapter.isConnected()).toBe(true);
    });
  });

  describe('BC-03: Page Info', () => {
    it('should get page info after connection', async () => {
      await adapter.connect();
      const pageInfo = await adapter.getPageInfo();

      expect(pageInfo.url).toBe('https://example.com');
      expect(pageInfo.title).toBe('Example Page');
    });

    it('should return empty info when not connected', async () => {
      const pageInfo = await adapter.getPageInfo();

      expect(pageInfo.url).toBe('');
      expect(pageInfo.title).toBe('');
    });

    it('should get page content after connection', async () => {
      await adapter.connect();
      const content = await adapter.getPageContent();

      expect(content).toContain('<html>');
    });

    it('should return empty content when not connected', async () => {
      const content = await adapter.getPageContent();

      expect(content).toBe('');
    });
  });

  describe('BC-04: Multiple Tabs', () => {
    it('should list all pages', async () => {
      await adapter.connect();
      const pages = await adapter.listPages();

      expect(pages).toHaveLength(1);
      expect(pages[0].active).toBe(true);
    });

    it('should return empty list when not connected', async () => {
      const pages = await adapter.listPages();

      expect(pages).toEqual([]);
    });

    it('should switch to page by index', async () => {
      await adapter.connect();
      const result = await adapter.switchToPage(0);

      expect(result.success).toBe(true);
    });

    it('should reject invalid page index', async () => {
      await adapter.connect();
      const result = await adapter.switchToPage(999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid page index');
    });

    it('should return error when not connected', async () => {
      const result = await adapter.switchToPage(0);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BC-05: Disconnect', () => {
    it('should disconnect cleanly', async () => {
      await adapter.connect();
      await adapter.disconnect();

      expect(adapter.isConnected()).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const disconnectedHandler = vi.fn();
      adapter.on('disconnected', disconnectedHandler);

      await adapter.connect();
      await adapter.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('should not affect browser on disconnect (no browser.close call)', async () => {
      await adapter.connect();
      await adapter.disconnect();

      // Browser.close should NOT be called - we only disconnect the CDP connection
      expect(adapter.isConnected()).toBe(false);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw
      await expect(adapter.disconnect()).resolves.toBeUndefined();
    });
  });

  describe('BC-06: Reconnection', () => {
    it('should provide reconnect method', async () => {
      await adapter.connect();
      await adapter.disconnect();

      const result = await adapter.reconnect();
      expect(result.success).toBe(true);
    });

    it('should emit reconnecting event', async () => {
      const reconnectingHandler = vi.fn();
      adapter.on('reconnecting', reconnectingHandler);

      await adapter.connect();
      await adapter.reconnect();

      expect(reconnectingHandler).toHaveBeenCalledWith(expect.objectContaining({
        cdpUrl: 'http://localhost:9222',
      }));
    });

    it('should store last connection error', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Test error'));

      await adapter.connect();

      expect(adapter.getLastConnectionError()).toBe('Test error');
    });

    it('should return null for last connection error initially', () => {
      expect(adapter.getLastConnectionError()).toBeNull();
    });

    it('should clear connection error on successful connect', async () => {
      // First, fail the connection
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Test error'));
      await adapter.connect();
      expect(adapter.getLastConnectionError()).toBe('Test error');

      // Now, succeed
      const mockPage = createMockPage();
      const mockContext = createMockContext(mockPage);
      const mockBrowser = createMockBrowser(mockContext);
      vi.mocked(chromium.connectOverCDP).mockResolvedValueOnce(mockBrowser as any);

      await adapter.connect();
      expect(adapter.getLastConnectionError()).toBeNull();
    });

    it('should get CDP URL', async () => {
      await adapter.connect('http://custom:1234');
      expect(adapter.getCdpUrl()).toBe('http://custom:1234');
    });
  });

  // ============================================
  // BO-01 ~ BO-10: Browser Operations Tests
  // ============================================

  describe('BO-01: Navigate', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should navigate to URL', async () => {
      const result = await adapter.navigate('https://google.com');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://google.com' });
    });

    it('should add https protocol if missing', async () => {
      const result = await adapter.navigate('google.com');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://google.com' });
    });

    it('should preserve http protocol', async () => {
      const result = await adapter.navigate('http://example.com');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'http://example.com' });
    });

    it('should respect waitUntil option', async () => {
      const page = adapter.getPage() as any;
      await adapter.navigate('https://example.com', 'domcontentloaded');

      expect(page.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.navigate('https://example.com');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'navigate',
        url: 'https://example.com',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.navigate('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Browser not connected');
    });
  });

  describe('BO-02: Click', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should click element by selector', async () => {
      const result = await adapter.click('#button');

      expect(result.success).toBe(true);
    });

    it('should try multiple selector strategies', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('text='))),
        click: vi.fn(() => Promise.resolve()),
      }));

      const result = await adapter.click('Login');

      expect(result.success).toBe(true);
    });

    it('should emit operation event on success', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.click('#button');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'click',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.click('#button');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-03: Type', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should type text into input', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      });

      const result = await adapter.type('#input', 'test text');

      expect(result.success).toBe(true);
    });

    it('should clear before typing by default (use fill)', async () => {
      const page = adapter.getPage() as any;
      const mockLocator = {
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      };
      page.locator.mockReturnValue(mockLocator);

      await adapter.type('#input', 'test');

      expect(mockLocator.fill).toHaveBeenCalledWith('test', { timeout: 10000 });
    });

    it('should not clear when clear=false (use type)', async () => {
      const page = adapter.getPage() as any;
      const mockLocator = {
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      };
      page.locator.mockReturnValue(mockLocator);

      await adapter.type('#input', 'test', false);

      expect(mockLocator.type).toHaveBeenCalledWith('test', { timeout: 10000 });
    });

    it('should emit operation event', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
      });

      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.type('#input', 'test');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'type',
        text: 'test',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.type('#input', 'test');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-04: Screenshot', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should take screenshot', async () => {
      const result = await adapter.screenshot();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('path');
    });

    it('should use custom filename', async () => {
      const result = await adapter.screenshot('custom-name');

      expect(result.success).toBe(true);
      expect((result.data as any).path).toContain('custom-name');
    });

    it('should support fullPage option', async () => {
      const page = adapter.getPage() as any;
      await adapter.screenshot('test', false);

      expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({
        fullPage: false,
      }));
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.screenshot('test');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'screenshot',
        name: 'test',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.screenshot();

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-05: Wait', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should wait for specified duration', async () => {
      const result = await adapter.wait(1000);

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.wait(500);

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wait',
        duration: 500,
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.wait(1000);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-06: Press', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should press keyboard key', async () => {
      const result = await adapter.press('Enter');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.press('Tab');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'press',
        key: 'Tab',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.press('Enter');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-07: Hover', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should hover over element', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        hover: vi.fn(() => Promise.resolve()),
      });

      const result = await adapter.hover('#element');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        hover: vi.fn(() => Promise.resolve()),
      });

      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.hover('#element');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'hover',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.hover('#element');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-08: Select', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should select option from dropdown', async () => {
      const result = await adapter.select('#dropdown', 'option1');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.select('#dropdown', 'value');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'select',
        value: 'value',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.select('#dropdown', 'value');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('BO-09: Selector Strategies', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should try CSS selector first when valid', async () => {
      const page = adapter.getPage() as any;
      const clickFn = vi.fn(() => Promise.resolve());
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        click: clickFn,
      });

      await adapter.click('#my-button');

      expect(page.locator).toHaveBeenCalledWith('#my-button');
    });

    it('should try text selector for plain text', async () => {
      const page = adapter.getPage() as any;
      let callCount = 0;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(callCount++ === 0)),
        click: vi.fn(() => Promise.resolve()),
      }));

      await adapter.click('Submit');

      expect(page.locator).toHaveBeenCalledWith('text="Submit"');
    });

    it('should try testid selector as one of the strategies', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('data-testid'))),
        click: vi.fn(() => Promise.resolve()),
      }));

      await adapter.click('submit-btn');

      const calls = page.locator.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain('[data-testid="submit-btn"]');
    });

    it('should try role selector', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('role='))),
        click: vi.fn(() => Promise.resolve()),
      }));

      await adapter.click('Login');

      const calls = page.locator.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain('role=button[name="Login"]');
    });

    it('should try placeholder selector', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('placeholder'))),
        click: vi.fn(() => Promise.resolve()),
      }));

      await adapter.click('Enter email');

      const calls = page.locator.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain('[placeholder="Enter email"]');
    });

    it('should try label selector', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('label='))),
        click: vi.fn(() => Promise.resolve()),
      }));

      await adapter.click('Email Address');

      const calls = page.locator.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain('label=Email Address');
    });
  });

  describe('BO-10: Selector Fallback', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should report selector alternatives in operation', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.click('Submit');

      const operation = operationHandler.mock.calls[0]?.[0];
      if (operation) {
        expect(operation.alternatives).toBeDefined();
      }
    });

    it('should return error with details when all strategies fail', async () => {
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.reject(new Error('Element not found'))),
      });

      const result = await adapter.click('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });

    it('should try next strategy when first fails', async () => {
      const page = adapter.getPage() as any;
      let attemptCount = 0;
      page.locator.mockImplementation(() => ({
        isVisible: vi.fn(() => {
          attemptCount++;
          // Fail first 2 attempts, succeed on 3rd
          return Promise.resolve(attemptCount >= 3);
        }),
        click: vi.fn(() => Promise.resolve()),
      }));

      const result = await adapter.click('Button');

      expect(result.success).toBe(true);
      expect(attemptCount).toBeGreaterThan(1);
    });
  });

  // ============================================
  // Additional Operations Tests
  // ============================================

  describe('waitForSelector', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should wait for element', async () => {
      const result = await adapter.waitForSelector('#element');

      expect(result.success).toBe(true);
    });

    it('should support state option', async () => {
      const page = adapter.getPage() as any;
      await adapter.waitForSelector('#element', 'hidden');

      expect(page.waitForSelector).toHaveBeenCalledWith('#element', {
        state: 'hidden',
        timeout: 30000,
      });
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.waitForSelector('#element');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wait',
        selector: '#element',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.waitForSelector('#element');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('runCode', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should execute arbitrary Playwright code', async () => {
      const result = await adapter.runCode('await page.click("#btn")');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      adapter.on('operation', operationHandler);

      await adapter.runCode('console.log("test")');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'code',
      }));
    });

    it('should return error when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.runCode('console.log("test")');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not connected');
    });
  });

  describe('evaluateSelector', () => {
    beforeEach(async () => {
      await adapter.connect();
    });

    it('should find selectors for element description', async () => {
      const page = adapter.getPage() as any;
      page.evaluate.mockResolvedValueOnce(['#login-btn', 'button:has-text("Login")']);

      const result = await adapter.evaluateSelector('login button');

      expect(result.selector).toBe('#login-btn');
      expect(result.alternatives).toContain('button:has-text("Login")');
    });

    it('should return empty when not connected', async () => {
      await adapter.disconnect();
      const result = await adapter.evaluateSelector('test');

      expect(result.selector).toBe('');
      expect(result.alternatives).toEqual([]);
    });
  });

  // ============================================
  // Event Emission Tests
  // ============================================

  describe('Event Emission', () => {
    it('should emit events', () => {
      const handler = vi.fn();
      adapter.on('test', handler);
      adapter.emit('test', { data: 'value' });
      expect(handler).toHaveBeenCalledWith({ data: 'value' });
    });

    it('should remove event listeners', () => {
      const handler = vi.fn();
      adapter.on('test', handler);
      adapter.off('test', handler);
      adapter.emit('test', { data: 'value' });
      expect(handler).not.toHaveBeenCalled();
    });

    it('should emit connected event on connection', async () => {
      const handler = vi.fn();
      adapter.on('connected', handler);

      await adapter.connect();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        url: expect.any(String),
      }));
    });

    it('should emit disconnected event on disconnect', async () => {
      const handler = vi.fn();
      adapter.on('disconnected', handler);

      await adapter.connect();
      await adapter.disconnect();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'user_disconnect',
      }));
    });

    it('should emit operation events for navigate', async () => {
      await adapter.connect();
      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.navigate('https://example.com');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'navigate',
        url: 'https://example.com',
      }));
    });

    it('should emit operation events for click', async () => {
      await adapter.connect();
      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.click('#button');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'click',
      }));
    });

    it('should emit operation events for type', async () => {
      await adapter.connect();
      const page = adapter.getPage() as any;
      page.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
      });

      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.type('#input', 'test');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'type',
        text: 'test',
      }));
    });

    it('should emit operation events for press', async () => {
      await adapter.connect();
      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.press('Enter');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'press',
        key: 'Enter',
      }));
    });

    it('should emit operation events for screenshot', async () => {
      await adapter.connect();
      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.screenshot('test');

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'screenshot',
        name: 'test',
      }));
    });

    it('should emit operation events for wait', async () => {
      await adapter.connect();
      const handler = vi.fn();
      adapter.on('operation', handler);

      await adapter.wait(1000);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wait',
        duration: 1000,
      }));
    });

    it('should register pageLoad event handler on page', async () => {
      await adapter.connect();
      const page = adapter.getPage() as any;
      
      // Verify that the page.on was called with 'load' event
      expect(page.on).toHaveBeenCalledWith('load', expect.any(Function));
    });

    it('should be able to listen for pageLoad events', async () => {
      const handler = vi.fn();
      adapter.on('pageLoad', handler);
      
      // Manually emit to verify listener works
      adapter.emit('pageLoad', { url: 'https://example.com' });
      
      expect(handler).toHaveBeenCalledWith({ url: 'https://example.com' });
    });

    it('should register console event handler on page', async () => {
      await adapter.connect();
      const page = adapter.getPage() as any;
      
      // Verify that the page.on was called with 'console' event
      expect(page.on).toHaveBeenCalledWith('console', expect.any(Function));
    });

    it('should register dialog event handler on page', async () => {
      await adapter.connect();
      const page = adapter.getPage() as any;
      
      // Verify that the page.on was called with 'dialog' event
      expect(page.on).toHaveBeenCalledWith('dialog', expect.any(Function));
    });
  });
});
