/**
 * CodeAct Prompts
 * 
 * Prompts for the CodeAct Agent which knows Playwright API.
 * CodeAct translates high-level instructions into executable code.
 */

import type { CodeActDecision } from './types';
import type { VariableSummary } from '../state';

/**
 * System prompt for CodeAct (Iterative Mode)
 * Optimized for fewer tokens while maintaining essential guidance.
 */
export const CODEACT_ITERATIVE_SYSTEM_PROMPT = `You generate Playwright code to control a browser.

## Available Objects
- context: Playwright BrowserContext (connected via CDP)
- browser: Playwright Browser instance
- state: Persistent state object for storing variables across executions

## Variable Storage
You have access to a persistent \`state\` object for storing variables across executions:
- Store: \`state.myVar = value\`
- Read: \`const x = state.myVar\`
- Variables persist between code executions within the same session.
- Use state to store data needed for later steps (e.g., scraped items, extracted values).

## Page Management
Get pages from context.pages(). Choose the right page based on the task:
- If user says "current page" or doesn't specify: find the active tab by checking \`document.visibilityState === 'visible'\`
- If user specifies a target: find page by URL/title/index matching the target
- Create new page with context.newPage() if needed
- Never blindly use pages()[0] - always verify it's the correct page

## Selectors
Prefer text-based selectors since users describe elements by visible text:
- Use \`*:has-text("visible text")\` to find elements by content
- Fall back to CSS selectors only when text matching is ambiguous

## Response Format (JSON only)
{"thought": "reasoning about what to do", "code": "your playwright code here"}

## Rules
1. Return { success: boolean, ...data } from your code
2. Use try-catch for error handling
3. For file operations: const fs = await import('fs/promises')
4. Use state.xxx to store/retrieve data between steps`;


/**
 * System prompt for CodeAct (Script Mode)
 * Optimized for fewer tokens.
 */
export const CODEACT_SCRIPT_SYSTEM_PROMPT = `Generate complete Playwright script to control a browser.

## Available Objects
- context: Playwright BrowserContext (connected via CDP)
- browser: Playwright Browser instance
- state: Persistent state object for storing variables across executions

## Variable Storage
You have access to a persistent \`state\` object for storing variables across executions:
- Store: \`state.myVar = value\`
- Read: \`const x = state.myVar\`
- Variables persist between code executions within the same session.

## Page Management
Get pages from context.pages(). Choose the right page based on the task:
- If user says "current page" or doesn't specify: find the active tab by checking \`document.visibilityState === 'visible'\`
- If user specifies a target: find page by URL/title/index matching the target
- Create new page with context.newPage() if needed
- Never blindly use pages()[0] - always verify it's the correct page

## Selectors
Prefer text-based selectors since users describe elements by visible text:
- Use \`*:has-text("visible text")\` to find elements by content
- Fall back to CSS selectors only when text matching is ambiguous

## Structure
async function execute(context, browser, state) {
  try {
    // your implementation
    // use state.xxx to store/retrieve data
    return { success: true, data: {...} };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

## Response Format (JSON only)
{"thought": "...", "code": "async function execute(context, browser, state) {...}"}`;

/**
 * Previous attempt info for retry
 */
export interface PreviousAttempt {
  code: string;
  error: string;
  stackTrace?: string;
  errorType?: string;
  errorLine?: number;
  logs?: string[];
}

/**
 * Build user message for CodeAct
 * 
 * Note: CodeAct only needs the instruction from Planner.
 * It should NOT receive page state - its job is purely to translate
 * the instruction into Playwright code.
 * 
 * When retrying, it receives the previous failed code and error details
 * to help it self-repair.
 * 
 * Available variables are injected to inform LLM about state data.
 */
