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
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { AgentState, VariableSummary } from '../state';
import { loadLLMConfig } from '../config';
import { createAgentLogger, startTimer, type TraceContext } from '../tracing';
import { 
  CODEACT_ITERATIVE_SYSTEM_PROMPT, 
  CODEACT_SCRIPT_SYSTEM_PROMPT,
  buildCodeActUserMessage,
  parseCodeActResponse,
  type PreviousAttempt,
} from './prompts';
import type { ExecutionMode, CodeResult } from './types';
import {
  executeCode,
  buildVariableSummary,
  createActionRecord,
  buildNewObservation,
} from './helpers';

const log = createAgentLogger('CodeActNode');

/**
 * Immutable configuration created once per node instance
 * Does NOT include per-invocation data like traceContext
 */
interface CodeActConfig {
  browserAdapter: IBrowserAdapter;
  llm: ChatAnthropic;
  llmModel: string;
  mode: ExecutionMode;
  timeout: number;
  systemPrompt: string;
}

/**
 * Context passed to helper functions during execution
 * Created fresh for each invocation to avoid race conditions
 */
interface ExecutionContext extends CodeActConfig {
  traceContext: TraceContext | null;
}

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

  // Build immutable config once (shared across invocations, never mutated)
  const codeActConfig: CodeActConfig = {
    browserAdapter,
    llm: llm!,
    llmModel: llmConfig.model || 'unknown',
    mode,
    timeout,
    systemPrompt: mode === 'script' 
      ? CODEACT_SCRIPT_SYSTEM_PROMPT 
      : CODEACT_ITERATIVE_SYSTEM_PROMPT,
  };

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const traceContext = state.traceContext;
    const timer = startTimer(log, 'codeact', traceContext ?? undefined);
    
    // Create fresh execution context per invocation to avoid race conditions
    // when multiple graph instances execute concurrently
    const execContext: ExecutionContext = {
      ...codeActConfig,
      traceContext,
    };

    // Validate instruction
    const instruction = (state as any).currentInstruction as string | undefined;
    if (!instruction) {
      log.error('No instruction from Planner');
      return { status: 'error', error: 'No instruction provided by Planner' };
    }

    if (!hasLlm) {
      return { status: 'error', error: 'LLM not configured for CodeAct' };
    }

    // Initialize variables from state
    let currentVariables = state.executionVariables || {};
    let currentVariableSummary = buildVariableSummary(currentVariables);

    logInputContext(traceContext, instruction, mode, state.iterationCount, maxRetries, currentVariables);

    // Run retry loop
    const result = await runRetryLoop({
      execContext,
      state,
      instruction,
      maxRetries,
      currentVariables,
      currentVariableSummary,
      timer,
    });

    return result;
  };
}

/**
 * Log input context for tracing
 */
function logInputContext(
  traceContext: TraceContext | null,
  instruction: string,
  mode: ExecutionMode,
  iterationCount: number,
  maxRetries: number,
  currentVariables: Record<string, unknown>
): void {
  log.infoWithTrace(traceContext!, '[CODEACT] Input context', {
    instruction,
    mode,
    iteration: iterationCount,
    maxRetries,
    variableCount: Object.keys(currentVariables).length,
    variableNames: Object.keys(currentVariables),
  });
}

/**
 * Retry loop configuration
 */
interface RetryLoopParams {
  execContext: ExecutionContext;
  state: AgentState;
  instruction: string;
  maxRetries: number;
  currentVariables: Record<string, unknown>;
  currentVariableSummary: VariableSummary[];
  timer: ReturnType<typeof startTimer>;
}

/**
 * Run the retry loop for code execution with self-repair
 */
async function runRetryLoop(params: RetryLoopParams): Promise<Partial<AgentState>> {
  const { execContext, state, instruction, maxRetries, timer } = params;
  let { currentVariables, currentVariableSummary } = params;
  
    let previousAttempt: PreviousAttempt | undefined;
    let lastCode = '';
    let lastError = '';
    let lastExecResult: CodeResult | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const attemptResult = await runSingleAttempt({
      execContext,
      state,
      instruction,
      attempt,
      maxRetries,
      previousAttempt,
      currentVariables,
      currentVariableSummary,
      timer,
    });

    // Handle different attempt outcomes
    if (attemptResult.type === 'success') {
      return attemptResult.stateUpdate;
    }
    
    if (attemptResult.type === 'fatal_error') {
      return attemptResult.stateUpdate;
    }

    // Execution failed - prepare for retry
    lastCode = attemptResult.code;
    lastError = attemptResult.error;
    lastExecResult = attemptResult.execResult;
    previousAttempt = attemptResult.previousAttempt;
    
    // Update variables if modified during failed attempt
    if (attemptResult.updatedVariables) {
      currentVariables = attemptResult.updatedVariables;
      currentVariableSummary = buildVariableSummary(currentVariables);
    }
  }

  // All retries exhausted
  return buildAllRetriesFailedResult({
    state,
    instruction,
    lastCode,
    lastError,
    lastExecResult,
    maxRetries,
    currentVariables,
    currentVariableSummary,
    timer,
    traceContext: execContext.traceContext,
  });
}

