/**
 * Browser Adapter Package
 * 
 * Provides a unified interface for browser control operations.
 * Can be tested independently of Electron.
 */

export * from './types';
export { PlaywrightAdapter } from './playwright-adapter';

// Logger utilities
export { 
  createBrowserLogger, 
  configureBrowserLogger,
  startOperationTimer,
  type BrowserLoggerConfig,
  type BrowserLogEntry,
  type BrowserModuleLogger,
  type LogLevel,
} from './logger';

