/**
 * Logger Utility
 * 
 * A centralized logging utility that:
 * - Writes logs to files in the logs/ directory
 * - Supports multiple log levels (debug, info, warn, error)
 * - Includes timestamps and module prefixes
 * - Also outputs to console for development
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerConfig {
  /** Log level threshold - logs below this level won't be written */
  level: LogLevel;
  /** Whether to also output to console */
  consoleOutput: boolean;
  /** Max file size in bytes before rotation (default: 10MB) */
  maxFileSize: number;
  /** Max number of rotated files to keep */
  maxFiles: number;
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
  consoleOutput: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5,
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
   * Format log message
   */
  private formatMessage(level: LogLevel, module: string, message: string, data?: unknown): string {
    const timestamp = new Date().toISOString();
    const levelStr = level.toUpperCase().padEnd(5);
    const moduleStr = module ? `[${module}]` : '';
    
    let logLine = `${timestamp} ${levelStr} ${moduleStr} ${message}`;
    
    if (data !== undefined) {
      try {
        const dataStr = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
        logLine += `\n${dataStr}`;
      } catch {
        logLine += `\n[Unable to stringify data]`;
      }
    }
    
    return logLine;
  }

  /**
   * Write log entry
   */
  private write(level: LogLevel, module: string, message: string, data?: unknown): void {
    // Check log level threshold
    if (LOG_LEVELS[level] < LOG_LEVELS[this.config.level]) {
      return;
    }

    // Initialize if needed
    if (!this.initialized) {
      this.init();
    }

    const formattedMessage = this.formatMessage(level, module, message, data);

    // Write to console if enabled
    if (this.config.consoleOutput) {
      const consoleMethod = level === 'error' ? console.error 
        : level === 'warn' ? console.warn 
        : console.log;
      
      // Format for console with color
      const modulePrefix = module ? `[${module}]` : '';
      if (data !== undefined) {
        consoleMethod(`${modulePrefix} ${message}`, data);
      } else {
        consoleMethod(`${modulePrefix} ${message}`);
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

  // Public log methods
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

  constructor(parent: Logger, module: string) {
    this.parent = parent;
    this.module = module;
  }

  debug(message: string, data?: unknown): void {
    this.parent.debug(this.module, message, data);
  }

  info(message: string, data?: unknown): void {
    this.parent.info(this.module, message, data);
  }

  warn(message: string, data?: unknown): void {
    this.parent.warn(this.module, message, data);
  }

  error(message: string, data?: unknown): void {
    this.parent.error(this.module, message, data);
  }

  /**
   * Create a sub-logger with additional prefix
   */
  child(subModule: string): ModuleLogger {
    return new ModuleLogger(this.parent, `${this.module}:${subModule}`);
  }
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

