/**
 * CodeAct Prompts
 * 
 * Prompts for the CodeAct Agent which knows Playwright API.
 * CodeAct translates high-level instructions into executable code.
 */

import type { CodeActDecision } from './types';

/**
 * System prompt for CodeAct (Iterative Mode)
 * Optimized for fewer tokens while maintaining essential guidance.
 */
export const CODEACT_ITERATIVE_SYSTEM_PROMPT = `You generate Playwright code to control a browser.

## Available Objects
- context: Playwright BrowserContext (connected via CDP)
- browser: Playwright Browser instance

## Response Format (JSON only)
{"thought": "reasoning about what to do", "code": "your playwright code here"}

## Rules
1. Return { success: boolean, ...data } from your code
2. Use try-catch for error handling
3. For file operations: const fs = await import('fs/promises')`;


/**
 * System prompt for CodeAct (Script Mode)
 * Optimized for fewer tokens.
 */
export const CODEACT_SCRIPT_SYSTEM_PROMPT = `Generate complete Playwright script to control a browser.

## Available Objects
- context: Playwright BrowserContext (connected via CDP)
- browser: Playwright Browser instance

## Structure
async function execute(context, browser) {
  try {
    // your implementation
    return { success: true, data: {...} };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

## Response Format (JSON only)
{"thought": "...", "code": "async function execute(context, browser) {...}"}`;

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
 */
export function buildCodeActUserMessage(params: {
  instruction: string;
  mode: 'iterative' | 'script';
  previousAttempt?: PreviousAttempt;
}): string {
  const { instruction, mode, previousAttempt } = params;

  let message = `## Instruction
${instruction}
`;

  // If retrying, include detailed error info for self-repair
  if (previousAttempt) {
    message += `
## ⚠️ Previous Attempt Failed - Please Fix

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

