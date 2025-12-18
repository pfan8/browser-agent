/**
 * Logger Utility
 * 
 * A centralized logging utility that:
 * - Writes logs to files in the logs/ directory
 * - Supports multiple log levels (debug, info, warn, error)
 * - Includes timestamps and module prefixes
 * - Supports trace context for distributed tracing
 * - Also outputs to console for development
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogLayer = 'electron' | 'agent' | 'browser';

/**
 * Trace context for distributed tracing
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

/**
 * Structured log entry for analysis
 */
export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  layer: LogLayer;
  module: string;
  traceId?: string;
  spanId?: string;
  message: string;
  duration?: number;
  data?: Record<string, unknown>;
}

export interface LoggerConfig {
  /** Log level threshold - logs below this level won't be written */
  level: LogLevel;
  /** Layer identifier for this logger */
  layer: LogLayer;
  /** Whether to also output to console */
  consoleOutput: boolean;
  /** Max file size in bytes before rotation (default: 10MB) */
  maxFileSize: number;
  /** Max number of rotated files to keep */
  maxFiles: number;
  /** Use structured JSON format for file output */
  structuredOutput: boolean;
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

const DEFAULT_CONFIG: LoggerConfig = {
  level: 'debug',
  layer: 'electron',
  consoleOutput: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
  structuredOutput: false,
};

// ============================================
// Logger Class
// ============================================

class Logger {
  private config: LoggerConfig;
  private logsDir: string;
  private currentLogFile: string;
  private writeStream: fs.WriteStream | null = null;
  private initialized: boolean = false;

  constructor(config: Partial<LoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Get app path - use process.cwd() as fallback for non-packaged app
    let appPath: string;
    try {
      appPath = app?.getAppPath() || process.cwd();
    } catch {
      appPath = process.cwd();
    }
    
    // Navigate to project root if we're in a subdirectory
    if (appPath.includes('dist-electron') || appPath.includes('node_modules')) {
      appPath = path.resolve(appPath, '..');
    }
    
    this.logsDir = path.join(appPath, 'logs');
    this.currentLogFile = this.getLogFileName();
  }

  /**
   * Initialize the logger - creates logs directory if needed
   */
  private init(): void {
    if (this.initialized) return;

    try {
      // Create logs directory if it doesn't exist
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }

      // Open write stream
      this.openWriteStream();
      this.initialized = true;
    } catch (error) {
      console.error('[Logger] Failed to initialize:', error);
    }
  }

  /**
   * Generate log file name with date
   */
  private getLogFileName(): string {
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    return path.join(this.logsDir, `agent-${date}.log`);
  }

  /**
   * Open write stream to log file
   */
  private openWriteStream(): void {
    const logFile = this.getLogFileName();
    
    // Check if date changed (new day)
    if (logFile !== this.currentLogFile) {
      this.closeWriteStream();
      this.currentLogFile = logFile;
    }

    if (!this.writeStream || this.writeStream.closed) {
      this.writeStream = fs.createWriteStream(this.currentLogFile, { flags: 'a' });
      
      this.writeStream.on('error', (error) => {
        console.error('[Logger] Write stream error:', error);
        this.writeStream = null;
      });
    }
  }

  /**
   * Close write stream
   */
  private closeWriteStream(): void {
    if (this.writeStream) {
      this.writeStream.end();
      this.writeStream = null;
    }
  }

  /**
   * Check and rotate log file if needed
   */
  private async checkRotation(): Promise<void> {
    try {
      const stats = fs.statSync(this.currentLogFile);
      
      if (stats.size >= this.config.maxFileSize) {
        this.closeWriteStream();
        
        // Rotate files
        for (let i = this.config.maxFiles - 1; i >= 1; i--) {
          const oldFile = `${this.currentLogFile}.${i}`;
          const newFile = `${this.currentLogFile}.${i + 1}`;
          
          if (fs.existsSync(oldFile)) {
            if (i === this.config.maxFiles - 1) {
              fs.unlinkSync(oldFile);
            } else {
              fs.renameSync(oldFile, newFile);
            }
          }
        }
        
        // Rename current file
        fs.renameSync(this.currentLogFile, `${this.currentLogFile}.1`);
        
        // Reopen stream
        this.openWriteStream();
      }
    } catch {
      // File might not exist yet, that's fine
    }
  }

