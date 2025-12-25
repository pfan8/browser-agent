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

