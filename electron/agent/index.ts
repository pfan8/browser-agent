/**
 * Agent Module Exports
 * 
 * Main entry point for the hierarchical agent system.
 * 
 * Architecture:
 * - ReactAgent: ReAct-style execution with CodeAct integration (recommended)
 * - Plan-Execute: Legacy high-level planner + low-level executor
 */

// Core
export { AgentCore, getAgentCore, resetAgentCore } from './agent-core';
export type { AgentCoreConfig, ExecutionMode } from './agent-core';

// ReAct Agent (new)
export { ReactAgent, createReactAgent } from './react-agent';
export type { ReactAgentConfig } from './react-agent';

// CodeAct (new)
export { CodeExecutor, codeExecutor, createCodeExecutor } from './tools/code-executor';

// Gating Logic (new)
export { 
  GatingLogic, 
  gatingLogic, 
  createGatingLogic,
  isDataExtractionTask,
  isComplexLogicTask,
  isBatchOperationTask,
  isScriptGenerationTask,
} from './gating-logic';

// Planner (legacy)
export { HighLevelPlanner } from './high-level-planner';
export type { PlannerConfig, PlannerLLMAdapter } from './high-level-planner';

// Executor (legacy)
export { LowLevelExecutor } from './low-level-executor';
export type { ExecutorConfig, LLMAdapter } from './low-level-executor';

// Memory
export { MemoryManager, memoryManager } from './memory/memory-manager';

// Checkpoint
export { CheckpointManager, checkpointManager } from './checkpoint/checkpoint-manager';
export { SessionStore, sessionStore } from './checkpoint/session-store';
export type { SessionListItem } from './checkpoint/session-store';

// Tools
export { ToolRegistry, toolRegistry } from './tools/tool-registry';
export { registerBrowserTools, BROWSER_TOOL_DEFINITIONS } from './tools/browser-tools';

// Types
export * from './types';

