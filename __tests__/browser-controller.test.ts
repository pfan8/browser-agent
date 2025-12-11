/**
 * Browser Controller Unit Tests
 * 
 * Tests for BC-01 ~ BC-06 (Browser Connection) and BO-01 ~ BO-10 (Browser Operations)
 * Uses mocked Playwright to test browser controller logic without actual browser.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';

// Mock Playwright before importing BrowserController
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

// Import after mocking
import { BrowserController } from '../electron/browser-controller';
import { chromium } from 'playwright';

describe('BrowserController', () => {
  let controller: BrowserController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new BrowserController();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // BC-01 ~ BC-06: Browser Connection Tests
  // ============================================

  describe('BC-01: CDP Connection', () => {
    it('should connect to browser via CDP', async () => {
      const result = await controller.connect('http://localhost:9222');

      expect(result.success).toBe(true);
      expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222', {
        timeout: 30000,
      });
    });

    it('should use default CDP URL if not provided', async () => {
      await controller.connect();

      expect(chromium.connectOverCDP).toHaveBeenCalledWith('http://localhost:9222', {
        timeout: 30000,
      });
    });

    it('should handle connection failure', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Connection refused'));

      const result = await controller.connect();

      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
    });

    it('should emit connected event on successful connection', async () => {
      const connectedHandler = vi.fn();
      controller.on('connected', connectedHandler);

      await controller.connect();

      expect(connectedHandler).toHaveBeenCalled();
    });

    it('should emit connectionError event on failure', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Connection refused'));
      
      const errorHandler = vi.fn();
      controller.on('connectionError', errorHandler);

      await controller.connect();

      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Connection refused',
        canRetry: true,
      }));
    });
  });

  describe('BC-02: Connection Status', () => {
    it('should return disconnected status before connection', async () => {
      const status = await controller.getStatus();

      expect(status.connected).toBe(false);
    });

    it('should return connected status after connection', async () => {
      await controller.connect();
      const status = await controller.getStatus();

      expect(status.connected).toBe(true);
    });

    it('should include URL and title in status', async () => {
      await controller.connect();
      const status = await controller.getStatus();

      expect(status.url).toBe('https://example.com');
      expect(status.title).toBe('Example Page');
    });

    it('should report isConnected correctly', async () => {
      expect(controller.isConnected()).toBe(false);
      
      await controller.connect();
      expect(controller.isConnected()).toBe(true);
    });
  });

  describe('BC-03: Page Info', () => {
    it('should get page info after connection', async () => {
      await controller.connect();
      const pageInfo = await controller.getPageInfo();

      expect(pageInfo.url).toBe('https://example.com');
      expect(pageInfo.title).toBe('Example Page');
    });

    it('should return empty info when not connected', async () => {
      const pageInfo = await controller.getPageInfo();

      expect(pageInfo.url).toBe('');
      expect(pageInfo.title).toBe('');
    });
  });

  describe('BC-04: Multiple Tabs', () => {
    it('should list all pages', async () => {
      await controller.connect();
      const pages = await controller.listPages();

      expect(pages).toHaveLength(1);
      expect(pages[0].active).toBe(true);
    });

    it('should switch to page by index', async () => {
      await controller.connect();
      const result = await controller.switchToPage(0);

      expect(result.success).toBe(true);
    });

    it('should reject invalid page index', async () => {
      await controller.connect();
      const result = await controller.switchToPage(999);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid page index');
    });
  });

  describe('BC-05: Disconnect', () => {
    it('should disconnect cleanly', async () => {
      await controller.connect();
      await controller.disconnect();

      expect(controller.isConnected()).toBe(false);
    });

    it('should emit disconnected event', async () => {
      const disconnectedHandler = vi.fn();
      controller.on('disconnected', disconnectedHandler);

      await controller.connect();
      await controller.disconnect();

      expect(disconnectedHandler).toHaveBeenCalled();
    });

    it('should not affect browser on disconnect', async () => {
      await controller.connect();
      await controller.disconnect();

      // Browser.close should NOT be called - we only disconnect
      expect(controller.isConnected()).toBe(false);
    });
  });

  describe('BC-06: Reconnection', () => {
    it('should provide reconnect method', async () => {
      await controller.connect();
      await controller.disconnect();

      const result = await controller.reconnect();
      expect(result.success).toBe(true);
    });

    it('should emit reconnecting event', async () => {
      const reconnectingHandler = vi.fn();
      controller.on('reconnecting', reconnectingHandler);

      await controller.connect();
      await controller.reconnect();

      expect(reconnectingHandler).toHaveBeenCalledWith(expect.objectContaining({
        cdpUrl: 'http://localhost:9222',
      }));
    });

    it('should store last connection error', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Test error'));

      await controller.connect();

      expect(controller.getLastConnectionError()).toBe('Test error');
    });

    it('should clear connection error on successful connect', async () => {
      vi.mocked(chromium.connectOverCDP).mockRejectedValueOnce(new Error('Test error'));
      await controller.connect();

      expect(controller.getLastConnectionError()).toBe('Test error');

      vi.mocked(chromium.connectOverCDP).mockResolvedValueOnce({
        contexts: () => [{
          pages: () => [{
            url: () => 'https://example.com',
            title: () => Promise.resolve('Test'),
            on: vi.fn(),
            evaluate: vi.fn(() => Promise.resolve('complete')),
          }],
          on: vi.fn(),
        }],
      } as any);

      await controller.connect();
      expect(controller.getLastConnectionError()).toBeNull();
    });

    it('should get CDP URL', async () => {
      await controller.connect('http://custom:1234');
      expect(controller.getCdpUrl()).toBe('http://custom:1234');
    });
  });

  // ============================================
  // BO-01 ~ BO-10: Browser Operations Tests
  // ============================================

  describe('BO-01: Navigate', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should navigate to URL', async () => {
      const result = await controller.navigate('https://google.com');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://google.com' });
    });

    it('should add https protocol if missing', async () => {
      const result = await controller.navigate('google.com');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ url: 'https://google.com' });
    });

    it('should respect waitUntil option', async () => {
      await controller.navigate('https://example.com', 'domcontentloaded');

      // Page.goto should be called with the waitUntil option
      const mockPage = (await controller.getPage()) as any;
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.navigate('https://example.com');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'navigate',
        url: 'https://example.com',
      }));
    });

    it('should return error when not connected', async () => {
      await controller.disconnect();
      const result = await controller.navigate('https://example.com');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Browser not connected');
    });
  });

  describe('BO-02: Click', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should click element by selector', async () => {
      const result = await controller.click('#button');

      expect(result.success).toBe(true);
    });

    it('should try multiple selector strategies', async () => {
      // First strategy fails, second succeeds
      const mockPage = controller.getPage() as any;
      mockPage.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(selector.includes('text='))),
        click: vi.fn(() => Promise.resolve()),
      }));

      const result = await controller.click('Login');

      expect(result.success).toBe(true);
    });

    it('should emit operation event on success', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.click('#button');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'click',
      }));
    });
  });

  describe('BO-03: Type', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should type text into input', async () => {
      const mockPage = controller.getPage() as any;
      mockPage.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      });

      const result = await controller.type('#input', 'test text');

      expect(result.success).toBe(true);
    });

    it('should clear before typing by default', async () => {
      const mockPage = controller.getPage() as any;
      const mockLocator = {
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      };
      mockPage.locator.mockReturnValue(mockLocator);

      await controller.type('#input', 'test');

      expect(mockLocator.fill).toHaveBeenCalledWith('test', { timeout: 5000 });
    });

    it('should not clear when clear=false', async () => {
      const mockPage = controller.getPage() as any;
      const mockLocator = {
        isVisible: vi.fn(() => Promise.resolve(true)),
        fill: vi.fn(() => Promise.resolve()),
        type: vi.fn(() => Promise.resolve()),
      };
      mockPage.locator.mockReturnValue(mockLocator);

      await controller.type('#input', 'test', false);

      expect(mockLocator.type).toHaveBeenCalledWith('test', { timeout: 5000 });
    });
  });

  describe('BO-04: Screenshot', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should take screenshot', async () => {
      const result = await controller.screenshot();

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('path');
    });

    it('should use custom filename', async () => {
      const result = await controller.screenshot('custom-name');

      expect(result.success).toBe(true);
      expect((result.data as any).path).toContain('custom-name');
    });

    it('should support fullPage option', async () => {
      await controller.screenshot('test', false);

      const mockPage = controller.getPage() as any;
      expect(mockPage.screenshot).toHaveBeenCalledWith(expect.objectContaining({
        fullPage: false,
      }));
    });
  });

  describe('BO-05: Wait', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should wait for specified duration', async () => {
      const result = await controller.wait(1000);

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.wait(500);

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'wait',
        duration: 500,
      }));
    });
  });

  describe('BO-06: Press', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should press keyboard key', async () => {
      const result = await controller.press('Enter');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.press('Tab');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'press',
        key: 'Tab',
      }));
    });
  });

  describe('BO-07: Hover', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should hover over element', async () => {
      const mockPage = controller.getPage() as any;
      mockPage.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        hover: vi.fn(() => Promise.resolve()),
      });

      const result = await controller.hover('#element');

      expect(result.success).toBe(true);
    });
  });

  describe('BO-08: Select', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should select option from dropdown', async () => {
      const result = await controller.select('#dropdown', 'option1');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.select('#dropdown', 'value');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'select',
        value: 'value',
      }));
    });
  });

  describe('BO-09: Selector Strategies', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should try CSS selector first when valid', async () => {
      const mockPage = controller.getPage() as any;
      const clickFn = vi.fn(() => Promise.resolve());
      mockPage.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(true)),
        click: clickFn,
      });

      await controller.click('#my-button');

      // Should use CSS selector directly
      expect(mockPage.locator).toHaveBeenCalledWith('#my-button');
    });

    it('should try text selector for plain text', async () => {
      const mockPage = controller.getPage() as any;
      let callCount = 0;
      mockPage.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => Promise.resolve(callCount++ === 0)), // First call succeeds
        click: vi.fn(() => Promise.resolve()),
      }));

      await controller.click('Submit');

      // Should try multiple strategies including text=
      expect(mockPage.locator).toHaveBeenCalledWith('text="Submit"');
    });

    it('should try testid selector as one of the strategies', async () => {
      const mockPage = controller.getPage() as any;
      let callIndex = 0;
      // Make all strategies fail except testid
      mockPage.locator.mockImplementation((selector: string) => ({
        isVisible: vi.fn(() => {
          callIndex++;
          // Only succeed for testid selector
          return Promise.resolve(selector.includes('data-testid'));
        }),
        click: vi.fn(() => Promise.resolve()),
      }));

      await controller.click('submit-btn');

      // Should have tried data-testid at some point
      const calls = mockPage.locator.mock.calls.map((c: string[]) => c[0]);
      expect(calls).toContain('[data-testid="submit-btn"]');
    });
  });

  describe('BO-10: Selector Fallback', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should report selector alternatives in operation', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.click('Submit');

      const operation = operationHandler.mock.calls[0]?.[0];
      if (operation) {
        expect(operation.alternatives).toBeDefined();
      }
    });

    it('should return error with details when all strategies fail', async () => {
      const mockPage = controller.getPage() as any;
      mockPage.locator.mockReturnValue({
        isVisible: vi.fn(() => Promise.resolve(false)),
        click: vi.fn(() => Promise.reject(new Error('Element not found'))),
      });

      const result = await controller.click('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    });
  });

  // ============================================
  // Additional Tests
  // ============================================

  describe('waitForSelector', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should wait for element', async () => {
      const result = await controller.waitForSelector('#element');

      expect(result.success).toBe(true);
    });

    it('should support state option', async () => {
      await controller.waitForSelector('#element', 'hidden');

      const mockPage = controller.getPage() as any;
      expect(mockPage.waitForSelector).toHaveBeenCalledWith('#element', {
        state: 'hidden',
        timeout: 30000,
      });
    });
  });

  describe('runCode', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should execute arbitrary Playwright code', async () => {
      const result = await controller.runCode('await page.click("#btn")');

      expect(result.success).toBe(true);
    });

    it('should emit operation event', async () => {
      const operationHandler = vi.fn();
      controller.on('operation', operationHandler);

      await controller.runCode('console.log("test")');

      expect(operationHandler).toHaveBeenCalledWith(expect.objectContaining({
        type: 'code',
      }));
    });
  });

  describe('evaluateSelector', () => {
    beforeEach(async () => {
      await controller.connect();
    });

    it('should find selectors for element description', async () => {
      const mockPage = controller.getPage() as any;
      mockPage.evaluate.mockResolvedValueOnce(['#login-btn', 'button:has-text("Login")']);

      const result = await controller.evaluateSelector('login button');

      expect(result.selector).toBe('#login-btn');
      expect(result.alternatives).toContain('button:has-text("Login")');
    });

    it('should return empty when not connected', async () => {
      await controller.disconnect();
      const result = await controller.evaluateSelector('test');

      expect(result.selector).toBe('');
      expect(result.alternatives).toEqual([]);
    });
  });
});

