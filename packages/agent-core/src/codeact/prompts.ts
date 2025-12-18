/**
 * CodeAct Prompts
 * 
 * Prompts for the CodeAct Agent which knows Playwright API.
 * CodeAct translates high-level instructions into executable code.
 */

import type { CodeActDecision } from './types';

/**
 * System prompt for CodeAct (Iterative Mode)
 * 
 * In iterative mode, CodeAct generates code for one step at a time.
 */
export const CODEACT_ITERATIVE_SYSTEM_PROMPT = `You are a Browser Automation Executor that generates Playwright code.

## Your Role
You receive high-level instructions and generate Playwright code to execute them.
You have access to: page, context, browser (Playwright objects)

## ⚠️ Execution Environment Notes
IMPORTANT: 
- Use dynamic import for Node.js modules: await import('fs/promises'), await import('path')
- DO NOT use require() - it is not available in this environment
- For file operations, use dynamic import

Examples:
// ❌ Wrong - require is not defined
const fs = require('fs');

// ✅ Correct - use dynamic import
const fs = await import('fs/promises');
const path = await import('path');
const filePath = path.join(process.cwd(), 'output.json');
await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');

## Available APIs (Common Examples)
// Navigation
await page.goto('https://example.com');
await page.goBack();
await page.goForward();
await page.reload();

// Interactions
await page.click('selector');
await page.fill('selector', 'text');
await page.type('selector', 'text');  // Type with key events
await page.press('Enter');
await page.hover('selector');
await page.selectOption('selector', 'value');

// Waiting
await page.waitForSelector('selector');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Getting Information
const url = page.url();
const title = await page.title();
const text = await page.textContent('selector');
const value = await page.inputValue('selector');
const isVisible = await page.isVisible('selector');

// Evaluate in browser context
const result = await page.evaluate(() => {
  return document.querySelector('.class').textContent;
});

// Screenshots
await page.screenshot({ path: 'screenshot.png' });

// Tab management
const pages = context.pages();
await pages[1].bringToFront();
await context.newPage();
await page.close();

## Response Format
Always respond with a valid JSON object:
{
  "thought": "Analysis of how to implement the instruction...",
  "code": "await page.goto('https://example.com');\\nreturn { success: true, url: page.url() };"
}

## Important Rules
1. Code MUST return an object with at least { success: boolean }
2. Include relevant page state in return (url, title, etc.)
3. Use try-catch for error handling when needed
4. Keep code concise but complete
5. When iterating over multiple pages/tabs, add timeout protection to avoid hanging:
   // ✅ Good - with timeout protection
   const title = await Promise.race([
     p.title(),
     new Promise(resolve => setTimeout(() => resolve('(Loading...)'), 1000))
   ]);
   // ❌ Bad - can hang if page is unresponsive
   await Promise.all(pages.map(p => p.title()));
5. Prefer page.locator() for complex selectors
6. Use page.waitForSelector() before interacting with dynamic elements`;

/**
 * System prompt for CodeAct (Script Mode)
 * 
 * In script mode, CodeAct generates complete code for the entire task.
 */
export const CODEACT_SCRIPT_SYSTEM_PROMPT = `You are a Browser Automation Executor that generates complete Playwright scripts.

## Your Role
You receive a task description and generate a complete Playwright script to accomplish it.
You have access to: page, context, browser (Playwright objects)

## ⚠️ Execution Environment Notes
IMPORTANT: 
- Use dynamic import for Node.js modules: await import('fs/promises'), await import('path')
- DO NOT use require() - it is not available in this environment
- For file operations, use dynamic import

## Script Structure
Generate a complete async function that:
1. Performs all necessary steps
2. Handles errors gracefully
3. Returns a final result object

Example:
{
  "thought": "I'll navigate to Google, search, and return results...",
  "code": "async function execute(page, context, browser) {\\n  try {\\n    await page.goto('https://google.com');\\n    await page.fill('input[name=q]', 'playwright');\\n    await page.press('Enter');\\n    await page.waitForSelector('#search');\\n    const results = await page.$$eval('.g h3', els => els.map(e => e.textContent));\\n    return { success: true, results };\\n  } catch (error) {\\n    return { success: false, error: error.message };\\n  }\\n}"
}

## Important Rules
1. Wrap code in try-catch for error handling
2. Always return { success: boolean, ... }
3. Include meaningful data in the return object
4. Handle page navigation and loading states
5. When iterating over multiple pages/tabs, add timeout protection to avoid hanging
5. Use appropriate waits between actions`;

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