/**
 * Result from a single execution attempt
 */
type AttemptResult = 
  | { type: 'success'; stateUpdate: Partial<AgentState> }
  | { type: 'fatal_error'; stateUpdate: Partial<AgentState> }
  | { 
      type: 'retry'; 
      code: string; 
      error: string; 
      execResult: CodeResult;
      previousAttempt: PreviousAttempt;
      updatedVariables?: Record<string, unknown>;
    };

/**
 * Single attempt parameters
 */
interface SingleAttemptParams {
  execContext: ExecutionContext;
  state: AgentState;
  instruction: string;
  attempt: number;
  maxRetries: number;
  previousAttempt: PreviousAttempt | undefined;
  currentVariables: Record<string, unknown>;
  currentVariableSummary: VariableSummary[];
  timer: ReturnType<typeof startTimer>;
}

/**
 * Run a single execution attempt (LLM call + code execution)
 */
async function runSingleAttempt(params: SingleAttemptParams): Promise<AttemptResult> {
  const { 
    execContext, state, instruction, attempt, maxRetries,
    previousAttempt, currentVariables, currentVariableSummary, timer 
  } = params;
  const { traceContext, llm, llmModel, mode, systemPrompt, browserAdapter, timeout } = execContext;

  try {
    logAttemptStart(traceContext, attempt, maxRetries, previousAttempt);

    // Generate code via LLM
    const decision = await generateCode({
      llm,
      llmModel,
      mode,
      systemPrompt,
      instruction,
      previousAttempt,
      currentVariableSummary,
      attempt,
      traceContext,
    });

    if (!decision) {
      return {
        type: 'fatal_error',
        stateUpdate: {
          status: 'error',
          error: 'Failed to parse CodeAct response',
          consecutiveFailures: state.consecutiveFailures + 1,
        },
      };
    }

    // Execute the generated code
    const { execResult, duration } = await executeAndLogCode({
      browserAdapter,
      code: decision.code,
      timeout,
      currentVariables,
      attempt,
      traceContext,
    });

    if (execResult.success) {
      return buildSuccessResult({
        state,
        instruction,
        decision,
        execResult,
        duration,
        currentVariables,
        attempt,
        timer,
        traceContext,
      });
    }

    // Execution failed - return retry info
    return buildRetryResult({
      decision,
      execResult,
      attempt,
      maxRetries,
      traceContext,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.errorWithTrace(traceContext!, '[CODEACT] Unexpected error in attempt', { attempt, error: errorMessage });
    
    return {
      type: 'fatal_error',
      stateUpdate: {
        status: 'error',
        error: `CodeAct failed: ${errorMessage}`,
        consecutiveFailures: state.consecutiveFailures + 1,
      },
    };
  }
}

/**
 * Log attempt start
 */
function logAttemptStart(
  traceContext: TraceContext | null,
  attempt: number,
  maxRetries: number,
  previousAttempt: PreviousAttempt | undefined
): void {
        log.infoWithTrace(traceContext!, '[CODEACT] Attempt', {
          attempt,
          maxRetries,
          isRetry: attempt > 1,
          previousError: previousAttempt?.error,
        });
}

/**
 * Generate code via LLM
 */
async function generateCode(params: {
  llm: ChatAnthropic;
  llmModel: string;
  mode: ExecutionMode;
  systemPrompt: string;
  instruction: string;
  previousAttempt: PreviousAttempt | undefined;
  currentVariableSummary: VariableSummary[];
  attempt: number;
  traceContext: TraceContext | null;
}): Promise<{ code: string; thought: string } | null> {
  const { 
    llm, llmModel, mode, systemPrompt, instruction, 
    previousAttempt, currentVariableSummary, attempt, traceContext 
  } = params;

        const userMessage = buildCodeActUserMessage({
          instruction,
          mode,
          previousAttempt,
    availableVariables: currentVariableSummary,
        });

        const messages = [
          new SystemMessage(systemPrompt),
          new HumanMessage(userMessage),
        ];

  log.infoWithTrace(traceContext!, '[CODEACT] === LLM Request ===', {
    attempt,
    model: llmModel,
    mode,
    systemPromptLength: systemPrompt.length,
    userMessageLength: userMessage.length,
  });

        const llmStartTime = Date.now();
  const response = await llm.invoke(messages);
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

        const decision = parseCodeActResponse(responseText);
        if (!decision) {
          log.errorWithTrace(traceContext!, '[CODEACT] Failed to parse response', {
            attempt,
            responseText: responseText.slice(0, 500),
          });
    return null;
  }

        log.infoWithTrace(traceContext!, '[CODEACT] Code generated', { 
          attempt,
          codeLength: decision.code.length,
          thought: decision.thought?.slice(0, 150),
          codePreview: decision.code.slice(0, 300) + (decision.code.length > 300 ? '...' : ''),
        });

  return decision;
}

/**
 * Execute code and log results
 */
async function executeAndLogCode(params: {
  browserAdapter: IBrowserAdapter;
  code: string;
  timeout: number;
  currentVariables: Record<string, unknown>;
  attempt: number;
  traceContext: TraceContext | null;
}): Promise<{ execResult: CodeResult; duration: number }> {
  const { browserAdapter, code, timeout, currentVariables, attempt, traceContext } = params;

        const execStartTime = Date.now();
  const execResult = await executeCode(browserAdapter, code, timeout, currentVariables);
  const duration = Date.now() - execStartTime;

  // Format output preview for logging
        let outputPreview: string | undefined;
        if (execResult.output !== undefined) {
          try {
            const outputStr = typeof execResult.output === 'string' 
              ? execResult.output 
              : JSON.stringify(execResult.output);
            outputPreview = outputStr.length > 1000 
              ? outputStr.slice(0, 1000) + '... (truncated)'
              : outputStr;
          } catch {
            outputPreview = '[Unable to serialize output]';
          }
        }

        log.infoWithTrace(traceContext!, '[CODEACT] Execution result', {
          attempt,
          success: execResult.success,
    duration,
          error: execResult.error,
          stackTrace: execResult.stackTrace?.slice(0, 200),
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
          outputPreview,
        });

  return { execResult, duration };
}

/**
 * Build success result
 */
function buildSuccessResult(params: {
  state: AgentState;
  instruction: string;
  decision: { code: string; thought: string };
  execResult: CodeResult;
  duration: number;
  currentVariables: Record<string, unknown>;
  attempt: number;
  timer: ReturnType<typeof startTimer>;
  traceContext: TraceContext | null;
}): AttemptResult {
  const { state, instruction, decision, execResult, duration, currentVariables, attempt, timer, traceContext } = params;

  const updatedVariables = execResult.updatedVariables || currentVariables;
  const updatedVariableSummary = buildVariableSummary(updatedVariables);

          log.infoWithTrace(traceContext!, '[CODEACT] Success after attempts', {
            totalAttempts: attempt,
    updatedVariableCount: Object.keys(updatedVariables).length,
    newVariables: Object.keys(updatedVariables).filter(
      k => !Object.keys(state.executionVariables || {}).includes(k)
    ),
          });

  const action = createActionRecord(instruction, decision.code, decision.thought, execResult, duration);
          timer.end(`Code executed successfully (attempt ${attempt})`);

          const newObservation = buildNewObservation(state, execResult);

          log.infoWithTrace(traceContext!, '[CODEACT] Output context', {
            newUrl: newObservation.url,
            newTitle: newObservation.title,
            actionSuccess: true,
            nextIteration: state.iterationCount + 1,
          });

          return {
    type: 'success',
    stateUpdate: {
            status: 'acting',
            observation: newObservation,
            actionHistory: [action],
            consecutiveFailures: 0,
            iterationCount: state.iterationCount + 1,
      executionVariables: updatedVariables,
      variableSummary: updatedVariableSummary,
    },
  };
}

/**
 * Build retry result for failed execution
 */
function buildRetryResult(params: {
  decision: { code: string; thought: string };
  execResult: CodeResult;
  attempt: number;
  maxRetries: number;
  traceContext: TraceContext | null;
}): AttemptResult {
  const { decision, execResult, attempt, maxRetries, traceContext } = params;

  const error = execResult.error || 'Unknown error';

  // Log variable updates from failed attempt
  if (execResult.updatedVariables) {
    log.debugWithTrace(traceContext!, '[CODEACT] Variables updated from failed attempt', {
      attempt,
      variableCount: Object.keys(execResult.updatedVariables).length,
      variableNames: Object.keys(execResult.updatedVariables),
    });
  }
        
        log.warnWithTrace(traceContext!, '[CODEACT] Execution failed, preparing retry', {
          attempt,
          remainingAttempts: maxRetries - attempt,
    error,
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
        });

  return {
    type: 'retry',
    code: decision.code,
    error,
    execResult,
    previousAttempt: {
          code: decision.code,
      error,
          stackTrace: execResult.stackTrace,
          errorType: execResult.errorType,
          errorLine: execResult.errorLine,
          logs: execResult.logs,
    },
    updatedVariables: execResult.updatedVariables,
  };
}

/**
 * Build result when all retries are exhausted
 */
function buildAllRetriesFailedResult(params: {
  state: AgentState;
  instruction: string;
  lastCode: string;
  lastError: string;
  lastExecResult: CodeResult | undefined;
  maxRetries: number;
  currentVariables: Record<string, unknown>;
  currentVariableSummary: VariableSummary[];
  timer: ReturnType<typeof startTimer>;
  traceContext: TraceContext | null;
}): Partial<AgentState> {
  const { 
    state, instruction, lastCode, lastError, lastExecResult,
    maxRetries, currentVariables, currentVariableSummary, timer, traceContext 
  } = params;

    log.errorWithTrace(traceContext!, '[CODEACT] All retries failed', {
      totalAttempts: maxRetries,
      lastError,
    });

    timer.end(`All ${maxRetries} attempts failed`);

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
    executionVariables: currentVariables,
    variableSummary: currentVariableSummary,
  };
}
