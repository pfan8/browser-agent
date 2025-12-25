/**
 * CodeAct Module
 * 
 * Exports for the CodeAct ReAct Agent which generates and executes Playwright code.
 */

export * from './types';
export { 
  // Legacy prompts (kept for backwards compatibility)
  CODEACT_ITERATIVE_SYSTEM_PROMPT,
  CODEACT_SCRIPT_SYSTEM_PROMPT,
  buildCodeActUserMessage,
  parseCodeActResponse,
  type PreviousAttempt,
  // ReAct prompts
  CODEACT_REACT_SYSTEM_PROMPT,
  buildReActUserMessage,
  parseToolCall,
  type ToolHistoryEntry,
  type ParsedToolCall,
} from './prompts';
export { createCodeActNode, type CodeActNodeConfig } from './codeact-node';

// Export tools
export {
  runCode,
  summarizeResult,
  summarizeResultTool,
  fetchData,
  type ToolResult,
  type ToolCall,
  type SummarizeConfig,
  type FetchDataTarget,
  type FetchDataArgs,
  type RunCodeArgs,
  DEFAULT_SUMMARIZE_CONFIG,
} from './tools';