export function buildCodeActUserMessage(params: {
  instruction: string;
  mode: 'iterative' | 'script';
  previousAttempt?: PreviousAttempt;
  availableVariables?: VariableSummary[];
}): string {
  const { instruction, mode, previousAttempt, availableVariables } = params;

  let message = `## Instruction
${instruction}
`;

  // Inject available variables if any
  if (availableVariables && availableVariables.length > 0) {
    message += `
## Current Variables in state
${formatAvailableVariables(availableVariables)}
`;
  }

  // If retrying, include detailed error info for self-repair
  if (previousAttempt) {
    message += `
## Previous Attempt Failed - Please Fix

**Error Type:** ${previousAttempt.errorType || 'Unknown'}
**Error Message:** ${previousAttempt.error}
${previousAttempt.errorLine ? `**Error at Line:** ${previousAttempt.errorLine}` : ''}

**Failed Code:**
\`\`\`javascript
${previousAttempt.code}
\`\`\`
`;

    if (previousAttempt.stackTrace) {
      // Only include first few lines of stack trace
      const stackLines = previousAttempt.stackTrace.split('\n').slice(0, 5).join('\n');
      message += `
**Stack Trace:**
\`\`\`
${stackLines}
\`\`\`
`;
    }

    if (previousAttempt.logs && previousAttempt.logs.length > 0) {
      message += `
**Console Logs:**
${previousAttempt.logs.slice(-5).join('\n')}
`;
    }

    message += `
**Please analyze the error and generate fixed code.**
`;
  }

  if (mode === 'iterative') {
    message += `
Generate code for this single step. Return { success: boolean, ... } with relevant state.`;
  } else {
    message += `
Generate a complete script to accomplish the entire task. Handle all steps and errors.`;
  }

  return message;
}

/**
 * Format available variables for prompt injection
 */
function formatAvailableVariables(variables: VariableSummary[]): string {
  if (variables.length === 0) {
    return '(no variables stored yet)';
  }
  
  return variables
    .map(v => `- state.${v.name}: ${v.type} = ${v.preview}`)
    .join('\n');
}

/**
 * Parse code from CodeAct response
 * Handles various response formats
 */
