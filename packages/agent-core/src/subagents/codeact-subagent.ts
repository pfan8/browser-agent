/**
 * CodeAct SubAgent
 *
 * Browser automation SubAgent that uses a ReAct loop to generate
 * and execute Playwright code. Supports file-based script artifacts.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import {
    BaseSubAgent,
    type SubAgentRequest,
    type SubAgentContext,
    type SubAgentResult,
    type ContentBlockType,
    type ArtifactRef,
    createTextMessage,
    extractText,
} from '../multimodal';
import { createAgentLogger } from '../tracing';
import {
    CODEACT_REACT_SYSTEM_PROMPT,
    buildReActUserMessage,
    parseToolCall,
} from '../codeact/prompts';
import {
    runCode,
    fetchData,
    summarizeResultTool,
    type ToolResult,
    type ToolCall,
} from '../codeact/tools';
import { buildVariableSummary } from '../codeact/helpers';

const log = createAgentLogger('CodeActSubAgent');

// ============================================================
// Configuration
// ============================================================

/**
 * Configuration for CodeAct SubAgent
 */
export interface CodeActSubAgentConfig {
    /** Maximum ReAct iterations */
    maxReactIterations?: number;
    /** Code execution timeout in ms */
    codeExecutionTimeout?: number;
    /** Whether to save generated code as artifacts */
    saveCodeArtifacts?: boolean;
}

const DEFAULT_CONFIG: Required<CodeActSubAgentConfig> = {
    maxReactIterations: 10,
    codeExecutionTimeout: 30000,
    saveCodeArtifacts: true,
};

// ============================================================
// Implementation
// ============================================================

/**
 * CodeAct SubAgent V3 implementation
 */
export class CodeActSubAgent extends BaseSubAgent {
    readonly name = 'codeact';
    readonly description =
        'Executes browser automation tasks using Playwright code generation';
    readonly inputTypes: ContentBlockType[] = ['text'];
    readonly outputTypes: ContentBlockType[] = ['text', 'code', 'image'];
    readonly priority = 100; // High priority for browser tasks

    private config: Required<CodeActSubAgentConfig>;

    constructor(config?: CodeActSubAgentConfig) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Check if this SubAgent can handle the request
     */
    canHandle(request: SubAgentRequest): boolean {
        // CodeAct handles text-based browser automation requests
        const hasText = request.input.content.some((c) => c.type === 'text');
        return hasText;
    }

