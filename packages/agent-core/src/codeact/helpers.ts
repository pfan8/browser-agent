/**
 * CodeAct Helper Functions
 * 
 * Utility functions for code execution, variable summarization, and result formatting.
 */

import type { IBrowserAdapter, CodeExecutionResult } from '@chat-agent/browser-adapter';
import type { AgentState, VariableSummary } from '../state';
import { generateId } from '../state';
import type { CodeResult } from './types';

/**
 * Execute Playwright code via browser adapter
 */
export async function executeCode(
  browserAdapter: IBrowserAdapter,
  code: string,
  timeout: number,
  variables: Record<string, unknown> = {}
): Promise<CodeResult> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Code execution timeout')), timeout);
    });

    // Pass variables to runCode for state persistence
    const execPromise = browserAdapter.runCode(code, variables);
    const result: CodeExecutionResult = await Promise.race([execPromise, timeoutPromise]);

    if (!result.success) {
      return {
        success: false,
        error: result.error || 'Code execution failed',
        observation: `执行失败: ${result.error}`,
        // Enhanced debugging info
        stackTrace: result.stackTrace,
        errorType: result.errorType,
        errorLine: result.errorLine,
        logs: result.logs,
        url: result.pageUrl,
        title: result.pageTitle,
        // Return updated variables even on failure
        updatedVariables: result.updatedVariables,
      };
    }

    // Extract URL and title from result if available
    const output = result.result as Record<string, unknown> | undefined;
    
    return {
      success: true,
      output: result.result,
      observation: summarizeResult(result.result),
      url: typeof output?.url === 'string' ? output.url : result.pageUrl,
      title: typeof output?.title === 'string' ? output.title : result.pageTitle,
      logs: result.logs,
      // Return updated variables from execution
      updatedVariables: result.updatedVariables,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const stackTrace = error instanceof Error ? error.stack : undefined;
    
    return {
      success: false,
      error: errorMessage,
      observation: `执行错误: ${errorMessage}`,
      stackTrace,
      errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
      // Preserve the input variables even on exception to maintain state consistency
      // Note: any mutations made before the exception are lost since we don't have access
      // to the result, but at least we preserve the pre-execution state
      updatedVariables: variables,
    };
  }
}

/**
 * Build variable summary for prompt injection
 * Informs LLM about available variables in state
 */
export function buildVariableSummary(variables: Record<string, unknown>): VariableSummary[] {
  return Object.entries(variables).map(([name, value]) => ({
    name,
    type: getTypeName(value),
    preview: summarizeValue(value, 100),
  }));
}

/**
 * Get JavaScript type name for a value
 */
export function getTypeName(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Date) return 'Date';
  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    return `Object{${keys.slice(0, 3).join(', ')}${keys.length > 3 ? ', ...' : ''}}`;
  }
  return typeof value;
}

/**
 * Summarize a value for preview (first N chars)
 */
export function summarizeValue(value: unknown, maxLength: number = 100): string {
  try {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    
    let str: string;
    if (typeof value === 'string') {
      str = `"${value}"`;
    } else if (Array.isArray(value)) {
      const items = value.slice(0, 3).map(v => 
        typeof v === 'string' ? `"${v}"` : String(v)
      );
      str = `[${items.join(', ')}${value.length > 3 ? ', ...' : ''}]`;
    } else if (typeof value === 'object') {
      str = JSON.stringify(value);
    } else {
      str = String(value);
    }
    
    if (str.length > maxLength) {
      return str.slice(0, maxLength - 3) + '...';
    }
    return str;
  } catch {
    return '[Unable to serialize]';
  }
}

/**
 * Summarize execution result for Planner
 */
export function summarizeResult(result: unknown): string {
  if (result === null || result === undefined) {
    return '操作完成';
  }

  if (typeof result === 'object') {
    const obj = result as Record<string, unknown>;
    
    if ('success' in obj) {
      if (obj.success) {
        if (obj.url) {
          return `成功 - 当前页面: ${obj.url}`;
        }
        if (obj.title) {
          return `成功 - 页面标题: ${obj.title}`;
        }
        return '操作成功';
      } else {
        return `失败: ${obj.error || '未知错误'}`;
      }
    }

    const keys = Object.keys(obj).slice(0, 3);
    const summary = keys.map(k => `${k}: ${String(obj[k]).slice(0, 50)}`).join(', ');
    return summary || '操作完成';
  }

  return String(result).slice(0, 200);
}

/**
 * Create an action record
 */
export function createActionRecord(
  instruction: string,
  code: string,
  thought: string,
  execResult: CodeResult,
  duration: number
) {
  return {
    id: generateId('action'),
    tool: 'codeact',
    args: { instruction, code },
    thought,
    reasoning: instruction,
    timestamp: new Date().toISOString(),
    result: {
      success: execResult.success,
      data: execResult.output,
      error: execResult.error,
      duration,
    },
  };
}

/**
 * Build new observation from execution result
 */
export function buildNewObservation(state: AgentState, execResult: CodeResult) {
  return {
    ...state.observation!,
    url: execResult.url || state.observation?.url || '',
    title: execResult.title || state.observation?.title || '',
    timestamp: new Date().toISOString(),
    lastActionResult: {
      tool: 'codeact',
      success: execResult.success,
      data: execResult.output,
      error: execResult.error,
    },
  };
}

