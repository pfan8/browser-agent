/**
 * Tracing Module
 * 
 * Exports all tracing utilities for distributed tracing and
 * structured logging across the agent system.
 */

// Trace Context
export {
  type TraceContext,
  type SpanEvent,
  type CompletedSpan,
  generateTraceId,
  generateSpanId,
  createTraceContext,
  createChildSpan,
  completeSpan,
  createSpanEvent,
  extractTraceHeaders,
  parseTraceHeaders,
  formatTraceContext,
} from './trace-context';

// Agent Logger
export {
  type LogLevel,
  type LogLayer,
  type StructuredLogEntry,
  type AgentLoggerConfig,
  type ModuleAgentLogger,
  type OperationTimer,
  configureAgentLogger,
  setTraceContext,
  getTraceContext,
  createAgentLogger,
  startTimer,
} from './agent-logger';

// LangSmith Integration (Optional)
export {
  type LangSmithConfig,
  getLangSmithConfig,
  isLangSmithEnabled,
  initLangSmith,
  getLangSmithEnvVars,
  LANGSMITH_SETUP_INSTRUCTIONS,
} from './langsmith';

