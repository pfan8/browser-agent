/**
 * Browser Controller - Manages browser connection and operations via CDP
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { EventEmitter } from 'events';
import type { 
  NavigateOperation, 
  ClickOperation, 
  TypeOperation,
  ScreenshotOperation,
  WaitOperation,
  HoverOperation,
  SelectOperation,
  PressOperation,
  SelectorStrategy
} from '../dsl/types';

// Re-export for use without circular dependency
function genOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export interface BrowserStatus {
  connected: boolean;
  url?: string;
  title?: string;
}

export interface OperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

export class BrowserController extends EventEmitter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdpUrl: string = 'http://localhost:9222';
  private connectionCheckInterval: NodeJS.Timeout | null = null;
  private lastConnectionError: string | null = null;

  constructor() {
    super();
  }

  /**
   * Get the last connection error (BC-06)
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
   * Connect to a browser via CDP
   */
  async connect(cdpUrl?: string): Promise<OperationResult> {
    if (cdpUrl) {
      this.cdpUrl = cdpUrl;
    }

    try {
      console.log(`Connecting to browser at ${this.cdpUrl}...`);
      
      this.browser = await chromium.connectOverCDP(this.cdpUrl, {
        timeout: 30000
      });

      // Get existing contexts or create new one
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        this.context = await this.browser.newContext();
      }

      // Get existing page or create new one
      const pages = this.context.pages();
      if (pages.length > 0) {
        this.page = pages[0];
      } else {
        this.page = await this.context.newPage();
      }

      // Setup event listeners
      this.setupPageListeners();
      
      // Setup connection health check (BC-06)
      this.startConnectionHealthCheck();
      
      // Clear any previous connection errors
      this.lastConnectionError = null;

      console.log('Connected to browser successfully');
      this.emit('connected', { url: this.page.url() });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastConnectionError = errorMessage;
      console.error('Failed to connect to browser:', errorMessage);
      this.emit('connectionError', { error: errorMessage, canRetry: true });
      return { success: false, error: errorMessage };
    }
  }
  
  /**
   * Start connection health check interval (BC-06)
   */
  private startConnectionHealthCheck(): void {
    // Stop any existing interval
    this.stopConnectionHealthCheck();
    
    // Check connection every 5 seconds
    this.connectionCheckInterval = setInterval(async () => {
      if (!this.browser || !this.page) return;
      
      try {
        // Try to get page URL to verify connection is alive
        await this.page.evaluate(() => document.readyState);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Connection lost';
        console.error('Connection health check failed:', errorMessage);
        this.lastConnectionError = errorMessage;
        
        // Emit disconnected event with error info
        this.emit('connectionLost', { 
          error: errorMessage,
          canReconnect: true,
          cdpUrl: this.cdpUrl
        });
        
        // Clean up
        this.browser = null;
        this.context = null;
        this.page = null;
        this.stopConnectionHealthCheck();
        
        this.emit('disconnected', { reason: 'connection_lost', error: errorMessage });
      }
    }, 5000);
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
    // Stop health check
    this.stopConnectionHealthCheck();
    
    if (this.browser) {
      // Don't close the browser, just disconnect
      this.browser = null;
      this.context = null;
      this.page = null;
      this.emit('disconnected', { reason: 'user_disconnect' });
      console.log('Disconnected from browser');
    }
  }
  
  /**
   * Reconnect to browser (BC-06)
   * Attempts to reconnect using the last known CDP URL
   */
  async reconnect(): Promise<OperationResult> {
    console.log(`Attempting to reconnect to ${this.cdpUrl}...`);
    this.emit('reconnecting', { cdpUrl: this.cdpUrl });
    
    // Clean up existing connection
    this.stopConnectionHealthCheck();
    this.browser = null;
    this.context = null;
    this.page = null;
    
    // Try to connect again
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
   * Navigate to a URL
   */
  async navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' = 'networkidle'): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      // Ensure URL has protocol
      let fullUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        fullUrl = `https://${url}`;
      }

      await this.page.goto(fullUrl, { waitUntil, timeout: 30000 });

      const operation: NavigateOperation = {
        id: genOpId(),
        type: 'navigate',
        url: fullUrl,
        waitUntil,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true, data: { url: fullUrl } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Navigation failed';
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
      // Try multiple selector strategies
      const strategies = this.buildSelectorStrategies(selector);
      let lastError: string = '';

      for (const { locator, strategy, selectorValue } of strategies) {
        try {
          const element = this.page.locator(locator);
          if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
            await element.click({ timeout: 5000 });

            const operation: ClickOperation = {
              id: genOpId(),
              type: 'click',
              selector: selectorValue,
              selectorStrategy: strategy,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            };

            this.emit('operation', operation);
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
          if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
            if (clear) {
              await element.fill(text, { timeout: 5000 });
            } else {
              await element.type(text, { timeout: 5000 });
            }

            const operation: TypeOperation = {
              id: genOpId(),
              type: 'type',
              selector: selectorValue,
              selectorStrategy: strategy,
              text,
              clear,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            };

            this.emit('operation', operation);
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
   * Take a screenshot
   */
  async screenshot(name?: string, fullPage: boolean = true): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      const filename = name || `screenshot_${Date.now()}`;
      const path = `./recordings/${filename}.png`;
      
      await this.page.screenshot({ path, fullPage });

      const operation: ScreenshotOperation = {
        id: genOpId(),
        type: 'screenshot',
        name: filename,
        fullPage,
        path,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true, data: { path } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Screenshot failed';
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

      const operation: WaitOperation = {
        id: genOpId(),
        type: 'wait',
        duration: ms,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
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
      await this.page.waitForSelector(selector, { state, timeout: 30000 });

      const operation: WaitOperation = {
        id: genOpId(),
        type: 'wait',
        selector,
        state,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Wait for selector failed';
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
          if (await element.isVisible({ timeout: 2000 }).catch(() => false)) {
            await element.hover({ timeout: 5000 });

            const operation: HoverOperation = {
              id: genOpId(),
              type: 'hover',
              selector: selectorValue,
              selectorStrategy: strategy,
              alternatives: strategies.map(s => s.selectorValue).filter(s => s !== selectorValue),
              timestamp: new Date().toISOString()
            };

            this.emit('operation', operation);
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

      const operation: SelectOperation = {
        id: genOpId(),
        type: 'select',
        selector,
        selectorStrategy: 'css',
        value,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Select failed';
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

      const operation: PressOperation = {
        id: genOpId(),
        type: 'press',
        key,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Press failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Get current page info
   */
  async getPageInfo(): Promise<{ url: string; title: string }> {
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
   * Evaluate JavaScript to find selectors for an element description
   */
  async evaluateSelector(description: string): Promise<{ selector: string; alternatives: string[] }> {
    if (!this.page) {
      return { selector: '', alternatives: [] };
    }

    try {
      // Use page.evaluate to find elements matching the description
      const result = await this.page.evaluate((desc: string) => {
        const descLower = desc.toLowerCase();
        const selectors: string[] = [];

        // Find by text content
        const allElements = document.querySelectorAll('button, a, input, [role="button"], [data-testid]');
        
        for (const el of allElements) {
          const text = (el.textContent || '').trim().toLowerCase();
          const testId = el.getAttribute('data-testid');
          const ariaLabel = el.getAttribute('aria-label');
          const placeholder = el.getAttribute('placeholder');
          const id = el.id;
          const name = el.getAttribute('name');

          // Match by text
          if (text && text.includes(descLower)) {
            if (testId) {
              selectors.push(`[data-testid="${testId}"]`);
            }
            if (id) {
              selectors.push(`#${id}`);
            }
            const tagName = el.tagName.toLowerCase();
            selectors.push(`${tagName}:has-text("${el.textContent?.trim().slice(0, 50)}")`);
          }

          // Match by aria-label
          if (ariaLabel && ariaLabel.toLowerCase().includes(descLower)) {
            selectors.push(`[aria-label="${ariaLabel}"]`);
          }

          // Match by placeholder
          if (placeholder && placeholder.toLowerCase().includes(descLower)) {
            selectors.push(`[placeholder="${placeholder}"]`);
          }

          // Match by testid containing description
          if (testId && testId.toLowerCase().includes(descLower)) {
            selectors.push(`[data-testid="${testId}"]`);
          }

          // Match by name
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
   * Build selector strategies from a selector string
   */
  private buildSelectorStrategies(selector: string): Array<{ locator: string; strategy: SelectorStrategy; selectorValue: string }> {
    const strategies: Array<{ locator: string; strategy: SelectorStrategy; selectorValue: string }> = [];

    // If it's already a valid CSS selector (starts with #, ., [ or contains : or >)
    if (/^[#.\[]|[>:\s]/.test(selector)) {
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
      // Auto-accept dialogs for now
      await dialog.accept();
    });

    // Listen for new pages (popups)
    this.context?.on('page', (newPage) => {
      this.emit('newPage', { url: newPage.url() });
      // Optionally switch to new page
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
   * Check if connected
   */
  isConnected(): boolean {
    return this.browser !== null && this.page !== null;
  }

  /**
   * List all open pages/tabs
   */
  async listPages(): Promise<{ index: number; url: string; title: string; active: boolean }[]> {
    if (!this.context) {
      console.log('listPages: no context');
      return [];
    }

    const pages = this.context.pages();
    console.log(`listPages: found ${pages.length} pages`);
    const result = [];

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        const url = page.url();
        // Use Promise.race to add timeout for title fetching
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
          index: i,
          url,
          title,
          active: page === this.page
        });
      } catch (e) {
        console.log(`listPages: error getting page ${i}:`, e);
        result.push({
          index: i,
          url: 'unknown',
          title: 'Unknown',
          active: page === this.page
        });
      }
    }

    console.log('listPages: returning', result);
    return result;
  }

  /**
   * Switch to a different page/tab by index
   */
  async switchToPage(index: number): Promise<OperationResult> {
    if (!this.context) {
      return { success: false, error: 'Browser not connected' };
    }

    const pages = this.context.pages();
    
    if (index < 0 || index >= pages.length) {
      return { success: false, error: `Invalid page index: ${index}. Available: 0-${pages.length - 1}` };
    }

    this.page = pages[index];
    this.setupPageListeners();

    try {
      const title = await this.page.title();
      const url = this.page.url();
      return { 
        success: true, 
        data: { index, url, title } 
      };
    } catch {
      return { success: true, data: { index } };
    }
  }
  /**
   * Execute arbitrary Playwright code
   */
  async runCode(code: string): Promise<OperationResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    try {
      console.log('Executing code:', code);
      
      // Wrap code in an async function and execute
      // Provide page, context, browser as arguments
      const asyncFunction = new Function('page', 'context', 'browser', `
        return (async () => {
          try {
            ${code}
          } catch (e) {
            throw e;
          }
        })();
      `);

      await asyncFunction(this.page, this.context, this.browser);

      const operation: any = {
        id: genOpId(),
        type: 'code',
        code,
        timestamp: new Date().toISOString()
      };

      this.emit('operation', operation);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Code execution failed';
      console.error('Code execution error:', error);
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance
export const browserController = new BrowserController();

