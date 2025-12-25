/**
 * CodeAct Tools Types
 *
 * Type definitions for CodeAct ReAct agent tools.
 */

/**
 * Result returned by a tool execution
 */
export interface ToolResult {
  /** Whether the tool execution succeeded */
  success: boolean;
  /** Result data (if successful) */
  data?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Human-readable summary for LLM */
  summary: string;
}

/**
 * Tool call request from LLM
 */
export interface ToolCall {
  /** Tool name: 'runCode' | 'summarizeResult' | 'fetchData' | 'finish' */
  tool: string;
  /** Tool-specific arguments */
  args: Record<string, unknown>;
  /** LLM's reasoning for this tool call */
  thought?: string;
}

/**
 * Configuration for summarize tool
 */
export interface SummarizeConfig {
  /** Maximum depth for nested objects (default: 3) */
  maxDepth: number;
  /** Maximum array items to include (default: 5) */
  maxArrayItems: number;
  /** Maximum string length before truncation (default: 200) */
  maxStringLength: number;
  /** Maximum total output length (default: 2000) */
  maxTotalLength: number;
}

/**
 * Default summarize configuration
 */
export const DEFAULT_SUMMARIZE_CONFIG: SummarizeConfig = {
  maxDepth: 3,
  maxArrayItems: 5,
  maxStringLength: 200,
  maxTotalLength: 2000,
};

/**
 * FetchData request types
 */
export type FetchDataTarget =
  | 'all'           // Get all execution variables
  | 'keys'          // Get only variable names
  | 'single';       // Get a single variable by name

/**
 * FetchData arguments
 */
export interface FetchDataArgs {
  /** What to fetch: 'all' | 'keys' | 'single' */
  target: FetchDataTarget;
  /** Variable name (required when target is 'single') */
  name?: string;
}

/**
 * RunCode arguments
 */
export interface RunCodeArgs {
  /** Playwright code to execute */
  code: string;
}

