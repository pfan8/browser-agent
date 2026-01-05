/**
 * CodeAct Sub-Agent Adapter
 *
 * Wraps the existing CodeAct node as an ISubAgent implementation.
 * This allows the Router to dispatch browser automation tasks to CodeAct.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { BeadsTask } from '../beads/types';
import type {
    ISubAgent,
    SubAgentTask,
    SubAgentContext,
    SubAgentResult,
    SubAgentTaskType,
} from './types';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('CodeActAdapter');

/**
 * Configuration for CodeAct adapter
 */
export interface CodeActAdapterConfig {
    /** Browser adapter for Playwright operations */
    browserAdapter: IBrowserAdapter;
    /** LLM API key */
    apiKey?: string;
    /** LLM base URL */
    baseUrl?: string;
    /** LLM model name */
    model?: string;
    /** Code execution timeout in ms */
    timeout?: number;
}

/**
 * CodeAct adapter implementing ISubAgent interface
 *
 * Delegates task execution to the CodeAct node for browser automation.
 */
export class CodeActSubAgent implements ISubAgent {
    readonly name = 'codeact';
    readonly supportedTypes: SubAgentTaskType[] = ['browser_action', 'query'];

    private browserAdapter: IBrowserAdapter;
    private config: CodeActAdapterConfig;

    constructor(config: CodeActAdapterConfig) {
        this.browserAdapter = config.browserAdapter;
        this.config = config;
    }

    /**
     * Check if this sub-agent can handle the given task
     */
    canHandle(task: BeadsTask): boolean {
        // CodeAct handles browser_action and query tasks
        const taskType = (task.metadata?.type as SubAgentTaskType) || 'browser_action';
        return this.supportedTypes.includes(taskType);
    }

    /**
     * Execute the given task(s)
     *
     * Uses the browser adapter to run Playwright code generated for the task.
     */
    async execute(
        task: SubAgentTask,
        context: SubAgentContext
    ): Promise<SubAgentResult> {
        log.info('CodeAct executing task', {
            taskCount: task.tasks.length,
            isMerged: task.isMerged,
            instruction: task.instruction.substring(0, 100),
        });

        const startTime = Date.now();

        try {
            // For now, we'll use a simplified execution path
            // In the full implementation, this would call the CodeAct node
            const result = await this.executeInstruction(
                task.instruction,
                context.variables
            );

            const duration = Date.now() - startTime;

            if (result.success) {
                log.info('CodeAct task completed', {
                    duration,
                    completedCount: task.tasks.length,
                });

                return {
                    success: true,
                    completedTaskIds: task.originalTaskIds,
                    failedTaskIds: [],
                    result: result.data,
                    summary: `Completed ${task.tasks.length} task(s) in ${duration}ms`,
                    updatedVariables: result.variables,
                };
            } else {
                log.warn('CodeAct task failed', {
                    duration,
                    error: result.error,
                });

                return {
                    success: false,
                    completedTaskIds: [],
                    failedTaskIds: task.originalTaskIds,
                    error: result.error,
                    summary: `Failed: ${result.error}`,
                    updatedVariables: result.variables,
                };
            }
        } catch (error) {
            const duration = Date.now() - startTime;
            const errorMessage = error instanceof Error ? error.message : String(error);

            log.error('CodeAct execution error', {
                duration,
                error: errorMessage,
            });

            return {
                success: false,
                completedTaskIds: [],
                failedTaskIds: task.originalTaskIds,
                error: errorMessage,
                summary: `Error: ${errorMessage}`,
            };
        }
    }

    /**
     * Execute a single instruction using the browser adapter
     *
     * This is a simplified implementation. The full version would
     * generate and execute Playwright code via the CodeAct LLM.
     */
    private async executeInstruction(
        instruction: string,
        variables: Record<string, unknown>
    ): Promise<{
        success: boolean;
        data?: unknown;
        error?: string;
        variables?: Record<string, unknown>;
    }> {
        try {
            // Parse the instruction to determine action type
            const action = this.parseInstruction(instruction);

            if (!action) {
                return {
                    success: false,
                    error: `Could not parse instruction: ${instruction}`,
                    variables,
                };
            }

            // Execute the action using browser adapter
            const result = await this.executeAction(action);

            return {
                success: result.success,
                data: result.data,
                error: result.error,
                variables: {
                    ...variables,
                    lastResult: result.data,
                },
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
                variables,
            };
        }
    }

