/**
 * Agent Logger
 * 
 * Structured logger for the agent-core package.
 * Supports trace context for distributed tracing.
 * 
 * Logs are output to console with structured format that can be
 * parsed and correlated by traceId across all layers.
 */

import { TraceContext } from './trace-context';

// ============================================
// Types
// ============================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogLayer = 'electron' | 'agent' | 'browser';

/**
 * Structured log entry
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

/**
 * Logger configuration
 */
export interface AgentLoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Layer identifier */
  layer: LogLayer;
  /** Whether to output to console */
  consoleOutput: boolean;
  /** Custom log handler for integration with external systems */
  customHandler?: (entry: StructuredLogEntry) => void;
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

const DEFAULT_CONFIG: AgentLoggerConfig = {
  level: 'debug',
  layer: 'agent',
  consoleOutput: true,
};

// ============================================
// Global State
// ============================================

// Use global object to share state across module instances
// This ensures configuration works even if module is loaded from different paths
declare global {
  // eslint-disable-next-line no-var
  var __agentLoggerConfig: AgentLoggerConfig | undefined;
  // eslint-disable-next-line no-var
  var __agentTraceContext: TraceContext | null | undefined;
}

function getGlobalConfig(): AgentLoggerConfig {
  if (!globalThis.__agentLoggerConfig) {
    globalThis.__agentLoggerConfig = { ...DEFAULT_CONFIG };
  }
  return globalThis.__agentLoggerConfig;
}

function getCurrentTraceContext(): TraceContext | null {
  return globalThis.__agentTraceContext ?? null;
}

// ============================================
// Configuration
// ============================================

/**
 * Configure the agent logger
 * Uses global state to ensure configuration works across module instances
 */
export function configureAgentLogger(config: Partial<AgentLoggerConfig>): void {
  const currentConfig = getGlobalConfig();
  globalThis.__agentLoggerConfig = { ...currentConfig, ...config };
}

/**
 * Set the current trace context for all subsequent logs
 */
export function setTraceContext(context: TraceContext | null): void {
  globalThis.__agentTraceContext = context;
}

/**
 * Get the current trace context
 */
export function getTraceContext(): TraceContext | null {
  return getCurrentTraceContext();
}

// ============================================
// Formatting
// ============================================

/**
 * Format a log entry as a string for console output
 */
function formatLogEntry(entry: StructuredLogEntry): string {
  const levelStr = entry.level.toUpperCase().padEnd(5);
  const moduleStr = `[${entry.layer}:${entry.module}]`;
  
  let line = `${entry.timestamp} ${levelStr} ${moduleStr}`;
  
  if (entry.traceId) {
    line += ` traceId=${entry.traceId}`;
  }
  if (entry.spanId) {
    line += ` spanId=${entry.spanId}`;
  }
  
  line += ` ${entry.message}`;
  
  if (entry.duration !== undefined) {
    line += ` (${entry.duration}ms)`;
  }
  
  if (entry.data && Object.keys(entry.data).length > 0) {
    line += ` ${JSON.stringify(entry.data)}`;
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
  traceContext?: TraceContext | null,
  duration?: number
): void {
  const config = getGlobalConfig();
  
  // Check log level threshold
  if (LOG_LEVELS[level] < LOG_LEVELS[config.level]) {
    return;
  }
  
  const context = traceContext ?? getCurrentTraceContext();
  
  const entry: StructuredLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    layer: config.layer,
    module,
    traceId: context?.traceId,
    spanId: context?.spanId,
    message,
    duration,
    data,
  };
  
  // Output to console
  if (config.consoleOutput) {
    const formatted = formatLogEntry(entry);
    const consoleMethod = level === 'error' ? console.error
      : level === 'warn' ? console.warn
      : console.log;
    consoleMethod(formatted);
  }
  
  // Call custom handler if configured
  if (config.customHandler) {
    config.customHandler(entry);
  }
}

// ============================================
// Module Logger
// ============================================

/**
 * Logger instance for a specific module
 */
export interface ModuleAgentLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  
  /** Log with explicit trace context */
  debugWithTrace(ctx: TraceContext, message: string, data?: Record<string, unknown>): void;
  infoWithTrace(ctx: TraceContext, message: string, data?: Record<string, unknown>): void;
  warnWithTrace(ctx: TraceContext, message: string, data?: Record<string, unknown>): void;
  errorWithTrace(ctx: TraceContext, message: string, data?: Record<string, unknown>): void;
  
  /** Log with duration measurement */
  infoWithDuration(
    message: string, 
    duration: number, 
    data?: Record<string, unknown>
  ): void;
  
  /** Create a child logger with additional module prefix */
  child(subModule: string): ModuleAgentLogger;
}

/**
 * Create a logger for a specific module
 */
export function createAgentLogger(module: string): ModuleAgentLogger {
  return {
    debug: (message, data) => writeLog('debug', module, message, data),
    info: (message, data) => writeLog('info', module, message, data),
    warn: (message, data) => writeLog('warn', module, message, data),
    error: (message, data) => writeLog('error', module, message, data),
    
    debugWithTrace: (ctx, message, data) => writeLog('debug', module, message, data, ctx),
    infoWithTrace: (ctx, message, data) => writeLog('info', module, message, data, ctx),
    warnWithTrace: (ctx, message, data) => writeLog('warn', module, message, data, ctx),
    errorWithTrace: (ctx, message, data) => writeLog('error', module, message, data, ctx),
    
    infoWithDuration: (message, duration, data) => 
      writeLog('info', module, message, data, null, duration),
    
    child: (subModule) => createAgentLogger(`${module}:${subModule}`),
  };
}

// ============================================
// Performance Timing
// ============================================

/**
 * Timer for measuring operation duration
 */
export interface OperationTimer {
  /** End the timer and log the result */
  end(message?: string, data?: Record<string, unknown>): number;
  /** End the timer without logging */
  endSilent(): number;
}

/**
 * Start a timer for an operation
 */
export function startTimer(
  logger: ModuleAgentLogger,
  operationName: string,
  traceContext?: TraceContext
): OperationTimer {
  const startTime = Date.now();
  
  return {
    end: (message, data) => {
      const duration = Date.now() - startTime;
      const msg = message || `${operationName} completed`;
      if (traceContext) {
        logger.infoWithTrace(traceContext, msg, { ...data, duration });
      } else {
        logger.infoWithDuration(msg, duration, data);
      }
      return duration;
    },
    endSilent: () => Date.now() - startTime,
  };
}

