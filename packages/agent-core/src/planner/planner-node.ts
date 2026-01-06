/**
 * Planner Node
 *
 * LangGraph node that handles high-level task planning.
 * The Planner does NOT know Playwright API - it only describes what to do.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import {
    HumanMessage,
    SystemMessage,
    AIMessage,
    BaseMessage,
} from '@langchain/core/messages';
import type { AgentState } from '../state';
import { loadLLMConfig } from '../config';
import { createAgentLogger, startTimer } from '../tracing';
import {
    PLANNER_SYSTEM_PROMPT,
    buildPlannerUserMessage,
    CHAT_RESPONSES,
} from './prompts';
import type { PlannerDecision } from './types';
import { formatFullDataAsMarkdown } from './summarize';
import { ContextManager, type ContextConfig } from '../context';

const log = createAgentLogger('PlannerNode');

/**
 * Coerce a potentially serialized message to a proper BaseMessage instance.
 * This handles messages restored from checkpoints that are plain objects.
 */
function coerceToBaseMessage(msg: unknown): BaseMessage {
    // Already a proper BaseMessage instance
    if (msg instanceof BaseMessage) {
        return msg;
    }

    // Handle LangChain serialized format (from checkpoint)
    if (msg && typeof msg === 'object') {
        const obj = msg as Record<string, unknown>;

        // Check for lc_serializable format
        if (obj.lc_serializable && obj.lc_kwargs) {
            const kwargs = obj.lc_kwargs as Record<string, unknown>;
            const content = (kwargs.content as string) || '';
            const namespace = obj.lc_namespace as string[] | undefined;

            // Determine message type from namespace or structure
            if (namespace && namespace.includes('messages')) {
                // Check if it's an AIMessage (has tool_calls)
                if ('tool_calls' in kwargs || 'invalid_tool_calls' in kwargs) {
                    return new AIMessage({ content });
                }
            }

            // Default to AIMessage for unknown serialized messages
            return new AIMessage({ content });
        }

        // Handle plain object with type indicator
        if ('type' in obj || '_type' in obj) {
            const msgType = (obj.type || obj._type) as string;
            const content = (obj.content as string) || '';

            switch (msgType) {
                case 'human':
                    return new HumanMessage(content);
                case 'ai':
                    return new AIMessage(content);
                case 'system':
                    return new SystemMessage(content);
                default:
                    return new AIMessage(content);
            }
        }

        // Last resort: if it has content, treat as AIMessage
        if ('content' in obj) {
            return new AIMessage((obj.content as string) || '');
        }
    }

    // Fallback: convert to string
    return new AIMessage(String(msg));
}

/**
 * Configuration for the planner node
 */
export interface PlannerNodeConfig {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
    /** Context management configuration */
    contextConfig?: Partial<ContextConfig>;
}

/**
 * Parse LLM response to PlannerDecision
 */
function parsePlannerResponse(response: string): PlannerDecision | null {
    try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // Check if it's a completion message
            if (response.includes('complete') || response.includes('完成')) {
                return {
                    thought: response,
                    nextStep: null,
                    isComplete: true,
                    completionMessage: response.slice(0, 500),
                };
            }
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        return {
            thought: parsed.thought || '',
            nextStep: parsed.nextStep || null,
            isComplete: parsed.isComplete === true,
            completionMessage: parsed.completionMessage,
            needsMoreInfo: parsed.needsMoreInfo,
            question: parsed.question,
        };
    } catch {
        return null;
    }
}

/**
 * Summarize execution output for Planner context
 * Truncates long outputs to keep token usage manageable
 * Preserves array count when truncating to avoid LLM misunderstanding
 */
function summarizeOutput(data: unknown, maxLength = 800): string | undefined {
    if (data === null || data === undefined) {
        return undefined;
    }

    try {
        // For arrays, always include the total count at the beginning
        if (Array.isArray(data)) {
            const count = data.length;
            const prefix = `[Total: ${count} items] `;
            const str = JSON.stringify(data);
            if (str.length + prefix.length <= maxLength) {
                return prefix + str;
            }
            // Truncate but keep the count visible
            const availableLength = maxLength - prefix.length - 20; // Reserve space for truncation notice
            return (
                prefix +
                str.slice(0, availableLength) +
                `... (showing first items of ${count} total)`
            );
        }

        const str = typeof data === 'string' ? data : JSON.stringify(data);
        if (str.length <= maxLength) {
            return str;
        }
        return str.slice(0, maxLength) + '... (truncated)';
    } catch {
        return '[Unable to serialize output]';
    }
}

