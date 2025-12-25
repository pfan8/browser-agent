/**
 * CodeAct Node - ReAct Agent Implementation
 *
 * LangGraph node that implements a ReAct (Reasoning + Acting) loop.
 * CodeAct can dynamically call tools to complete tasks from Planner.
 *
 * Available Tools:
 * - runCode: Execute Playwright code
 * - summarizeResult: Summarize large objects
 * - fetchData: Retrieve data from execution variables
 * - finish: Complete the task and return result
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { AgentState, VariableSummary } from '../state';
import { loadLLMConfig, getCodeActConfig } from '../config';
import { createAgentLogger, startTimer, type TraceContext } from '../tracing';
import {
    CODEACT_REACT_SYSTEM_PROMPT,
    buildReActUserMessage,
    parseToolCall,
} from './prompts';
import type { ExecutionMode } from './types';
import {
    buildVariableSummary,
    createActionRecord,
    buildNewObservation,
} from './helpers';
import {
    runCode,
    fetchData,
    summarizeResultTool,
    type ToolResult,
    type ToolCall,
} from './tools';

const log = createAgentLogger('CodeActNode');

/**
 * Immutable configuration created once per node instance
 */
interface CodeActNodeState {
    browserAdapter: IBrowserAdapter;
    llm: ChatAnthropic;
    llmModel: string;
    maxReactIterations: number;
    codeExecutionTimeout: number;
}

/**
 * Context for a single ReAct execution
 */
interface ReActContext {
    config: CodeActNodeState;
    traceContext: TraceContext | null;
    instruction: string;
    variables: Record<string, unknown>;
    toolHistory: Array<{ tool: string; args: unknown; result: ToolResult }>;
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
    maxRetries?: number;
}

/**
 * Create the CodeAct Node with ReAct loop
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

    const codeActConfig = getCodeActConfig();

    const hasLlm = !!llmConfig.apiKey;
    let llm: ChatAnthropic | null = null;

    if (hasLlm) {
        log.info('Initializing CodeAct ReAct Agent', {
            model: llmConfig.model,
            maxReactIterations: codeActConfig.maxReactIterations,
        });

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

    const nodeState: CodeActNodeState = {
        browserAdapter,
        llm: llm!,
        llmModel: llmConfig.model || 'unknown',
        maxReactIterations: codeActConfig.maxReactIterations,
        codeExecutionTimeout: codeActConfig.codeExecutionTimeout,
    };

    return async (state: AgentState): Promise<Partial<AgentState>> => {
        const traceContext = state.traceContext;
        const timer = startTimer(log, 'codeact', traceContext ?? undefined);

        // Validate instruction
        const instruction = (state as Record<string, unknown>)
            .currentInstruction as string | undefined;
        if (!instruction) {
            log.error('No instruction from Planner');
            return {
                status: 'error',
                error: 'No instruction provided by Planner',
            };
        }

        if (!hasLlm) {
            return { status: 'error', error: 'LLM not configured for CodeAct' };
        }

        // Initialize ReAct context
        const reactContext: ReActContext = {
            config: nodeState,
            traceContext,
            instruction,
            variables: state.executionVariables || {},
            toolHistory: [],
        };

        logInputContext(reactContext);

        // Run ReAct loop
        const result = await runReActLoop(reactContext, state, timer);
        return result;
    };
}

/**
 * Log input context for tracing
 */
function logInputContext(ctx: ReActContext): void {
    log.infoWithTrace(ctx.traceContext!, '[CODEACT] ReAct input context', {
        instruction: ctx.instruction,
        maxIterations: ctx.config.maxReactIterations,
        variableCount: Object.keys(ctx.variables).length,
        variableNames: Object.keys(ctx.variables),
    });
}

/**
 * Run the ReAct (Reasoning + Acting) loop
 */
