/**
 * RunCode Tool
 *
 * Executes Playwright code via the browser adapter.
 * This is the primary tool for browser automation.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { ToolResult, RunCodeArgs } from './types';
import { summarizeResult } from './summarize-result';

/**
 * Execute Playwright code and return the result
 *
 * @param browserAdapter - Browser adapter instance
 * @param args - Tool arguments containing the code to execute
 * @param variables - Current execution variables (state)
 * @param timeout - Execution timeout in milliseconds
 * @returns Tool result with execution outcome
 */
export async function runCode(
  browserAdapter: IBrowserAdapter,
  args: RunCodeArgs,
  variables: Record<string, unknown>,
  timeout: number
): Promise<ToolResult & { updatedVariables?: Record<string, unknown> }> {
  const { code } = args;

  if (!code || typeof code !== 'string') {
    return {
      success: false,
      error: 'Code argument is required and must be a string',
      summary: 'Error: No code provided',
    };
  }

  try {
    // Create timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Code execution timeout')), timeout);
    });

    // Execute code with race against timeout
    const execPromise = browserAdapter.runCode(code, variables);
    const result = await Promise.race([execPromise, timeoutPromise]);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Code execution failed',
        summary: `Execution failed: ${result.error}`,
        data: {
          stackTrace: result.stackTrace,
          errorType: result.errorType,
          errorLine: result.errorLine,
          logs: result.logs,
        },
        updatedVariables: result.updatedVariables,
      };
    }

    // Summarize the result for LLM consumption
    const summary = summarizeResult({ data: result.result });

    return {
      success: true,
      data: result.result,
      summary: `Execution succeeded. ${summary}`,
      updatedVariables: result.updatedVariables,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const stackTrace = error instanceof Error ? error.stack : undefined;

    return {
      success: false,
      error: errorMessage,
      summary: `Execution error: ${errorMessage}`,
      data: { stackTrace },
      // Preserve input variables on error
      updatedVariables: variables,
    };
  }
}