    /**
     * Parse natural language instruction into action
     */
    private parseInstruction(instruction: string): ParsedAction | null {
        const lowerInstruction = instruction.toLowerCase();

        // Navigate
        if (lowerInstruction.includes('navigate') || lowerInstruction.includes('go to') || lowerInstruction.includes('open')) {
            const urlMatch = instruction.match(/https?:\/\/[^\s"']+|(?:www\.)?[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[^\s"']*/);
            if (urlMatch) {
                let url = urlMatch[0];
                if (!url.startsWith('http')) {
                    url = 'https://' + url;
                }
                return { type: 'navigate', url };
            }
        }

        // Click
        if (lowerInstruction.includes('click')) {
            const selectorMatch = instruction.match(/["']([^"']+)["']|on\s+(.+?)(?:\s+button|\s+link|\s+element)?$/i);
            if (selectorMatch) {
                const selector = selectorMatch[1] || selectorMatch[2];
                return { type: 'click', selector: selector.trim() };
            }
        }

        // Type
        if (lowerInstruction.includes('type') || lowerInstruction.includes('enter') || lowerInstruction.includes('input')) {
            const textMatch = instruction.match(/["']([^"']+)["']/);
            const selectorMatch = instruction.match(/in(?:to)?\s+(?:the\s+)?["']?([^"']+?)["']?(?:\s+(?:field|input|box))?$/i);
            if (textMatch) {
                return {
                    type: 'type',
                    text: textMatch[1],
                    selector: selectorMatch?.[1] || 'input',
                };
            }
        }

        // Get page info
        if (lowerInstruction.includes('get') && (lowerInstruction.includes('info') || lowerInstruction.includes('page'))) {
            return { type: 'getPageInfo' };
        }

        // Screenshot
        if (lowerInstruction.includes('screenshot')) {
            return { type: 'screenshot' };
        }

        // Default: treat as a general instruction that needs LLM processing
        return { type: 'instruction', instruction };
    }

    /**
     * Execute a parsed action using the browser adapter's runCode method
     */
    private async executeAction(
        action: ParsedAction
    ): Promise<{ success: boolean; data?: unknown; error?: string }> {
        try {
            let code: string;

            switch (action.type) {
                case 'navigate':
                    code = `await context.goto(${JSON.stringify(action.url)});`;
                    break;

                case 'click':
                    code = `await context.click(${JSON.stringify(action.selector)});`;
                    break;

                case 'type':
                    code = `await context.fill(${JSON.stringify(action.selector)}, ${JSON.stringify(action.text)});`;
                    break;

                case 'getPageInfo':
                    code = `({ url: context.url(), title: await context.title() })`;
                    break;

                case 'screenshot':
                    code = `await context.screenshot()`;
                    break;

                case 'instruction':
                    // Complex instructions require full LLM processing
                    return {
                        success: false,
                        error: `Complex instruction requires LLM processing: ${action.instruction}`,
                    };

                default:
                    return {
                        success: false,
                        error: `Unknown action type: ${(action as ParsedAction).type}`,
                    };
            }

            const result = await this.browserAdapter.runCode(code);
            return {
                success: result.success,
                data: result.result,
                error: result.error,
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }

    /**
     * Estimate execution time for a task
     */
    estimateTime(task: SubAgentTask): number {
        // Rough estimate: 5 seconds per task
        return task.tasks.length * 5000;
    }
}

/**
 * Parsed action from instruction
 */
interface ParsedAction {
    type: 'navigate' | 'click' | 'type' | 'getPageInfo' | 'screenshot' | 'instruction';
    url?: string;
    selector?: string;
    text?: string;
    instruction?: string;
}

/**
 * Create a CodeAct sub-agent instance
 */
export function createCodeActSubAgent(config: CodeActAdapterConfig): ISubAgent {
    return new CodeActSubAgent(config);
}

