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
  
  // Page state after execution
  pageUrl?: string;       // Current page URL
  pageTitle?: string;     // Current page title
  
  // CodeAct state management - updated variables after execution
  updatedVariables?: Record<string, unknown>;
}

/**
 * Context information for UI display
 */
export interface ContextInfo {
  index: number;
  pageCount: number;
  isActive: boolean;
}

/**
 * Browser connection status
 */
export interface BrowserStatus {
  connected: boolean;
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
  // Code has access to: context, browser, state (Playwright objects + persistent state)
  // variables: Optional state object that persists across executions within a session
  runCode(code: string, variables?: Record<string, unknown>): Promise<CodeExecutionResult>;
  
  // Context management
  getContextsInfo(): Promise<ContextInfo[]>;
  switchContext(index: number): Promise<CodeExecutionResult>;
  
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