  /**
   * Format log message (legacy format)
   */
  private formatMessage(
    level: LogLevel, 
    module: string, 
    message: string, 
    data?: unknown,
    traceContext?: TraceContext,
    duration?: number
  ): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const moduleStr = module ? `[${module}]` : '';
    
    let logLine = `${timestamp} ${levelStr} ${moduleStr}`;
    
    // Add trace context if available
    if (traceContext?.traceId) {
      logLine += ` traceId=${traceContext.traceId}`;
    }
    if (traceContext?.spanId) {
      logLine += ` spanId=${traceContext.spanId}`;
    }
    
    logLine += ` ${message}`;
    
    // Add duration if available
    if (duration !== undefined) {
      logLine += ` (${duration}ms)`;
    }
    
    if (data !== undefined) {
      try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data);
        logLine += ` ${dataStr}`;
      } catch {
        logLine += ` [Unable to stringify data]`;
      }
    }
    
    return logLine;
  }

  /**
   * Format as structured JSON entry
   */
  private formatStructured(
    level: LogLevel,
    module: string,
    message: string,
    data?: unknown,
    traceContext?: TraceContext,
    duration?: number
  ): string {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      layer: this.config.layer,
      module,
      message,
    };
    
    if (traceContext?.traceId) {
      entry.traceId = traceContext.traceId;
    }
    if (traceContext?.spanId) {
      entry.spanId = traceContext.spanId;
    }
    if (duration !== undefined) {
      entry.duration = duration;
    }
    if (data !== undefined && data !== null) {
      entry.data = typeof data === 'object' 
        ? data as Record<string, unknown> 
        : { value: data };
    }
    
    return JSON.stringify(entry);
  }

  /**
   * Write log entry
   */
  private write(
    level: LogLevel, 
    module: string, 
    message: string, 
    data?: unknown,
    traceContext?: TraceContext,
    duration?: number
  ): void {
    // Check log level threshold
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    // Initialize if needed
    if (!this.initialized) {
      this.init();
    }

    const formattedMessage = this.config.structuredOutput
      ? this.formatStructured(level, module, message, data, traceContext, duration)
      : this.formatMessage(level, module, message, data, traceContext, duration);

    // Write to console if enabled
    if (this.config.consoleOutput) {
      const consoleMethod = level === 'error' ? console.error 
        : level === 'warn' ? console.warn 
        : console.log;
      
      // Format for console
      const modulePrefix = module ? `[${module}]` : '';
      let consoleMsg = modulePrefix;
      
      if (traceContext?.traceId) {
        consoleMsg += ` [${traceContext.traceId}]`;
      }
      
      consoleMsg += ` ${message}`;
      
      if (duration !== undefined) {
        consoleMsg += ` (${duration}ms)`;
      }
      
      if (data !== undefined) {
        consoleMethod(consoleMsg, data);
      } else {
        consoleMethod(consoleMsg);
      }
    }

    // Write to file
    try {
      this.openWriteStream();
      if (this.writeStream) {
        this.writeStream.write(formattedMessage + '\n');
      }
      
      // Check rotation periodically
      this.checkRotation();
    } catch (error) {
      console.error('[Logger] Failed to write log:', error);
    }
  }

  /**
   * Create a child logger with a module prefix
   */
  createLogger(module: string): ModuleLogger {
    return new ModuleLogger(this, module);
  }

  // Public log methods (legacy without trace context)
  debug(module: string, message: string, data?: unknown): void {
    this.write('debug', module, message, data);
  }

  info(module: string, message: string, data?: unknown): void {
    this.write('info', module, message, data);
  }

  warn(module: string, message: string, data?: unknown): void {
    this.write('warn', module, message, data);
  }

  error(module: string, message: string, data?: unknown): void {
    this.write('error', module, message, data);
  }

  // Public log methods with trace context
  debugWithTrace(
    module: string, 
    message: string, 
    traceContext: TraceContext, 
    data?: unknown
  ): void {
    this.write('debug', module, message, data, traceContext);
  }

  infoWithTrace(
    module: string, 
    message: string, 
    traceContext: TraceContext, 
    data?: unknown,
    duration?: number
  ): void {
    this.write('info', module, message, data, traceContext, duration);
  }

  warnWithTrace(
    module: string, 
    message: string, 
    traceContext: TraceContext, 
    data?: unknown
  ): void {
    this.write('warn', module, message, data, traceContext);
  }

  errorWithTrace(
    module: string, 
    message: string, 
    traceContext: TraceContext, 
    data?: unknown
  ): void {
    this.write('error', module, message, data, traceContext);
  }

  /**
   * Update logger configuration
   */
  updateConfig(config: Partial<LoggerConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get logs directory path
   */
  getLogsDir(): string {
    return this.logsDir;
  }

  /**
   * Flush and close the logger
   */
  close(): void {
    this.closeWriteStream();
    this.initialized = false;
  }
}