async function runReActLoop(
    ctx: ReActContext,
    state: AgentState,
    timer: ReturnType<typeof startTimer>
): Promise<Partial<AgentState>> {
    const { config, traceContext, instruction } = ctx;

    for (
        let iteration = 1;
        iteration <= config.maxReactIterations;
        iteration++
    ) {
        log.infoWithTrace(traceContext!, '[CODEACT] ReAct iteration', {
            iteration,
            maxIterations: config.maxReactIterations,
            toolHistoryLength: ctx.toolHistory.length,
        });

        // Step 1: Think - Ask LLM which tool to call
        const toolCall = await thinkStep(ctx, iteration);

        if (!toolCall) {
            return buildErrorResult(
                state,
                ctx,
                timer,
                'Failed to parse tool call from LLM'
            );
        }

        // Step 2: Check if task is complete
        if (toolCall.tool === 'finish') {
            return buildFinishResult(state, ctx, toolCall, timer, iteration);
        }

        // Step 3: Act - Execute the selected tool
        const toolResult = await actStep(ctx, toolCall);

        // Record tool execution
        ctx.toolHistory.push({
            tool: toolCall.tool,
            args: toolCall.args,
            result: toolResult,
        });

        log.infoWithTrace(traceContext!, '[CODEACT] Tool executed', {
            iteration,
            tool: toolCall.tool,
            success: toolResult.success,
            summary: toolResult.summary.slice(0, 200),
        });
    }

    // Max iterations reached
    return buildMaxIterationsResult(state, ctx, timer);
}

/**
 * Think step: Ask LLM which tool to call next
 */
async function thinkStep(
    ctx: ReActContext,
    iteration: number
): Promise<ToolCall | null> {
    const { config, traceContext, instruction, variables, toolHistory } = ctx;
    const variableSummary = buildVariableSummary(variables);

    const userMessage = buildReActUserMessage({
        instruction,
        availableVariables: variableSummary,
        toolHistory: toolHistory.map((h) => ({
            tool: h.tool,
            args: h.args,
            success: h.result.success,
            summary: h.result.summary,
        })),
    });

    const messages = [
        new SystemMessage(CODEACT_REACT_SYSTEM_PROMPT),
        new HumanMessage(userMessage),
    ];

    log.infoWithTrace(traceContext!, '[CODEACT] Think step - LLM request', {
        iteration,
        model: config.llmModel,
        userMessageLength: userMessage.length,
    });

    const llmStartTime = Date.now();
    const response = await config.llm.invoke(messages);
    const llmDuration = Date.now() - llmStartTime;

    const responseText =
        typeof response.content === 'string'
            ? response.content
            : JSON.stringify(response.content);

    log.infoWithTrace(traceContext!, '[CODEACT] Think step - LLM response', {
        iteration,
        responseLength: responseText.length,
        duration: llmDuration,
        preview: responseText.slice(0, 300),
    });

    const toolCall = parseToolCall(responseText);
    if (!toolCall) {
        log.errorWithTrace(
            traceContext!,
            '[CODEACT] Failed to parse tool call',
            {
                iteration,
                responseText: responseText.slice(0, 500),
            }
        );
    }

    return toolCall;
}

/**
 * Act step: Execute the selected tool
 */
async function actStep(
    ctx: ReActContext,
    toolCall: ToolCall
): Promise<ToolResult> {
    const { config, traceContext } = ctx;

    log.infoWithTrace(traceContext!, '[CODEACT] Act step - executing tool', {
        tool: toolCall.tool,
        args: JSON.stringify(toolCall.args).slice(0, 200),
    });

    switch (toolCall.tool) {
        case 'runCode': {
            const code = toolCall.args.code as string;
            const result = await runCode(
                config.browserAdapter,
                { code },
                ctx.variables,
                config.codeExecutionTimeout
            );
            // Update variables if execution modified them
            if (result.updatedVariables) {
                ctx.variables = result.updatedVariables;
            }
            return result;
        }

        case 'summarizeResult': {
            const data = toolCall.args.data;
            return summarizeResultTool({ data });
        }

        case 'fetchData': {
            const target = (toolCall.args.target as string) || 'all';
            const name = toolCall.args.name as string | undefined;
            return fetchData(
                { target: target as 'all' | 'keys' | 'single', name },
                ctx.variables
            );
        }

        default:
            return {
                success: false,
                error: `Unknown tool: ${toolCall.tool}`,
                summary: `Error: Unknown tool "${toolCall.tool}"`,
            };
    }
}