export function parseCodeActResponse(response: string): CodeActDecision | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.code) {
      return null;
    }

    return {
      thought: parsed.thought || '',
      code: parsed.code,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// ReAct Agent Prompts and Parsing
// =============================================================================

/**
 * System prompt for CodeAct ReAct Agent
 * Guides LLM to select and call tools dynamically
 */
export const CODEACT_REACT_SYSTEM_PROMPT = `You are a browser automation agent that completes tasks by calling tools.

## CRITICAL: Response Format
**You MUST ALWAYS respond with a SINGLE JSON object. NEVER respond with plain text.**
**Every response MUST be valid JSON with a "tool" field.**

## Available Tools

### 1. runCode
Execute Playwright code to interact with the browser.
- context: Playwright BrowserContext (connected via CDP)
- browser: Playwright Browser instance
- state: Persistent state object for storing variables

**Usage:**
\`\`\`json
{"tool": "runCode", "args": {"code": "your playwright code"}, "thought": "why this code"}
\`\`\`

**Code Guidelines:**
- Get pages from context.pages()
- Use state.xxx to store/retrieve data between executions
- Return { success: boolean, ...data } from your code
- Prefer text-based selectors: \`*:has-text("text")\`

**IMPORTANT - Timeout Handling:**
- Most single operations should complete in <1s
- When iterating over multiple pages/elements, use Promise.race with timeout:
\`\`\`javascript
const result = await Promise.race([
  page.title(),
  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
]).catch(() => 'fallback');
\`\`\`
- Or use Playwright's built-in timeout: \`page.click(selector, { timeout: 5000 })\`
- Always handle potential timeouts to avoid blocking the entire execution

### 2. summarizeResult
Summarize a large result object for clearer understanding.
\`\`\`json
{"tool": "summarizeResult", "args": {"data": <object to summarize>}, "thought": "why summarize"}
\`\`\`

### 3. fetchData
Get data from execution state.
\`\`\`json
{"tool": "fetchData", "args": {"target": "all|keys|single", "name": "varName"}, "thought": "why fetch"}
\`\`\`
- target: "all" (all variables), "keys" (variable names only), "single" (one variable by name)

### 4. finish
**IMPORTANT: When the task is complete, you MUST call finish. Do NOT respond with plain text.**
\`\`\`json
{"tool": "finish", "args": {"result": "description of what was accomplished"}, "thought": "task complete"}
\`\`\`

## Response Format
**ONLY respond with a single JSON object. NO plain text. NO markdown. NO explanations outside JSON.**

Example valid responses:
- {"tool": "runCode", "args": {"code": "..."}, "thought": "..."}
- {"tool": "finish", "args": {"result": "Task completed successfully"}, "thought": "done"}

Example INVALID responses (DO NOT DO THIS):
- "I have completed the task..." (plain text)
- "Here is the result: {...}" (text before JSON)

## Rules
1. Think step by step about what action to take
2. Call runCode to execute browser operations
3. Use summarizeResult if results are too large to reason about
4. Use fetchData to inspect stored variables
5. Call finish when the task is complete - ALWAYS use finish tool, never plain text
6. If an operation fails, analyze the error and try a different approach`;

/**
 * Tool history entry for prompt context
 */
export interface ToolHistoryEntry {
  tool: string;
  args: unknown;
  success: boolean;
  summary: string;
}

/**
 * Build user message for ReAct agent
 */
export function buildReActUserMessage(params: {
  instruction: string;
  availableVariables?: VariableSummary[];
  toolHistory?: ToolHistoryEntry[];
}): string {
  const { instruction, availableVariables, toolHistory } = params;

  let message = `## Task
${instruction}

`;

  // Include available variables
  if (availableVariables && availableVariables.length > 0) {
    message += `## Current State Variables
${formatAvailableVariables(availableVariables)}

`;
  }

  // Include tool execution history
  if (toolHistory && toolHistory.length > 0) {
    message += `## Previous Tool Executions
${formatToolHistory(toolHistory)}

`;
  }

  message += `## Your Turn
Analyze the task and tool history. Decide which tool to call next, or call "finish" if the task is complete.
Respond with a single JSON object.`;

  return message;
}

/**
 * Format tool history for prompt
 */
function formatToolHistory(history: ToolHistoryEntry[]): string {
  return history
    .map((entry, i) => {
      const status = entry.success ? '✓' : '✗';
      const argsStr = typeof entry.args === 'string'
        ? entry.args.slice(0, 100)
        : JSON.stringify(entry.args).slice(0, 100);
      return `${i + 1}. [${status}] ${entry.tool}(${argsStr}...)
   Result: ${entry.summary.slice(0, 200)}`;
    })
    .join('\n\n');
}

/**
 * Parsed tool call from LLM response
 */
export interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
  thought?: string;
}

/**
 * Parse tool call from LLM response
 * Includes fallback detection for natural language completion signals
 */
export function parseToolCall(response: string): ParsedToolCall | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback: Check if LLM is signaling completion in natural language
      return detectNaturalLanguageCompletion(response);
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    if (!parsed.tool) {
      // JSON found but no tool field - check for completion signals
      return detectNaturalLanguageCompletion(response);
    }

    return {
      tool: parsed.tool,
      args: parsed.args || {},
      thought: parsed.thought,
    };
  } catch {
    // JSON parsing failed - check for completion signals in plain text
    return detectNaturalLanguageCompletion(response);
  }
}

/**
 * Detect if the LLM response indicates task completion in natural language
 * This is a fallback for when the LLM doesn't follow JSON format
 */
function detectNaturalLanguageCompletion(response: string): ParsedToolCall | null {
  const lowerResponse = response.toLowerCase();
  
  // Completion signal patterns (Chinese and English)
  const completionPatterns = [
    'task complete',
    'task completed',
    'successfully completed',
    'successfully finished',
    'i have completed',
    'i\'ve completed',
    'the task is done',
    'task is complete',
    'finished the task',
    'completed successfully',
    '任务完成',
    '已完成',
    '成功完成',
    '执行完成',
    '已成功',
  ];
  
  const isCompletion = completionPatterns.some(pattern => 
    lowerResponse.includes(pattern)
  );
  
  if (isCompletion) {
    // Extract a summary from the response (first 500 chars)
    const summary = response.trim().substring(0, 500);
    return {
      tool: 'finish',
      args: { result: summary },
      thought: 'Auto-detected completion from natural language response',
    };
  }
  
  return null;
}