/**
 * Create the Planner Node
 */
export function createPlannerNode(config: PlannerNodeConfig) {
    const llmConfig = loadLLMConfig({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
    });

    const hasLlm = !!llmConfig.apiKey;
    let llm: ChatAnthropic | null = null;

    // Initialize Context Manager with optional LLM summarization
    const contextManager = new ContextManager({
        ...config.contextConfig,
        summaryApiKey: config.apiKey,
        summaryBaseUrl: config.baseUrl,
        summaryModel:
            config.contextConfig?.summaryModel || 'claude-3-haiku-20240307',
    });

    if (hasLlm) {
        log.info('Initializing Planner LLM', { model: llmConfig.model });

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
        const timer = startTimer(log, 'planner', traceContext ?? undefined);

        log.debugWithTrace(traceContext!, 'Planning next step', {
            goal: state.goal.substring(0, 50),
            iteration: state.iterationCount,
        });

        try {
            if (!hasLlm) {
                return {
                    status: 'error',
                    error: 'LLM not configured',
                    isComplete: true,
                    result: '❌ AI 未配置，请在设置中配置 API Key',
                };
            }

            // Get last action result (include execution output summary)
            const lastAction =
                state.actionHistory[state.actionHistory.length - 1];
            const lastActionResult = lastAction?.result
                ? {
                      step:
                          lastAction.reasoning ||
                          lastAction.thought ||
                          lastAction.tool,
                      success: lastAction.result.success,
                      error: lastAction.result.error,
                      outputSummary: summarizeOutput(lastAction.result.data),
                  }
                : undefined;

            // Build layered context using ContextManager
            const coercedHistory = state.messages.map(coerceToBaseMessage);
            const contextResult = await contextManager.buildContext(
                {
                    goal: state.goal,
                    lastActionResult,
                    conversationSummary: state.conversationSummary || undefined,
                    messages: coercedHistory,
                },
                PLANNER_SYSTEM_PROMPT
            );

            const { context, newSummary, summarizedMessageCount } =
                contextResult;

            // Log context building result
            log.infoWithTrace(traceContext!, '[PLANNER] Context built', {
                goal: state.goal,
                iteration: state.iterationCount,
                l1Length: context.contextSummary.length,
                l2Length: context.currentTaskMessage.length,
                l3MessageCount: context.recentMessages.length,
                hasSummarization: !!newSummary,
                summarizedCount: summarizedMessageCount,
            });

            // Build messages array with layered context
            // Combine L0 (system rules) and L1 (context summary) into a single SystemMessage
            // (Anthropic API only allows one system message at the beginning)
            let systemContent = context.systemRules;
            if (context.contextSummary.trim()) {
                systemContent += '\n\n---\n\n' + context.contextSummary;
            }

            const messages: BaseMessage[] = [
                new SystemMessage(systemContent), // L0 + L1 combined
            ];

            // Add L3: Recent conversation history (sliding window)
            messages.push(...context.recentMessages);

            // Add L2: Current task message
            messages.push(new HumanMessage(context.currentTaskMessage));

            // Debug: Print complete messages for troubleshooting
            log.debugWithTrace(
                traceContext!,
                '[PLANNER] Complete LLM Messages',
                {
                    messageCount: messages.length,
                    messages: messages.map((m, i) => ({
                        index: i,
                        role: m._getType(),
                        content:
                            typeof m.content === 'string'
                                ? m.content
                                : JSON.stringify(m.content),
                    })),
                }
            );

            // Log LLM request summary
            log.infoWithTrace(traceContext!, '[PLANNER] === LLM Request ===', {
                model: llmConfig.model,
                messageCount: messages.length,
                l0Length: context.systemRules.length,
                l1Length: context.contextSummary.length,
                l2Length: context.currentTaskMessage.length,
                l3Count: context.recentMessages.length,
            });

            const llmStartTime = Date.now();
            const response = await llm!.invoke(messages);
            const llmDuration = Date.now() - llmStartTime;

            const responseText =
                typeof response.content === 'string'
                    ? response.content
                    : JSON.stringify(response.content);

            // Log planner response for tracing
            log.infoWithTrace(traceContext!, '[PLANNER] LLM response', {
                responseLength: responseText.length,
                duration: llmDuration,
                responsePreview:
                    responseText.slice(0, 300) +
                    (responseText.length > 300 ? '...' : ''),
            });

            // Parse response
            const decision = parsePlannerResponse(responseText);

            if (!decision) {
                log.errorWithTrace(
                    traceContext!,
                    '[PLANNER] Failed to parse response',
                    {
                        responseText: responseText.slice(0, 500),
                    }
                );
                return {
                    status: 'error',
                    error: 'Failed to parse planner response',
                    consecutiveFailures: state.consecutiveFailures + 1,
                };
            }

            // Log parsed decision
            log.infoWithTrace(traceContext!, '[PLANNER] Decision parsed', {
                isComplete: decision.isComplete,
                needsMoreInfo: decision.needsMoreInfo,
                nextStep: decision.nextStep?.slice(0, 100),
                thought: decision.thought?.slice(0, 100),
            });

            // Build base state update with summary if generated
            const baseStateUpdate: Partial<AgentState> = {};
            if (newSummary) {
                baseStateUpdate.conversationSummary = newSummary;
                baseStateUpdate.summaryMessageCount =
                    (state.summaryMessageCount || 0) +
                    (summarizedMessageCount || 0);
            }

            // Handle completion
            if (decision.isComplete) {
                // Get last action's full data for complete result
                const completionLastAction =
                    state.actionHistory[state.actionHistory.length - 1];
                const fullData = completionLastAction?.result?.data;
                const fullDataMarkdown = formatFullDataAsMarkdown(fullData);

                // Combine completion message with full data if available
                let finalResult = decision.completionMessage || '✅ 任务完成';
                if (fullDataMarkdown) {
                    finalResult += fullDataMarkdown;
                }

                log.infoWithTrace(
                    traceContext!,
                    '[PLANNER] Task marked complete',
                    {
                        completionMessage: decision.completionMessage?.slice(
                            0,
                            200
                        ),
                        hasFullData: !!fullDataMarkdown,
                    }
                );
                timer.end('Task complete');
                return {
                    ...baseStateUpdate,
                    status: 'complete',
                    isComplete: true,
                    result: finalResult,
                    messages: [
                        ...coercedHistory,
                        new HumanMessage(context.currentTaskMessage),
                        new AIMessage(responseText),
                    ],
                };
            }

            // Handle needs more info
            if (decision.needsMoreInfo) {
                log.infoWithTrace(traceContext!, '[PLANNER] Needs more info', {
                    question: decision.question,
                });
                timer.end('Needs clarification');
                return {
                    ...baseStateUpdate,
                    status: 'complete',
                    isComplete: true,
                    result: `❓ ${decision.question || '请提供更多信息'}`,
                    messages: [
                        ...coercedHistory,
                        new HumanMessage(context.currentTaskMessage),
                        new AIMessage(responseText),
                    ],
                };
            }

            // Return next step for CodeAct to execute
            log.infoWithTrace(traceContext!, '[PLANNER] Output to CodeAct', {
                nextInstruction: decision.nextStep,
                thought: decision.thought?.slice(0, 150),
            });
            timer.end('Next step decided');
            // Note: Don't add messages here - intermediate steps don't need to be in conversation history
            // Messages are only added on completion (isComplete) or when asking for clarification (needsMoreInfo)
            return {
                ...baseStateUpdate,
                status: 'planning',
                // Store the next step instruction for CodeAct
                currentInstruction: decision.nextStep,
                plannerThought: decision.thought,
            };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Unknown error';
            log.errorWithTrace(traceContext!, 'Planner failed', {
                error: errorMessage,
            });

            return {
                status: 'error',
                error: `Planner failed: ${errorMessage}`,
                consecutiveFailures: state.consecutiveFailures + 1,
            };
        }
    };
}
