/**
 * Browser Adapter Types
 * 
 * Defines the interface for browser control operations.
 * This abstraction allows testing without Electron and
 * swapping implementations (e.g., Playwright, Puppeteer).
 */

/**
 * Result of a browser operation
 */
export interface OperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
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
 * Page information
 */
export interface PageInfo {
  url: string;
  title: string;
}

/**
 * Element information for observations
 */
export interface ElementInfo {
  selector: string;
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isInteractable: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

/**
 * Page/tab information
 */
export interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

/**
 * Selector strategy used for element location
 */
export type SelectorStrategy = 
  | 'css' 
  | 'xpath' 
  | 'text' 
  | 'testid' 
  | 'role' 
  | 'placeholder' 
  | 'label';

/**
 * Browser Adapter Interface
 * 
 * Provides a unified API for browser control operations.
 * Implementations can use Playwright, Puppeteer, or other tools.
 */
export interface IBrowserAdapter {
  // Connection
  connect(cdpUrl: string): Promise<OperationResult>;
  disconnect(): Promise<void>;
  reconnect(): Promise<OperationResult>;
  isConnected(): boolean;
  getStatus(): Promise<BrowserStatus>;
  getCdpUrl(): string;
  getLastConnectionError(): string | null;
  
  // Navigation
  navigate(url: string, waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit'): Promise<OperationResult>;
  goBack(): Promise<OperationResult>;
  goForward(): Promise<OperationResult>;
  
  // Interactions
  click(selector: string): Promise<OperationResult>;
  type(selector: string, text: string, clear?: boolean): Promise<OperationResult>;
  press(key: string): Promise<OperationResult>;
  hover(selector: string): Promise<OperationResult>;
  select(selector: string, value: string): Promise<OperationResult>;
  
  // Wait operations
  wait(ms: number): Promise<OperationResult>;
  waitForSelector(selector: string, state?: 'attached' | 'visible' | 'hidden'): Promise<OperationResult>;
  
  // Observation
  screenshot(name?: string, fullPage?: boolean): Promise<OperationResult>;
  getPageInfo(): Promise<PageInfo>;
  getPageContent(): Promise<string>;
  evaluateSelector(description: string): Promise<{ selector: string; alternatives: string[] }>;
  
  // Tab management
  listPages(): Promise<TabInfo[]>;
  switchToPage(index: number): Promise<OperationResult>;
  closePage(index?: number): Promise<OperationResult>;
  
  // Code execution
  runCode(code: string): Promise<OperationResult>;
  
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