/**
 * Build result when LLM calls 'finish'
 */
function buildFinishResult(
    state: AgentState,
    ctx: ReActContext,
    toolCall: ToolCall,
    timer: ReturnType<typeof startTimer>,
    iteration: number
): Partial<AgentState> {
    const { traceContext, instruction, variables, toolHistory } = ctx;
    const result = (toolCall.args.result as string) || 'Task completed';
    const thought = toolCall.thought || '';

    log.infoWithTrace(traceContext!, '[CODEACT] Task finished', {
        iteration,
        result: result.slice(0, 200),
        toolsUsed: toolHistory.length,
    });

    timer.end(`ReAct completed in ${iteration} iterations`);

    // Create action record for the overall task
    const lastRunCode = toolHistory.find((h) => h.tool === 'runCode');
    const action = createActionRecord(
        instruction,
        lastRunCode ? (lastRunCode.args as { code: string }).code : '',
        thought,
        {
            success: true,
            observation: result,
            output: toolCall.args.result,
        },
        0
    );

    const variableSummary = buildVariableSummary(variables);
    const newObservation = buildNewObservation(state, {
        success: true,
        observation: result,
        output: toolCall.args.result,
    });

    return {
        status: 'acting',
        observation: newObservation,
        actionHistory: [action],
        consecutiveFailures: 0,
        iterationCount: state.iterationCount + 1,
        executionVariables: variables,
        variableSummary,
    };
}

/**
 * Build error result
 */
function buildErrorResult(
    state: AgentState,
    ctx: ReActContext,
    timer: ReturnType<typeof startTimer>,
    error: string
): Partial<AgentState> {
    const { traceContext, variables } = ctx;

    log.errorWithTrace(traceContext!, '[CODEACT] Error', { error });
    timer.end(`Error: ${error}`);

    return {
        status: 'error',
        error: `CodeAct error: ${error}`,
        consecutiveFailures: state.consecutiveFailures + 1,
        executionVariables: variables,
        variableSummary: buildVariableSummary(variables),
    };
}

/**
 * Build result when max iterations reached
 */
function buildMaxIterationsResult(
    state: AgentState,
    ctx: ReActContext,
    timer: ReturnType<typeof startTimer>
): Partial<AgentState> {
    const { traceContext, instruction, variables, toolHistory, config } = ctx;

    log.warnWithTrace(traceContext!, '[CODEACT] Max iterations reached', {
        maxIterations: config.maxReactIterations,
        toolsExecuted: toolHistory.length,
    });

    timer.end(`Max iterations (${config.maxReactIterations}) reached`);

    // Create summary of what was accomplished
    const summary = toolHistory
        .map(
            (h, i) =>
                `${i + 1}. ${h.tool}: ${
                    h.result.success ? 'OK' : 'FAIL'
                } - ${h.result.summary.slice(0, 50)}`
        )
        .join('\n');

    const action = createActionRecord(
        instruction,
        '',
        `Max iterations reached. Tools executed:\n${summary}`,
        {
            success: false,
            observation: `Reached max iterations (${config.maxReactIterations})`,
            error: 'Max iterations exceeded',
        },
        0
    );

    return {
        status: 'error',
        error: `CodeAct reached max iterations (${config.maxReactIterations})`,
        actionHistory: [action],
        consecutiveFailures: state.consecutiveFailures + 1,
        iterationCount: state.iterationCount + 1,
        executionVariables: variables,
        variableSummary: buildVariableSummary(variables),
    };
}
