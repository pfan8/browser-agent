/**
 * Playwright Browser Adapter (Simplified)
 * 
 * Implementation of IBrowserAdapter using Playwright CDP connection.
 * Only exposes runCode - all browser operations are done via code.
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
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

      const duration = timer.end();
      log.infoWithDuration('Connected to browser successfully', duration, { 
        url: this.page.url() 
      });
      this.emit('connected', { url: this.page.url() });

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
          log.warn('Connection health check failed', { 
            attempt: this.healthCheckFailCount, 
            maxAttempts: PlaywrightAdapter.MAX_HEALTH_CHECK_FAILURES,
            error: errorMessage,
          });
          
          // Only disconnect after multiple consecutive failures
          if (this.healthCheckFailCount < PlaywrightAdapter.MAX_HEALTH_CHECK_FAILURES) {
            return;
          }
        }
        
        // Prevent multiple disconnection attempts
        if (this.isHealthCheckDisconnecting) return;
        this.isHealthCheckDisconnecting = true;
        
        log.error('Connection health check failed permanently', { error: errorMessage });
        
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
   * Execute arbitrary Playwright code
   * 
   * The code can access: page, context, browser
   * Returns the result of the code execution
   * 
   * Code can be:
   * 1. A simple expression: await page.goto('...')
   * 2. A function body with return: await page.goto('...'); return { url: page.url() }
   * 3. An async function definition: async function execute(page) { ... }
   */
  async runCode(code: string): Promise<CodeExecutionResult> {
    if (!this.page) {
      return { success: false, error: 'Browser not connected' };
    }

    const logs: string[] = [];
    
    // Capture page state before execution for debugging
    const pageUrl = this.page.url();
    let pageTitle = '';
    try { pageTitle = await this.page.title(); } catch { /* ignore */ }
    
    try {
      log.info('Executing code', { codeLength: code.length });
      log.debug('Code content', { code });
      
      // Capture console logs during execution
      const consoleHandler = (msg: { type: () => string; text: () => string }) => {
        logs.push(`[${msg.type()}] ${msg.text()}`);
      };
      this.page.on('console', consoleHandler);
      
      try {
        // Check if code is a function definition
        const isFunctionDef = /^\s*(async\s+)?function\s+\w+\s*\(/.test(code);
        
        let result: unknown;
        
        if (isFunctionDef) {
          // Code is a function definition - execute it and call the function
          const asyncFunction = new Function('page', 'context', 'browser', `
            return (async () => {
              ${code}
              // Call the defined function
              const funcName = ${JSON.stringify(code)}.match(/function\\s+(\\w+)/)[1];
              return await eval(funcName)(page, context, browser);
            })();
          `);
          result = await asyncFunction(this.page, this.context, this.browser);
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
          
          const asyncFunction = new Function('page', 'context', 'browser', `
            return (async () => {
              ${wrappedCode}
            })();
          `);
          result = await asyncFunction(this.page, this.context, this.browser);
        }

        this.emit('operation', {
          id: genOpId(),
          type: 'code',
          codeLength: code.length,
          timestamp: new Date().toISOString()
        });

        return { success: true, result, logs, pageUrl, pageTitle };
      } finally {
        this.page.off('console', consoleHandler);
      }
    } catch (error) {
      // Extract detailed error info for self-repair
      const errorInfo = this.extractErrorInfo(error, code);
      log.error('Code execution error', { 
        error: errorInfo.message,
        errorType: errorInfo.type,
        errorLine: errorInfo.line,
      });
      
      return { 
        success: false, 
        error: errorInfo.message, 
        logs,
        stackTrace: errorInfo.stackTrace,
        errorType: errorInfo.type,
        errorLine: errorInfo.line,
        pageUrl,
        pageTitle,
      };
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
   * Setup page event listeners
   */
  private setupPageListeners(): void {
    if (!this.page) return;

    this.page.on('load', () => {
      this.emit('pageLoad', { url: this.page?.url() });
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
