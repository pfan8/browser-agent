/**
 * Playwright Browser Adapter (Simplified)
 * 
 * Implementation of IBrowserAdapter using Playwright CDP connection.
 * Only exposes runCode - all browser operations are done via code.
 */

import { chromium, Browser, BrowserContext } from 'playwright';
import { EventEmitter } from 'events';
import type { 
  IBrowserAdapter, 
  CodeExecutionResult, 
  BrowserStatus, 
  BrowserAdapterConfig,
} from './types';
import { DEFAULT_BROWSER_ADAPTER_CONFIG } from './types';
import { createBrowserLogger, startOperationTimer } from './logger';

// Create module logger
const log = createBrowserLogger('PlaywrightAdapter');

function genOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export class PlaywrightAdapter extends EventEmitter implements IBrowserAdapter {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
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
  async connect(cdpUrl?: string): Promise<CodeExecutionResult> {
    if (cdpUrl) {
      this.cdpUrl = cdpUrl;
    }

    try {
      const timer = startOperationTimer();
      log.info('Connecting to browser', { cdpUrl: this.cdpUrl });
      
      this.browser = await chromium.connectOverCDP(this.cdpUrl, {
        timeout: this.config.defaultTimeout
      });

      // Listen for browser disconnect event
      this.browser.on('disconnected', () => {
        this.handleDisconnection('Browser disconnected');
      });

      // Get existing contexts or create new one
      const contexts = this.browser.contexts();
      if (contexts.length > 0) {
        this.context = contexts[0];
      } else {
        this.context = await this.browser.newContext();
      }

      // Setup context-level event listeners
      this.setupContextListeners();
      
      // Setup connection health check
      this.startConnectionHealthCheck();
      
      // Clear any previous connection errors
      this.lastConnectionError = null;

      // Get first non-internal page URL for logging
      const pages = this.context.pages().filter(p => !this.isInternalPage(p.url()));
      const url = pages[0]?.url() || 'about:blank';

      const duration = timer.end();
      log.infoWithDuration('Connected to browser successfully', duration, { url });
      this.emit('connected', { url });

      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastConnectionError = errorMessage;
      log.error('Failed to connect', { error: errorMessage, cdpUrl: this.cdpUrl });
      this.emit('connectionError', { error: errorMessage, canRetry: true });
      return { success: false, error: errorMessage };
    }
  }
  
  /**
   * Start connection health check interval
   */
  private isHealthCheckDisconnecting = false;

  private startConnectionHealthCheck(): void {
    this.stopConnectionHealthCheck();
    this.isHealthCheckDisconnecting = false;
    
    this.connectionCheckInterval = setInterval(() => {
      // Use browser.isConnected() instead of page.evaluate()
      if (!this.browser || !this.browser.isConnected()) {
        this.handleDisconnection('Connection lost');
      }
    }, this.config.healthCheckInterval);
  }

  /**
   * Handle disconnection from browser
   */
  private handleDisconnection(reason: string): void {
    if (this.isHealthCheckDisconnecting) return;
    this.isHealthCheckDisconnecting = true;
    
    log.error('Browser disconnected', { reason });
    
    this.stopConnectionHealthCheck();
    this.lastConnectionError = reason;
    
    this.emit('connectionLost', { 
      error: reason,
      canReconnect: true,
      cdpUrl: this.cdpUrl
    });
    
    this.browser = null;
    this.context = null;
    
    this.emit('disconnected', { reason: 'connection_lost', error: reason });
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
      this.emit('disconnected', { reason: 'user_disconnect' });
      log.info('Disconnected from browser');
    }
  }
  
  /**
   * Reconnect to browser
   */
  async reconnect(): Promise<CodeExecutionResult> {
    log.info('Attempting to reconnect', { cdpUrl: this.cdpUrl });
    this.emit('reconnecting', { cdpUrl: this.cdpUrl });
    
    this.stopConnectionHealthCheck();
    this.browser = null;
    this.context = null;
    
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
    return { connected: this.isConnected() };
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.browser !== null && this.browser.isConnected();
  }

  /**
   * Execute arbitrary Playwright code
   * 
   * The code can access: context, browser, state
   * - context: Playwright BrowserContext
   * - browser: Playwright Browser
   * - state: Persistent state object for storing variables across executions
   * 
   * Code should manage pages via context.pages() or context.newPage()
   * 
   * Code can be:
   * 1. A simple expression: await context.pages()[0].goto('...')
   * 2. A function body with return: const page = context.pages()[0]; return { url: page.url() }
   * 3. An async function definition: async function execute(context, browser, state) { ... }
   * 
   * @param code - The Playwright code to execute
   * @param variables - Optional state object that persists across executions within a session
   */
  async runCode(
    code: string, 
    variables: Record<string, unknown> = {}
  ): Promise<CodeExecutionResult> {
    if (!this.context) {
      return { success: false, error: 'Browser not connected' };
    }

    const logs: string[] = [];
    // Create a copy of variables to avoid mutating the original
    const state: Record<string, unknown> = { ...variables };
    
    try {
      log.info('Executing code', { codeLength: code.length, stateKeys: Object.keys(state) });
      log.debug('Code content', { code });
      
      // Check if code is a function definition
      const isFunctionDef = /^\s*(async\s+)?function\s+\w+\s*\(/.test(code);
      
      let result: unknown;
      
      if (isFunctionDef) {
        // Code is a function definition - execute it and call the function
        const asyncFunction = new Function('context', 'browser', 'state', `
          return (async () => {
            ${code}
            // Call the defined function
            const funcName = ${JSON.stringify(code)}.match(/function\\s+(\\w+)/)[1];
            return await eval(funcName)(context, browser, state);
          })();
        `);
        result = await asyncFunction(this.context, this.browser, state);
      } else {
        // Check if code contains explicit return statement
        const hasReturn = /\breturn\s/.test(code);
        // Check if code is a single expression
        const isSingleExpression = !hasReturn && !/;\s*\S/.test(code.trim());
        
        let wrappedCode = code;
        if (isSingleExpression) {
          // Single expression - return its value
          wrappedCode = `return ${code.trim().replace(/;$/, '')}`;
        }
        
        const asyncFunction = new Function('context', 'browser', 'state', `
          return (async () => {
            ${wrappedCode}
          })();
        `);
        result = await asyncFunction(this.context, this.browser, state);
      }

      this.emit('operation', {
        id: genOpId(),
        type: 'code',
        codeLength: code.length,
        timestamp: new Date().toISOString()
      });

      // Get current page URL and title
      const { pageUrl, pageTitle } = await this.getCurrentPageInfo();

      return { 
        success: true, 
        result, 
        logs,
        updatedVariables: state,
        pageUrl,
        pageTitle,
      };
    } catch (error) {
      // Extract detailed error info for self-repair
      const errorInfo = this.extractErrorInfo(error, code);
      log.error('Code execution error', { 
        error: errorInfo.message,
        errorType: errorInfo.type,
        errorLine: errorInfo.line,
      });
      
      // Get current page URL and title even on error
      const { pageUrl, pageTitle } = await this.getCurrentPageInfo();
      
      return { 
        success: false, 
        error: errorInfo.message, 
        logs,
        stackTrace: errorInfo.stackTrace,
        errorType: errorInfo.type,
        errorLine: errorInfo.line,
        updatedVariables: state,
        pageUrl,
        pageTitle,
      };
    }
  }

  /**
   * Get current page URL and title
   */
  private async getCurrentPageInfo(): Promise<{ pageUrl?: string; pageTitle?: string }> {
    try {
      if (!this.context) {
        return {};
      }
      const pages = this.context.pages().filter(p => !this.isInternalPage(p.url()));
      if (pages.length === 0) {
        return {};
      }
      const activePage = pages[0];
      return {
        pageUrl: activePage.url(),
        pageTitle: await activePage.title(),
      };
    } catch {
      return {};
    }
  }

  /**
   * Extract detailed error information for CodeAct self-repair
   */
  private extractErrorInfo(error: unknown, code: string): {
    message: string;
    type: string;
    stackTrace: string;
    line?: number;
  } {
    if (error instanceof Error) {
      // Try to extract line number from stack trace
      // The async wrapper adds ~3 lines, so we adjust
      const lineMatch = error.stack?.match(/<anonymous>:(\d+):\d+/);
      let line: number | undefined;
      if (lineMatch) {
        const rawLine = parseInt(lineMatch[1], 10);
        // Adjust for wrapper code (async IIFE adds ~3 lines)
        line = Math.max(1, rawLine - 3);
      }
      
      // Clean up stack trace to be more readable
      const stackTrace = error.stack || '';
      
      return {
        message: error.message,
        type: error.constructor.name,
        stackTrace,
        line,
      };
    }
    
    return {
      message: String(error),
      type: 'UnknownError',
      stackTrace: '',
    };
  }

  /**
   * Setup context-level event listeners
   */
  private setupContextListeners(): void {
    if (!this.context) return;

    // Listen for new pages being created
    this.context.on('page', (newPage) => {
      this.emit('newPage', { url: newPage.url() });
      
      // Setup page-level events for each new page
      newPage.on('load', () => {
        this.emit('pageLoad', { url: newPage.url() });
      });
      
      newPage.on('dialog', async (dialog) => {
        this.emit('dialog', { type: dialog.type(), message: dialog.message() });
        await dialog.accept();
      });
    });

    // Setup events for existing pages
    for (const page of this.context.pages()) {
      page.on('load', () => {
        this.emit('pageLoad', { url: page.url() });
      });
      
      page.on('dialog', async (dialog) => {
        this.emit('dialog', { type: dialog.type(), message: dialog.message() });
        await dialog.accept();
      });
    }
  }

  /**
   * Get all browser contexts
   */
  getContexts(): BrowserContext[] {
    return this.browser?.contexts() ?? [];
  }

  /**
   * Get the current context index
   */
  getCurrentContextIndex(): number {
    if (!this.context) return -1;
    const contexts = this.getContexts();
    return contexts.indexOf(this.context);
  }

  /**
   * Switch to a specific context by index
   */
  async switchContext(index: number): Promise<CodeExecutionResult> {
    const contexts = this.getContexts();
    if (index < 0 || index >= contexts.length) {
      return { success: false, error: 'Invalid context index' };
    }
    this.context = contexts[index];
    this.setupContextListeners();
    log.info('Switched to context', { index });
    return { success: true };
  }

  /**
   * Get information about all contexts
   */
  async getContextsInfo(): Promise<Array<{ index: number; pageCount: number; isActive: boolean }>> {
    const contexts = this.getContexts();
    return contexts.map((ctx, index) => ({
      index,
      pageCount: ctx.pages().filter(p => !this.isInternalPage(p.url())).length,
      isActive: ctx === this.context,
    }));
  }

  /**
   * Get the current context instance (for advanced operations)
   */
  getContext(): BrowserContext | null {
    return this.context;
  }

  /**
   * Get the current browser instance (for advanced operations)
   */
  getBrowser(): Browser | null {
    return this.browser;
  }
}
