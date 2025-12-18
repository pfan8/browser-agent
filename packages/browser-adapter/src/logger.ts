/**
 * Browser Adapter Logger
 * 
 * Simple structured logger for the browser-adapter package.
 * Outputs logs in a format compatible with the agent-core tracing system.
 */

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log entry for external handlers
 */
export interface BrowserLogEntry {
  timestamp: string;
  level: LogLevel;
  layer: 'browser';
  module: string;
  message: string;
  duration?: number;
  data?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
export interface BrowserLoggerConfig {
  level: LogLevel;
  consoleOutput: boolean;
  /** Custom handler for routing logs to external systems */
  customHandler?: (entry: BrowserLogEntry) => void;
}

// ============================================
// Constants
// ============================================

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const DEFAULT_CONFIG: BrowserLoggerConfig = {
  level: 'info',
  consoleOutput: true,
};

// ============================================
// Global State
// ============================================

let config: BrowserLoggerConfig = { ...DEFAULT_CONFIG };

// ============================================
// Configuration
// ============================================

/**
 * Configure the browser logger
 */
export function configureBrowserLogger(newConfig: Partial<BrowserLoggerConfig>): void {
  config = { ...config, ...newConfig };
}

// ============================================
// Formatting
// ============================================

/**
 * Format a log entry
 */
function formatLogEntry(
  level: LogLevel,
  module: string,
  message: string,
  data?: Record<string, unknown>,
  duration?: number
): string {
  const timestamp = new Date().toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  
  let line = `${timestamp} ${levelStr} [browser:${module}] ${message}`;
  
  if (duration !== undefined) {
    line += ` (${duration}ms)`;
  }
  
  if (data && Object.keys(data).length > 0) {
    line += ` ${JSON.stringify(data)}`;
  }
  
  return line;
}

// ============================================
// Core Logging
// ============================================

/**
 * Write a log entry
 */
function writeLog(
  level: LogLevel,
  module: string,
  message: string,
  data?: Record<string, unknown>,
  duration?: number
): void {
  // Check log level threshold
  if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) {
    return;
  }
  
  // Output to console if enabled
  if (config.consoleOutput) {
    const formatted = formatLogEntry(level, module, message, data, duration);
    const consoleMethod = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : console.log;
    consoleMethod(formatted);
  }
  
  // Call custom handler if configured
  if (config.customHandler) {
    const entry: BrowserLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      layer: 'browser',
      module,
      message,
      duration,
      data,
    };
    config.customHandler(entry);
  }
}

// ============================================
// Module Logger
// ============================================

/**
 * Logger instance for a specific module
 */
export interface BrowserModuleLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  
  /** Log with duration measurement */
  infoWithDuration(message: string, duration: number, data?: Record<string, unknown>): void;
}

/**
 * Create a logger for a specific module
 */
export function createBrowserLogger(module: string): BrowserModuleLogger {
  return {
    debug: (message, data) => writeLog('debug', module, message, data),
    info: (message, data) => writeLog('info', module, message, data),
    warn: (message, data) => writeLog('warn', module, message, data),
    error: (message, data) => writeLog('error', module, message, data),
    
    infoWithDuration: (message, duration, data) => 
      writeLog('info', module, message, data, duration),
  };
}

// ============================================
// Timer Utility
// ============================================

export interface OperationTimer {
  /** End the timer and return duration */
  end(): number;
}

/**
 * Start a timer for an operation
 */
export function startOperationTimer(): OperationTimer {
  const startTime = Date.now();
  
  return {
    end: () => Date.now() - startTime,
  };
}

