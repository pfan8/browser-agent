/**
 * Agent Core Package
 * 
 * LangGraph-based browser automation agent.
 * Uses a two-layer architecture:
 * - Planner: High-level task planning (doesn't know Playwright)
 * - CodeAct: Code generation and execution (knows Playwright API)
 */

// State types and utilities
export * from './state';

// Graph and agent
export { createAgentGraph, BrowserAgent, type AgentGraphConfig } from './graph';

// Planner module
export { 
  createPlannerNode,
  type PlannerNodeConfig,
  type PlanStep,
  type Plan,
  type PlannerDecision,
  type PlannerObservation,
  type PlannerHistoryEntry,
} from './planner';

// CodeAct module
export {
  createCodeActNode,
  type CodeActNodeConfig,
  type CodeAction,
  type CodeResult,
  type CodeActDecision,
  type CodeActConfig,
  type ExecutionMode,
} from './codeact';

// Checkpointer
export { createCheckpointer, defaultCheckpointer, type CheckpointerConfig, type CheckpointerType } from './checkpointer';

// Configuration
export { 
  loadLLMConfig, 
  getConfigPath, 
  clearConfigCache, 
  createSampleConfig,
  DEFAULT_LLM_CONFIG,
  type LLMConfig,
  type LLMProvider,
} from './config';

// Tracing
export {
  type TraceContext,
  type SpanEvent,
  type CompletedSpan,
  type LogLevel,
  type LogLayer,
  type StructuredLogEntry,
  type AgentLoggerConfig,
  type ModuleAgentLogger,
  type OperationTimer,
  type LangSmithConfig,
  generateTraceId,
  generateSpanId,
  createTraceContext,
  createChildSpan,
  completeSpan,
  createSpanEvent,
  extractTraceHeaders,
  parseTraceHeaders,
  formatTraceContext,
  configureAgentLogger,
  setTraceContext,
  getTraceContext,
  createAgentLogger,
  startTimer,
  // LangSmith
  getLangSmithConfig,
  isLangSmithEnabled,
  initLangSmith,
  getLangSmithEnvVars,
  LANGSMITH_SETUP_INSTRUCTIONS,
} from './tracing';