// ============================================
// Module Logger (Child Logger)
// ============================================

class ModuleLogger {
  private parent: Logger;
  private module: string;
  private currentTraceContext: TraceContext | null = null;

  constructor(parent: Logger, module: string) {
    this.parent = parent;
    this.module = module;
  }

  /**
   * Set trace context for subsequent logs
   */
  setTraceContext(context: TraceContext | null): void {
    this.currentTraceContext = context;
  }

  /**
   * Get current trace context
   */
  getTraceContext(): TraceContext | null {
    return this.currentTraceContext;
  }

  debug(message: string, data?: unknown): void {
    if (this.currentTraceContext) {
      this.parent.debugWithTrace(this.module, message, this.currentTraceContext, data);
    } else {
      this.parent.debug(this.module, message, data);
    }
  }

  info(message: string, data?: unknown): void {
    if (this.currentTraceContext) {
      this.parent.infoWithTrace(this.module, message, this.currentTraceContext, data);
    } else {
      this.parent.info(this.module, message, data);
    }
  }

  warn(message: string, data?: unknown): void {
    if (this.currentTraceContext) {
      this.parent.warnWithTrace(this.module, message, this.currentTraceContext, data);
    } else {
      this.parent.warn(this.module, message, data);
    }
  }

  error(message: string, data?: unknown): void {
    if (this.currentTraceContext) {
      this.parent.errorWithTrace(this.module, message, this.currentTraceContext, data);
    } else {
      this.parent.error(this.module, message, data);
    }
  }

  // Methods with explicit trace context
  debugWithTrace(message: string, traceContext: TraceContext, data?: unknown): void {
    this.parent.debugWithTrace(this.module, message, traceContext, data);
  }

  infoWithTrace(
    message: string, 
    traceContext: TraceContext, 
    data?: unknown, 
    duration?: number
  ): void {
    this.parent.infoWithTrace(this.module, message, traceContext, data, duration);
  }

  warnWithTrace(message: string, traceContext: TraceContext, data?: unknown): void {
    this.parent.warnWithTrace(this.module, message, traceContext, data);
  }

  errorWithTrace(message: string, traceContext: TraceContext, data?: unknown): void {
    this.parent.errorWithTrace(this.module, message, traceContext, data);
  }

  /**
   * Log with duration measurement
   */
  infoWithDuration(message: string, duration: number, data?: unknown): void {
    if (this.currentTraceContext) {
      this.parent.infoWithTrace(this.module, message, this.currentTraceContext, data, duration);
    } else {
      // Fall back to regular info with duration in message
      const msgWithDuration = `${message} (${duration}ms)`;
      this.parent.info(this.module, msgWithDuration, data);
    }
  }

  /**
   * Create a sub-logger with additional prefix
   */
  child(subModule: string): ModuleLogger {
    const child = new ModuleLogger(this.parent, `${this.module}:${subModule}`);
    child.setTraceContext(this.currentTraceContext);
    return child;
  }
}

// ============================================
// Timer Utility
// ============================================

export interface OperationTimer {
  /** End the timer and log the result */
  end(message?: string, data?: unknown): number;
  /** End the timer without logging */
  endSilent(): number;
}

/**
 * Start a timer for an operation
 */
export function startTimer(
  logger: ModuleLogger,
  operationName: string,
  traceContext?: TraceContext
): OperationTimer {
  const startTime = Date.now();
  
  return {
    end: (message, data) => {
      const duration = Date.now() - startTime;
      const msg = message || `${operationName} completed`;
      if (traceContext) {
        logger.infoWithTrace(msg, traceContext, data, duration);
      } else {
        logger.infoWithDuration(msg, duration, data);
      }
      return duration;
    },
    endSilent: () => Date.now() - startTime,
  };
}

// ============================================
// Singleton Export
// ============================================

// Global logger instance
export const logger = new Logger();

// Factory function to create module-specific loggers
export function createLogger(module: string): ModuleLogger {
  return logger.createLogger(module);
}

// Export types
export { ModuleLogger };
export default logger;
