/**
 * CodeAct Node
 * 
 * LangGraph node that generates and executes Playwright code.
 * CodeAct translates high-level instructions from Planner into executable code.
 * 
 * Features:
 * - Self-repair: retries with error info when execution fails
 * - Detailed logging for debugging
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { IBrowserAdapter, CodeExecutionResult } from '@chat-agent/browser-adapter';
import type { AgentState } from '../state';
import { generateId } from '../state';
import { loadLLMConfig } from '../config';
import { createAgentLogger, startTimer } from '../tracing';
import { 
  CODEACT_ITERATIVE_SYSTEM_PROMPT, 
  CODEACT_SCRIPT_SYSTEM_PROMPT,
  buildCodeActUserMessage,
  parseCodeActResponse,
  type PreviousAttempt,
} from './prompts';
import type { ExecutionMode, CodeResult } from './types';

const log = createAgentLogger('CodeActNode');

/**
 * Configuration for the CodeAct node
 */
export interface CodeActNodeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  mode?: ExecutionMode;
  timeout?: number;
  maxRetries?: number;  // Max attempts for self-repair
}

/**
 * Create the CodeAct Node
 */
export function createCodeActNode(
  browserAdapter: IBrowserAdapter,
  config: CodeActNodeConfig
) {
  const llmConfig = loadLLMConfig({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });

  const mode = config.mode || 'iterative';
  const timeout = config.timeout || 30000;
  const maxRetries = config.maxRetries || 3;

  const hasLlm = !!llmConfig.apiKey;
  let llm: ChatAnthropic | null = null;

  if (hasLlm) {
    log.info('Initializing CodeAct LLM', { model: llmConfig.model, mode, maxRetries });
    
    const llmOptions: Record<string, unknown> = {
      anthropicApiKey: llmConfig.apiKey,
      modelName: llmConfig.model,
    };

    if (llmConfig.temperature !== undefined) {
      llmOptions.temperature = llmConfig.temperature;
    }
    if (llmConfig.baseUrl) {
      llmOptions.anthropicApiUrl = llmConfig.baseUrl;
    }
    if (llmConfig.maxTokens !== undefined) {
      llmOptions.maxOutputTokens = llmConfig.maxTokens;
    }

    llm = new ChatAnthropic(llmOptions);
  }

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const traceContext = state.traceContext;
    const timer = startTimer(log, 'codeact', traceContext ?? undefined);

    // Get instruction from Planner
    const instruction = (state as any).currentInstruction as string | undefined;
    
    if (!instruction) {
      log.error('No instruction from Planner');
      return {
        status: 'error',
        error: 'No instruction provided by Planner',
      };
    }

    // Log CodeAct input context for tracing
    log.infoWithTrace(traceContext!, '[CODEACT] Input context', {
      instruction,
      mode,
      iteration: state.iterationCount,
      maxRetries,
    });

    if (!hasLlm) {
      return {
        status: 'error',
        error: 'LLM not configured for CodeAct',
      };
    }

    // Select system prompt based on mode
    const systemPrompt = mode === 'script' 
      ? CODEACT_SCRIPT_SYSTEM_PROMPT 
      : CODEACT_ITERATIVE_SYSTEM_PROMPT;

    // Retry loop for self-repair
    let previousAttempt: PreviousAttempt | undefined;
    let lastCode = '';
    let lastError = '';
    let lastExecResult: CodeResult | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        log.infoWithTrace(traceContext!, '[CODEACT] Attempt', {
          attempt,
          maxRetries,
          isRetry: attempt > 1,
          previousError: previousAttempt?.error,
        });

        // Build user message (with previous attempt info if retrying)
        const userMessage = buildCodeActUserMessage({
          instruction,
          mode,
          previousAttempt,
        });

        // Call LLM
        const messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(userMessage),
        ];

        // Log complete LLM prompt for debugging
        log.infoWithTrace(traceContext!, '[CODEACT] === LLM Request ===', {
          attempt,
          model: llmConfig.model,
          mode,
          systemPromptLength: systemPrompt.length,
          userMessageLength: userMessage.length,
        });
        log.debugWithTrace(traceContext!, '[CODEACT] System Prompt', {
          attempt,
          systemPrompt,
        });
        log.debugWithTrace(traceContext!, '[CODEACT] User Message', {
          attempt,
          userMessage,
        });

        const llmStartTime = Date.now();
        const response = await llm!.invoke(messages);
        const llmDuration = Date.now() - llmStartTime;

        const responseText = typeof response.content === 'string'
          ? response.content
          : JSON.stringify(response.content);

        log.infoWithTrace(traceContext!, '[CODEACT] LLM response', {
          attempt,
          responseLength: responseText.length,
          duration: llmDuration,
          responsePreview: responseText.slice(0, 300) + (responseText.length > 300 ? '...' : ''),
        });

        // Parse response
        const decision = parseCodeActResponse(responseText);

        if (!decision) {
          log.errorWithTrace(traceContext!, '[CODEACT] Failed to parse response', {
            attempt,
            responseText: responseText.slice(0, 500),
          });
          // Don't retry parse failures, just fail
          return {
            status: 'error',
            error: 'Failed to parse CodeAct response',
            consecutiveFailures: state.consecutiveFailures + 1,
          };
        }

        lastCode = decision.code;

        log.infoWithTrace(traceContext!, '[CODEACT] Code generated', { 
          attempt,
          codeLength: decision.code.length,
          thought: decision.thought?.slice(0, 150),
          codePreview: decision.code.slice(0, 300) + (decision.code.length > 300 ? '...' : ''),
        });

        log.debugWithTrace(traceContext!, '[CODEACT] Full generated code', {
          attempt,
          code: decision.code,
        });

        // Execute the code
        const execStartTime = Date.now();
        const execResult = await executeCode(browserAdapter, decision.code, timeout);
        const execDuration = Date.now() - execStartTime;

        lastExecResult = execResult;

        log.infoWithTrace(traceContext!, '[CODEACT] Execution result', {
          attempt,
          success: execResult.success,
          duration: execDuration,
          error: execResult.error,
          stackTrace: execResult.stackTrace?.slice(0, 200),
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
        });

        // Success! Return the result
        if (execResult.success) {
          log.infoWithTrace(traceContext!, '[CODEACT] Success after attempts', {
            totalAttempts: attempt,
          });

          const action = createActionRecord(
            instruction, decision.code, decision.thought, execResult, execDuration
          );

          timer.end(`Code executed successfully (attempt ${attempt})`);

          const newObservation = buildNewObservation(state, execResult);

          log.infoWithTrace(traceContext!, '[CODEACT] Output context', {
            newUrl: newObservation.url,
            newTitle: newObservation.title,
            actionSuccess: true,
            nextIteration: state.iterationCount + 1,
          });

          return {
            status: 'acting',
            observation: newObservation,
            actionHistory: [action],
            consecutiveFailures: 0,
            iterationCount: state.iterationCount + 1,
          };
        }

        // Execution failed - prepare for retry
        lastError = execResult.error || 'Unknown error';
        
        log.warnWithTrace(traceContext!, '[CODEACT] Execution failed, preparing retry', {
          attempt,
          remainingAttempts: maxRetries - attempt,
          error: lastError,
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
        });

        // Build previous attempt info for next iteration
        previousAttempt = {
          code: decision.code,
          error: lastError,
          stackTrace: execResult.stackTrace,
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
          logs: execResult.logs,
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        log.errorWithTrace(traceContext!, '[CODEACT] Unexpected error in attempt', { 
          attempt,
          error: errorMessage,
        });
        
        // For unexpected errors (like LLM API errors), don't retry
        return {
          status: 'error',
          error: `CodeAct failed: ${errorMessage}`,
          consecutiveFailures: state.consecutiveFailures + 1,
        };
      }
    }

    // All retries exhausted
    log.errorWithTrace(traceContext!, '[CODEACT] All retries failed', {
      totalAttempts: maxRetries,
      lastError,
    });

    timer.end(`All ${maxRetries} attempts failed`);

    // Create action record for the last failed attempt
    const action = createActionRecord(
      instruction, 
      lastCode, 
      'All retry attempts failed', 
      lastExecResult || { success: false, error: lastError, observation: lastError },
      0
    );

    return {
      status: 'error',
      error: `CodeAct failed after ${maxRetries} attempts: ${lastError}`,
      actionHistory: [action],
      consecutiveFailures: state.consecutiveFailures + 1,
      iterationCount: state.iterationCount + 1,
    };
  };
}

/**
 * Create an action record
 */
function createActionRecord(
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
function buildNewObservation(state: AgentState, execResult: CodeResult) {
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

/**
 * Execute Playwright code via browser adapter
 */
async function executeCode(
  browserAdapter: IBrowserAdapter,
  code: string,
  timeout: number
): Promise<CodeResult> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Code execution timeout')), timeout);
    });

    const execPromise = browserAdapter.runCode(code);
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
    };
  }
}

/**
 * Summarize execution result for Planner
 */
function summarizeResult(result: unknown): string {
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