    /**
     * Execute the CodeAct ReAct loop
     */
    async execute(
        request: SubAgentRequest,
        context: SubAgentContext
    ): Promise<SubAgentResult> {
        const startTime = Date.now();
        const instruction = extractText(request.input);

        log.info('[CODEACT] Starting execution', {
            instruction: instruction.substring(0, 100),
            maxIterations: this.config.maxReactIterations,
        });

        try {
            // Initialize variables from context
            const variables = { ...context.variables };
            const toolHistory: ToolHistoryEntry[] = [];
            const artifacts: ArtifactRef[] = [];
            const generatedCodes: string[] = [];

            // Run ReAct loop
            const result = await this.runReActLoop(
                instruction,
                context.browserAdapter,
                context.llm,
                variables,
                toolHistory,
                generatedCodes
            );

            // Save code artifact if enabled
            if (
                this.config.saveCodeArtifacts &&
                generatedCodes.length > 0
            ) {
                const combinedCode = this.formatGeneratedCode(
                    instruction,
                    generatedCodes
                );
                const codeArtifact = await context.artifactManager.saveCode(
                    combinedCode,
                    'typescript',
                    `task-${Date.now()}.ts`,
                    { instruction, toolCount: toolHistory.length }
                );
                artifacts.push(codeArtifact);
            }

            const duration = Date.now() - startTime;

            // Build result
            if (result.success) {
                return this.createSuccessResult(
                    createTextMessage(result.summary, 'subagent'),
                    artifacts,
                    duration,
                    {
                        updatedVariables: result.variables,
                    }
                );
            } else {
                return this.createErrorResult(
                    result.error || 'Unknown error',
                    duration
                );
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            log.error('[CODEACT] Execution error', { error: errorMsg });
            return this.createErrorResult(errorMsg, duration);
        }
    }

    /**
     * Run the ReAct loop
     */
    private async runReActLoop(
        instruction: string,
        browserAdapter: IBrowserAdapter,
        llm: ChatAnthropic,
        variables: Record<string, unknown>,
        toolHistory: ToolHistoryEntry[],
        generatedCodes: string[]
    ): Promise<ReActLoopResult> {
        for (
            let iteration = 1;
            iteration <= this.config.maxReactIterations;
            iteration++
        ) {
            log.info('[CODEACT] ReAct iteration', {
                iteration,
                maxIterations: this.config.maxReactIterations,
            });

            // Think: Ask LLM which tool to call
            const toolCall = await this.thinkStep(
                instruction,
                variables,
                toolHistory,
                llm
            );

            if (!toolCall) {
                return {
                    success: false,
                    error: 'Failed to parse tool call from LLM',
                    summary: 'LLM response parsing failed',
                    variables,
                };
            }

            // Check if complete
            if (toolCall.tool === 'finish') {
                const result =
                    (toolCall.args.result as string) || 'Task completed';
                return {
                    success: true,
                    summary: result,
                    variables,
                    data: toolCall.args.data,
                };
            }

            // Act: Execute the tool
            const toolResult = await this.actStep(
                toolCall,
                browserAdapter,
                variables,
                generatedCodes
            );

            // Update variables if modified
            if (toolResult.updatedVariables) {
                Object.assign(variables, toolResult.updatedVariables);
            }

            // Record tool execution
            toolHistory.push({
                tool: toolCall.tool,
                args: toolCall.args,
                result: toolResult,
            });

            log.info('[CODEACT] Tool executed', {
                iteration,
                tool: toolCall.tool,
                success: toolResult.success,
            });
        }

        // Max iterations reached
        const lastTool = toolHistory[toolHistory.length - 1];
        if (lastTool?.result?.success && lastTool?.result?.data) {
            return {
                success: true,
                summary: `Completed with data: ${lastTool.result.summary}`,
                variables,
                data: lastTool.result.data,
            };
        }

        return {
            success: false,
            error: `Max iterations (${this.config.maxReactIterations}) reached`,
            summary: 'Task incomplete after max iterations',
            variables,
        };
    }

    /**
     * Think step: Ask LLM for next action
     * Includes retry mechanism if initial parsing fails
     */
    private async thinkStep(
        instruction: string,
        variables: Record<string, unknown>,
        toolHistory: ToolHistoryEntry[],
        llm: ChatAnthropic
    ): Promise<ToolCall | null> {
        // First attempt
        let toolCall = await this.askLLMForToolCall(
            instruction,
            variables,
            toolHistory,
            llm
        );

        if (toolCall) {
            return toolCall;
        }

        // Retry with explicit format reminder
        log.info('[CODEACT] Retrying with format reminder');
        toolCall = await this.askLLMForToolCall(
            instruction,
            variables,
            toolHistory,
            llm,
            'Your last response was not valid JSON. You MUST respond with ONLY a JSON object like: {"tool": "toolName", "args": {...}, "thought": "..."}. If the task is complete, use: {"tool": "finish", "args": {"result": "description"}, "thought": "done"}'
        );

        return toolCall;
    }

    /**
     * Ask LLM for tool call with optional format reminder
     */
    private async askLLMForToolCall(
        instruction: string,
        variables: Record<string, unknown>,
        toolHistory: ToolHistoryEntry[],
        llm: ChatAnthropic,
        formatReminder?: string
    ): Promise<ToolCall | null> {
        const variableSummary = buildVariableSummary(variables);

        let userMessage = buildReActUserMessage({
            instruction,
            availableVariables: variableSummary,
            toolHistory: toolHistory.map((h) => ({
                tool: h.tool,
                args: h.args,
                success: h.result.success,
                summary: h.result.summary,
            })),
        });

        // Add format reminder if provided
        if (formatReminder) {
            userMessage = `${formatReminder}\n\n${userMessage}`;
        }

        const messages = [
            new SystemMessage(CODEACT_REACT_SYSTEM_PROMPT),
            new HumanMessage(userMessage),
        ];

        const response = await llm.invoke(messages);
        const responseText =
            typeof response.content === 'string'
                ? response.content
                : JSON.stringify(response.content);

        // Debug logging to diagnose parsing issues
        log.debug('[CODEACT] LLM response', {
            responsePreview: responseText.substring(0, 500),
            responseLength: responseText.length,
            hasFormatReminder: !!formatReminder,
        });

        const toolCall = parseToolCall(responseText);

        if (!toolCall) {
            log.warn('[CODEACT] Failed to parse tool call', {
                responsePreview: responseText.substring(0, 300),
                isRetry: !!formatReminder,
            });
        }

        return toolCall;
    }

    /**
     * Act step: Execute the selected tool
     */
    private async actStep(
        toolCall: ToolCall,
        browserAdapter: IBrowserAdapter,
        variables: Record<string, unknown>,
        generatedCodes: string[]
    ): Promise<ToolResult> {
        switch (toolCall.tool) {
            case 'runCode': {
                const code = toolCall.args.code as string;
                generatedCodes.push(code);
                return await runCode(
                    browserAdapter,
                    { code },
                    variables,
                    this.config.codeExecutionTimeout
                );
            }

            case 'summarizeResult': {
                let data = toolCall.args.data;
                if (typeof data === 'string' && data.startsWith('state.')) {
                    const varName = data.replace('state.', '');
                    if (varName in variables) {
                        data = variables[varName];
                    } else {
                        return {
                            success: false,
                            error: `Variable "${varName}" not found`,
                            summary: `Variable not found: ${varName}`,
                        };
                    }
                }
                return summarizeResultTool({ data });
            }

            case 'fetchData': {
                const target = (toolCall.args.target as string) || 'all';
                const name = toolCall.args.name as string | undefined;
                return fetchData(
                    { target: target as 'all' | 'keys' | 'single', name },
                    variables
                );
            }

            default:
                return {
                    success: false,
                    error: `Unknown tool: ${toolCall.tool}`,
                    summary: `Unknown tool: ${toolCall.tool}`,
                };
        }
    }

    /**
     * Format generated code into a single script artifact
     */
    private formatGeneratedCode(
        instruction: string,
        codes: string[]
    ): string {
        const header = `/**
 * Generated Browser Automation Script
 * 
 * Task: ${instruction}
 * Generated: ${new Date().toISOString()}
 * Steps: ${codes.length}
 */

import { Page, BrowserContext } from 'playwright';

interface ExecutionContext {
    page: Page;
    context: BrowserContext;
    variables: Record<string, unknown>;
}

export async function execute(ctx: ExecutionContext): Promise<void> {
    const { page, context, variables } = ctx;
    
`;

        const body = codes
            .map((code, i) => {
                return `    // Step ${i + 1}
    ${code.split('\n').join('\n    ')}
`;
            })
            .join('\n');

        const footer = `
}
`;

        return header + body + footer;
    }
}

// ============================================================
// Types
// ============================================================

interface ToolHistoryEntry {
    tool: string;
    args: Record<string, unknown>;
    result: ToolResult;
}

interface ReActLoopResult {
    success: boolean;
    summary: string;
    error?: string;
    variables: Record<string, unknown>;
    data?: unknown;
}

// ============================================================
// Factory Function
// ============================================================

/**
 * Create a CodeAct SubAgent V3 instance
 */
export function createCodeActSubAgent(
    config?: CodeActSubAgentConfig
): CodeActSubAgent {
    return new CodeActSubAgent(config);
}

