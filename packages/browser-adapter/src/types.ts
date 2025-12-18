/**
 * Browser Adapter Types
 * 
 * Simplified interface for browser control - only runCode method.
 * CodeAct Agent generates all browser operations as code.
 */

/**
 * Result of code execution
 */
export interface CodeExecutionResult {
  success: boolean;
  result?: unknown;       // Code return value
  error?: string;         // Error message
  logs?: string[];        // Console output captured during execution
  
  // Enhanced debugging info for self-repair
  stackTrace?: string;    // Full stack trace when error occurs
  errorType?: string;     // Error type (SyntaxError, TimeoutError, etc.)
  errorLine?: number;     // Line number where error occurred in the code
  pageUrl?: string;       // Page URL at execution time
  pageTitle?: string;     // Page title at execution time
}

/**
 * Browser connection status
 */
export interface BrowserStatus {
  connected: boolean;
  url?: string;
  title?: string;
}

/**
 * Browser Adapter Interface (Simplified)
 * 
 * Only exposes runCode - all browser operations are done via code.
 * This enables the CodeAct pattern where agents generate Playwright code.
 */
export interface IBrowserAdapter {
  // Connection management
  connect(cdpUrl: string): Promise<CodeExecutionResult>;
  disconnect(): Promise<void>;
  reconnect(): Promise<CodeExecutionResult>;
  isConnected(): boolean;
  getStatus(): Promise<BrowserStatus>;
  getCdpUrl(): string;
  getLastConnectionError(): string | null;
  
  // Code execution - THE core method
  // Code has access to: page, context, browser (Playwright objects)
  runCode(code: string): Promise<CodeExecutionResult>;
  
  // Events
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

/**
 * Browser adapter configuration
 */
export interface BrowserAdapterConfig {
  defaultTimeout?: number;
  screenshotPath?: string;
  healthCheckInterval?: number;
}

/**
 * Default configuration
 */
export const DEFAULT_BROWSER_ADAPTER_CONFIG: BrowserAdapterConfig = {
  defaultTimeout: 30000,
  screenshotPath: './recordings',
  healthCheckInterval: 5000,
};
