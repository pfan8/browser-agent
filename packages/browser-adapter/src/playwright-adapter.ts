/**
 * Playwright Browser Adapter
 * 
 * Implementation of IBrowserAdapter using Playwright CDP connection.
 * This module can be tested independently of Electron.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { 
  IBrowserAdapter, 
  OperationResult, 
  BrowserStatus, 
  PageInfo, 
  TabInfo,
  SelectorStrategy,
  BrowserAdapterConfig,
} from './types';
import { DEFAULT_BROWSER_ADAPTER_CONFIG } from './types';

function genOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class PlaywrightAdapter extends EventEmitter implements IBrowserAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpUrl: string = 'http://localhost:9222';
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private lastConnectionError: string | null = null;
  private config: BrowserAdapterConfig;

  constructor(config: Partial<BrowserAdapterConfig> = {}) {
    super();
    this.config = { ...DEFAULT_BROWSER_ADAPTER_CONFIG, ...config };
  }

  /**
   * Get the last connection error
   */
  getLastConnectionError(): string | null {
    return this.lastConnectionError;
  }

  /**
   * Clear the last connection error
   */
  clearConnectionError(): void {
    this.lastConnectionError = null;
  }

  /**
   * Check if a URL is an internal browser page that should be skipped
   */
  private isInternalPage(url: string): boolean {
    const internalPrefixes = [
      'chrome://',
      'chrome-extension://',
      'chrome-error://',
      'about:',
      'edge://',
      'brave://',
      'devtools://',
    ];
    return internalPrefixes.some(prefix => url.startsWith(prefix));
  }

  /**
   * Connect to a browser via CDP
   */
  async connect(cdpUrl?: string): Promise<OperationResult> {
    if (cdpUrl) {
      this.cdpUrl = cdpUrl;
    }

    try {
      console.log(`[BrowserAdapter] Connecting to browser at ${this.cdpUrl}...`);
      
      this.browser = await chromium.connectOverCDP(this.cdpUrl, {
        timeout: this.config.defaultTimeout
      });

      // Get existing contexts or create new one
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        this.context = await this.browser.newContext();
      }

      // Get existing page, preferring non-internal pages
      const pages = this.context.pages();
      if (pages.length > 0) {
        // Find first non-internal page
        const userPage = pages.find(p => !this.isInternalPage(p.url()));
        this.page = userPage || pages[0];
      } else {
        this.page = await this.context.newPage();
      }

      // Setup event listeners
      this.setupPageListeners();
      
      // Setup connection health check
      this.startConnectionHealthCheck();
      
      // Clear any previous connection errors
      this.lastConnectionError = null;

      console.log('[BrowserAdapter] Connected to browser successfully');
      this.emit('connected', { url: this.page.url() });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastConnectionError = errorMessage;
      console.error('[BrowserAdapter] Failed to connect:', errorMessage);
      this.emit('connectionError', { error: errorMessage, canRetry: true });
      return { success: false, error: errorMessage };
    }
  }
  
  /**
   * Start connection health check interval
   */
  private healthCheckFailCount = 0;
  private static readonly MAX_HEALTH_CHECK_FAILURES = 5;
  private isHealthCheckDisconnecting = false;

  private startConnectionHealthCheck(): void {
    this.stopConnectionHealthCheck();
    this.healthCheckFailCount = 0;
    this.isHealthCheckDisconnecting = false;
    
    this.connectionCheckInterval = setInterval(async () => {
      // Skip if already disconnecting or not connected
      if (this.isHealthCheckDisconnecting || !this.browser || !this.page) return;
      
      try {
        await this.page.evaluate(() => document.readyState);
        // Reset failure count on success
        this.healthCheckFailCount = 0;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection lost';
        
        // Check if it's a navigation-related transient error
        const isTransientError = errorMessage.includes('Execution context was destroyed') ||
                                 errorMessage.includes('navigation') ||
                                 errorMessage.includes('Target closed');
        
        if (isTransientError) {
          this.healthCheckFailCount++;
          console.error(`[BrowserAdapter] Connection health check failed (${this.healthCheckFailCount}/${PlaywrightAdapter.MAX_HEALTH_CHECK_FAILURES}): ${errorMessage}`);
          
          // Only disconnect after multiple consecutive failures
          if (this.healthCheckFailCount < PlaywrightAdapter.MAX_HEALTH_CHECK_FAILURES) {
            return;
          }
        }
        
        // Prevent multiple disconnection attempts
        if (this.isHealthCheckDisconnecting) return;
        this.isHealthCheckDisconnecting = true;
        
        console.error('[BrowserAdapter] Connection health check failed permanently:', errorMessage);
        
        this.lastConnectionError = errorMessage;
        
        this.stopConnectionHealthCheck();
        
        this.emit('connectionLost', { 
          error: errorMessage,
          canReconnect: true,
          cdpUrl: this.cdpUrl
        });
        
        this.browser = null;
        this.context = null;
        this.page = null;
        
        this.emit('disconnected', { reason: 'connection_lost', error: errorMessage });
      }
    }, this.config.healthCheckInterval);
  }
  
  /**
   * Stop connection health check interval
   */
  private stopConnectionHealthCheck(): void {
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval);
      this.connectionCheckInterval = null;
    }
  }

  /**
   * Disconnect from browser
   */
  async disconnect(): Promise<void> {
    this.stopConnectionHealthCheck();
    
    if (this.browser) {
      this.browser = null;
      this.context = null;
      this.page = null;
      this.emit('disconnected', { reason: 'user_disconnect' });
      console.log('[BrowserAdapter] Disconnected from browser');
    }
  }
  
  /**
   * Reconnect to browser
   */
  async reconnect(): Promise<OperationResult> {
    console.log(`[BrowserAdapter] Attempting to reconnect to ${this.cdpUrl}...`);
    this.emit('reconnecting', { cdpUrl: this.cdpUrl });
    
    this.stopConnectionHealthCheck();
    this.browser = null;
    this.context = null;
    this.page = null;
    
    return this.connect(this.cdpUrl);
  }
  
  /**
   * Get the current CDP URL
   */
  getCdpUrl(): string {
    return this.cdpUrl;
  }

  /**
   * Get current browser status
   */
  async getStatus(): Promise<BrowserStatus> {
    if (!this.page) {
      return { connected: false };
    }

    try {
      return {
        connected: true,
        url: this.page.url(),
        title: await this.page.title()
      };
    } catch {
      return { connected: false };
    }
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.browser !== null && this.page !== null;
  }

  /**
   * Navigate to a URL
   */
  async navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' = 'networkidle'): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      let fullUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        fullUrl = `https://${url}`;
      }

      await this.page.goto(fullUrl, { waitUntil, timeout: this.config.defaultTimeout });

      this.emit('operation', {
        id: genOpId(),
        type: 'navigate',
        url: fullUrl,
        waitUntil,
        timestamp: new Date().toISOString()
      });

      return { success: true, data: { url: fullUrl } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Navigation failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Navigate back in history
   */
  async goBack(): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      // Use shorter timeout and waitUntil: 'commit' for faster response
      const response = await this.page.goBack({ 
        timeout: 10000,
        waitUntil: 'commit'
      });
      
      this.emit('operation', {
        id: genOpId(),
        type: 'goBack',
        timestamp: new Date().toISOString()
      });

      return { 
        success: true, 
        data: { url: this.page.url(), navigated: response !== null } 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Go back failed';
      // If navigation was aborted, it might still have worked
      if (errorMessage.includes('ERR_ABORTED')) {
        return { success: true, data: { url: this.page?.url() || '', navigated: true } };
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Navigate forward in history
   */
  async goForward(): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      // Use shorter timeout and waitUntil: 'commit' for faster response
      const response = await this.page.goForward({ 
        timeout: 10000,
        waitUntil: 'commit'
      });
      
      this.emit('operation', {
        id: genOpId(),
        type: 'goForward',
        timestamp: new Date().toISOString()
      });

      return { 
        success: true, 
        data: { url: this.page.url(), navigated: response !== null } 
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Go forward failed';
      // If navigation was aborted, it might still have worked
      if (errorMessage.includes('ERR_ABORTED')) {
        return { success: true, data: { url: this.page?.url() || '', navigated: true } };
      }
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Click on an element
   */
  async click(selector: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      const strategies = this.buildSelectorStrategies(selector);
      let lastError: string = '';

      for (const { locator, strategy, selectorValue } of strategies) {
        try {
          const element = this.page.locator(locator);
          if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
            await element.click({ timeout: 10000 });

            this.emit('operation', {
              id: genOpId(),
              type: 'click',
              selector: selectorValue,
              selectorStrategy: strategy,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            });

            return { success: true };
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Click failed';
          continue;
        }
      }

      return { success: false, error: `Element not found: ${selector}. Last error: ${lastError}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Click failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Type text into an element
   */
  async type(selector: string, text: string, clear: boolean = true): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      const strategies = this.buildSelectorStrategies(selector);
      let lastError: string = '';

      for (const { locator, strategy, selectorValue } of strategies) {
        try {
          const element = this.page.locator(locator);
          if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
            if (clear) {
              await element.fill(text, { timeout: 10000 });
            } else {
              await element.type(text, { timeout: 10000 });
            }

            this.emit('operation', {
              id: genOpId(),
              type: 'type',
              selector: selectorValue,
              selectorStrategy: strategy,
              text,
              clear,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            });

            return { success: true };
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : 'Type failed';
          continue;
        }
      }

      return { success: false, error: `Element not found: ${selector}. Last error: ${lastError}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Type failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Press a keyboard key
   */
  async press(key: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      await this.page.keyboard.press(key);

      this.emit('operation', {
        id: genOpId(),
        type: 'press',
        key,
        timestamp: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Press failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Hover over an element
   */
  async hover(selector: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      const strategies = this.buildSelectorStrategies(selector);
      
      for (const { locator, strategy, selectorValue } of strategies) {
        try {
          const element = this.page.locator(locator);
          if (await element.isVisible({ timeout: 5000 }).catch(() => false)) {
            await element.hover({ timeout: 10000 });

            this.emit('operation', {
              id: genOpId(),
              type: 'hover',
              selector: selectorValue,
              selectorStrategy: strategy,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            });

            return { success: true };
          }
        } catch {
          continue;
        }
      }

      return { success: false, error: `Element not found: ${selector}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Hover failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Select option from dropdown
   */
  async select(selector: string, value: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      await this.page.selectOption(selector, value, { timeout: 5000 });

      this.emit('operation', {
        id: genOpId(),
        type: 'select',
        selector,
        selectorStrategy: 'css',
        value,
        timestamp: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Select failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Wait for specified duration
   */
  async wait(ms: number): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      await this.page.waitForTimeout(ms);

      this.emit('operation', {
        id: genOpId(),
        type: 'wait',
        duration: ms,
        timestamp: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Wait failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Wait for an element
   */
  async waitForSelector(selector: string, state: 'attached' | 'visible' | 'hidden' = 'visible'): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      await this.page.waitForSelector(selector, { state, timeout: this.config.defaultTimeout });

      this.emit('operation', {
        id: genOpId(),
        type: 'wait',
        selector,
        state,
        timestamp: new Date().toISOString()
      });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Wait for selector failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Take a screenshot
   */
  async screenshot(name?: string, fullPage: boolean = true): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      const filename = name || `screenshot_${Date.now()}`;
      const path = `${this.config.screenshotPath}/${filename}.png`;
      
      await this.page.screenshot({ path, fullPage });

      this.emit('operation', {
        id: genOpId(),
        type: 'screenshot',
        name: filename,
        fullPage,
        path,
        timestamp: new Date().toISOString()
      });

      return { success: true, data: { path } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Screenshot failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current page info
   */
  async getPageInfo(): Promise<PageInfo> {
    if (!this.page) {
      return { url: '', title: '' };
    }

    try {
      return {
        url: this.page.url(),
        title: await this.page.title()
      };
    } catch {
      return { url: '', title: '' };
    }
  }

  /**
   * Get page HTML content
   */
  async getPageContent(): Promise<string> {
    if (!this.page) {
      return '';
    }

    try {
      return await this.page.content();
    } catch {
      return '';
    }
  }

  /**
   * Evaluate JavaScript to find selectors for an element description
   */
  async evaluateSelector(description: string): Promise<{ selector: string; alternatives: string[] }> {
    if (!this.page) {
      return { selector: '', alternatives: [] };
    }

    try {
      const result = await this.page.evaluate((desc: string) => {
        const descLower = desc.toLowerCase();
        const selectors: string[] = [];

        const allElements = document.querySelectorAll('button, a, input, [role="button"], [data-testid]');
        
        for (const el of allElements) {
          const text = (el.textContent || '').trim().toLowerCase();
          const testId = el.getAttribute('data-testid');
          const ariaLabel = el.getAttribute('aria-label');
          const placeholder = el.getAttribute('placeholder');
          const id = el.id;
          const name = el.getAttribute('name');

          if (text && text.includes(descLower)) {
            if (testId) selectors.push(`[data-testid="${testId}"]`);
            if (id) selectors.push(`#${id}`);
            const tagName = el.tagName.toLowerCase();
            selectors.push(`${tagName}:has-text("${el.textContent?.trim().slice(0, 50)}")`);
          }

          if (ariaLabel && ariaLabel.toLowerCase().includes(descLower)) {
            selectors.push(`[aria-label="${ariaLabel}"]`);
          }

          if (placeholder && placeholder.toLowerCase().includes(descLower)) {
            selectors.push(`[placeholder="${placeholder}"]`);
          }

          if (testId && testId.toLowerCase().includes(descLower)) {
            selectors.push(`[data-testid="${testId}"]`);
          }

          if (name && name.toLowerCase().includes(descLower)) {
            selectors.push(`[name="${name}"]`);
          }
        }

        return selectors.slice(0, 5);
      }, description);

      return {
        selector: result[0] || '',
        alternatives: result.slice(1)
      };
    } catch {
      return { selector: '', alternatives: [] };
    }
  }

  /**
   * List all open pages/tabs (excluding internal browser pages)
   */
  async listPages(): Promise<TabInfo[]> {
    if (!this.context) {
      return [];
    }

    const pages = this.context.pages();
    const result: TabInfo[] = [];

    // Filter out internal pages and build list with correct indices
    let userPageIndex = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        const url = page.url();
        
        // Skip internal browser pages
        if (this.isInternalPage(url)) {
          continue;
        }
        
        const titlePromise = page.title();
        const timeoutPromise = new Promise<string>((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 2000)
        );
        
        let title = 'Untitled';
        try {
          title = await Promise.race([titlePromise, timeoutPromise]);
        } catch {
          title = 'Untitled';
        }
        
        result.push({
          index: userPageIndex,  // Use sequential index for user pages only
          url,
          title,
          active: page === this.page
        });
        userPageIndex++;
      } catch {
        // Skip pages that throw errors
        continue;
      }
    }

    return result;
  }
  
  /**
   * Get user pages only (excluding internal browser pages)
   */
  private getUserPages(): Page[] {
    if (!this.context) return [];
    return this.context.pages().filter(p => !this.isInternalPage(p.url()));
  }

  /**
   * Switch to a different page/tab by index (uses filtered user pages)
   */
  async switchToPage(index: number): Promise<OperationResult> {
    if (!this.context) {
      return { success: false, error: 'Browser not connected' };
    }

    // Stop health check during switch to prevent race condition
    this.stopConnectionHealthCheck();

    // Use filtered user pages (excluding internal browser pages)
    const userPages = this.getUserPages();
    
    if (index < 0 || index >= userPages.length) {
      this.startConnectionHealthCheck();
      return { success: false, error: `Invalid page index: ${index}. Available: 0-${userPages.length - 1}` };
    }

    this.page = userPages[index];
    this.setupPageListeners();

    try {
      const title = await this.page.title();
      const url = this.page.url();
      
      // Restart health check after successful switch
      this.startConnectionHealthCheck();
      
      return { 
        success: true, 
        data: { index, url, title } 
      };
    } catch {
      // Restart health check even on error
      this.startConnectionHealthCheck();
      
      return { success: true, data: { index } };
    }
  }

  /**
   * Close a page/tab by index (default: current page)
   */
  async closePage(index?: number): Promise<OperationResult> {
    if (!this.context) {
      return { success: false, error: 'Browser not connected' };
    }

    const userPages = this.getUserPages();
    
    if (userPages.length === 0) {
      return { success: false, error: 'No pages to close' };
    }

    // If no index provided, close current page
    const targetIndex = index ?? userPages.findIndex(p => p === this.page);
    
    if (targetIndex < 0 || targetIndex >= userPages.length) {
      return { success: false, error: `Invalid page index: ${targetIndex}. Available: 0-${userPages.length - 1}` };
    }

    const pageToClose = userPages[targetIndex];
    const closingCurrentPage = pageToClose === this.page;

    try {
      await pageToClose.close();

      this.emit('operation', {
        id: genOpId(),
        type: 'closePage',
        index: targetIndex,
        timestamp: new Date().toISOString()
      });

      // If we closed the current page, switch to another page
      if (closingCurrentPage) {
        const remainingPages = this.getUserPages();
        if (remainingPages.length > 0) {
          this.page = remainingPages[0];
          this.setupPageListeners();
        } else {
          this.page = null;
        }
      }

      return { success: true, data: { closedIndex: targetIndex } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Close page failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Execute arbitrary Playwright code
   * 
   * The code can access: page, context, browser
   * Returns the result of the code execution in data field
   */
  async runCode(code: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      console.log('[BrowserAdapter] Executing code:', code);
      
      // Check if code contains explicit return statement
      const hasReturn = /\breturn\s/.test(code);
      // Check if code is a single expression (no semicolons except at end, no newlines with statements)
      const isSingleExpression = !hasReturn && !/;\s*\S/.test(code.trim());
      
      // Wrap code appropriately:
      // - Single expression: add return to get the value
      // - Multi-statement with return: use as-is
      // - Multi-statement without return: execute and return undefined
      let wrappedCode = code;
      if (isSingleExpression) {
        // Single expression - return its value
        wrappedCode = `return ${code.trim().replace(/;$/, '')}`;
      }
      
      const asyncFunction = new Function('page', 'context', 'browser', `
        return (async () => {
          ${wrappedCode}
        })();
      `);

      const result = await asyncFunction(this.page, this.context, this.browser);

      this.emit('operation', {
        id: genOpId(),
        type: 'code',
        code,
        timestamp: new Date().toISOString()
      });

      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Code execution failed';
      console.error('[BrowserAdapter] Code execution error:', error);
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Build selector strategies from a selector string
   */
  private buildSelectorStrategies(selector: string): Array<{ locator: string; strategy: SelectorStrategy; selectorValue: string }> {
    const strategies: Array<{ locator: string; strategy: SelectorStrategy; selectorValue: string }> = [];

    // Check if it looks like a valid CSS selector (tags, ids, classes, attributes, combinators)
    const isCssLike = /^[a-z][a-z0-9]*$|^[#.\[]|[>:\s]/.test(selector);
    
    if (isCssLike) {
      // Try as CSS selector first
      strategies.push({ locator: selector, strategy: 'css', selectorValue: selector });
    }

    // Try as text selector
    strategies.push({ 
      locator: `text="${selector}"`, 
      strategy: 'text', 
      selectorValue: `text="${selector}"` 
    });

    // Try as testid
    strategies.push({ 
      locator: `[data-testid="${selector}"]`, 
      strategy: 'testid', 
      selectorValue: `[data-testid="${selector}"]` 
    });

    // Try as role with name
    strategies.push({ 
      locator: `role=button[name="${selector}"]`, 
      strategy: 'role', 
      selectorValue: `role=button[name="${selector}"]` 
    });

    // Try as placeholder
    strategies.push({ 
      locator: `[placeholder="${selector}"]`, 
      strategy: 'placeholder', 
      selectorValue: `[placeholder="${selector}"]` 
    });

    // Try as label
    strategies.push({ 
      locator: `label=${selector}`, 
      strategy: 'label', 
      selectorValue: `label=${selector}` 
    });

    // Fallback: if not already CSS, try treating it as CSS selector anyway
    if (!isCssLike) {
      strategies.push({ locator: selector, strategy: 'css', selectorValue: selector });
    }

    return strategies;
  }

  /**
   * Setup page event listeners
   */
  private setupPageListeners(): void {
    if (!this.page) return;

    this.page.on('load', () => {
      this.emit('pageLoad', { url: this.page?.url() });
    });

    this.page.on('console', (msg) => {
      this.emit('console', { type: msg.type(), text: msg.text() });
    });

    this.page.on('dialog', async (dialog) => {
      this.emit('dialog', { type: dialog.type(), message: dialog.message() });
      await dialog.accept();
    });

    this.context?.on('page', (newPage) => {
      this.emit('newPage', { url: newPage.url() });
      this.page = newPage;
      this.setupPageListeners();
    });
  }

  /**
   * Get the current page instance (for advanced operations)
   */
  getPage(): Page | null {
    return this.page;
  }

  /**
   * Set the current page instance directly (for testing/advanced operations)
   * This is useful when creating pages externally and wanting to use them with the adapter
   */
  setPage(page: Page): void {
    this.page = page;
  }
}

