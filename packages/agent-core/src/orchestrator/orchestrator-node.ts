/**
 * Orchestrator Node
 *
 * LLM-driven decision center that determines which SubAgent to call next.
 * Analyzes current state and multimodal content to make intelligent routing decisions.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { AgentStateV3 } from './state';
import type {
    ISubAgentV3,
    ISubAgentRegistryV3,
    SubAgentRequest,
} from '../multimodal';
import {
    extractText,
    getContentTypes,
    createTextMessage,
} from '../multimodal';
import { createAgentLogger, startTimer } from '../tracing';

const log = createAgentLogger('OrchestratorNode');

// ============================================================
// Types
// ============================================================

/**
 * Configuration for the Orchestrator Node
 */
export interface OrchestratorNodeConfig {
    /** LLM API key */
    apiKey: string;
    /** LLM base URL */
    baseUrl?: string;
    /** LLM model */
    model?: string;
    /** SubAgent registry */
    subAgentRegistry: ISubAgentRegistryV3;
    /** Maximum decision iterations before forcing completion */
    maxIterations?: number;
}

/**
 * Decision made by the Orchestrator
 */
export interface OrchestratorDecision {
    /** Action to take */
    action: 'call_subagent' | 'complete' | 'error';
    /** SubAgent request (if action is call_subagent) */
    request?: SubAgentRequest;
    /** Reasoning for the decision */
    reasoning: string;
    /** Final result (if action is complete) */
    result?: string;
    /** Error message (if action is error) */
    error?: string;
}

// ============================================================
// Prompts
// ============================================================

const ORCHESTRATOR_SYSTEM_PROMPT = `You are an intelligent orchestrator for a browser automation agent.
Your role is to analyze the current state and decide which SubAgent to call next.

## Available SubAgents
You will be given a list of available SubAgents with their capabilities.
Choose the most appropriate one based on the current state and goal.

## Decision Process
1. Analyze what has been accomplished so far
2. Identify what still needs to be done
3. Choose the best SubAgent for the next step
4. If the task is complete, indicate completion

## Output Format
You MUST respond with a valid JSON object:

For calling a SubAgent:
{
    "action": "call_subagent",
    "agentName": "subagent_name",
    "reasoning": "Why this SubAgent is needed",
    "inputText": "Instructions for the SubAgent"
}

For completing the task:
{
    "action": "complete",
    "reasoning": "Why the task is complete",
    "result": "Summary of what was accomplished"
}

For errors:
{
    "action": "error",
    "reasoning": "What went wrong",
    "error": "Error description"
}`;

// ============================================================
// Implementation
// ============================================================

/**
 * Create the Orchestrator Node
 */
export function createOrchestratorNode(config: OrchestratorNodeConfig) {
    const {
        apiKey,
        baseUrl,
        model = 'claude-sonnet-4-20250514',
        subAgentRegistry,
        maxIterations = 20,
    } = config;

    // Initialize LLM
    const llmOptions: Record<string, unknown> = {
        anthropicApiKey: apiKey,
        modelName: model,
    };
    if (baseUrl) {
        llmOptions.anthropicApiUrl = baseUrl;
    }
    const llm = new ChatAnthropic(llmOptions);

    return async (state: AgentStateV3): Promise<Partial<AgentStateV3>> => {
        const traceContext = state.traceContext;
        const timer = startTimer(log, 'orchestrator', traceContext ?? undefined);

        log.infoWithTrace(traceContext!, '[ORCHESTRATOR] Starting decision', {
            hasLastResult: !!state.lastSubAgentResult,
            messageCount: state.outputMessages?.length || 0,
            iterationCount: state.iterationCount,
        });

        try {
            // Check iteration limit
            if (state.iterationCount >= maxIterations) {
                timer.end('Max iterations reached');
                return {
                    isComplete: true,
                    error: 'Maximum orchestrator iterations reached',
                    status: 'error',
                };
            }

            // Process last SubAgent result if present
            if (state.lastSubAgentResult) {
                const result = state.lastSubAgentResult;

                // Add result to output messages
                const updatedOutputs = [
                    ...(state.outputMessages || []),
                    result.output,
                ];

                // Add artifacts
                const updatedArtifacts = [
                    ...(state.artifacts || []),
                    ...result.artifacts,
                ];

                // Clear the pending result and continue
                if (!result.success) {
                    log.warnWithTrace(traceContext!, '[ORCHESTRATOR] SubAgent failed', {
                        error: result.error,
                    });
                }

                // Update state with result, then continue to decision
                state = {
                    ...state,
                    outputMessages: updatedOutputs,
                    artifacts: updatedArtifacts,
                    lastSubAgentResult: undefined,
                    executionVariables: {
                        ...state.executionVariables,
                        ...result.updatedVariables,
                    },
                };
            }

            // Make decision
            const decision = await makeDecision(
                state,
                llm,
                subAgentRegistry
            );

            log.infoWithTrace(traceContext!, '[ORCHESTRATOR] Decision made', {
                action: decision.action,
                reasoning: decision.reasoning.substring(0, 100),
            });

            if (decision.action === 'complete') {
                timer.end('Task complete');
                return {
                    isComplete: true,
                    result: decision.result,
                    status: 'complete',
                    outputMessages: state.outputMessages,
                    artifacts: state.artifacts,
                    lastSubAgentResult: undefined,
                };
            }

            if (decision.action === 'error') {
                timer.end('Error');
                return {
                    status: 'error',
                    error: decision.error,
                    lastSubAgentResult: undefined,
                };
            }

            if (decision.action === 'call_subagent' && decision.request) {
                timer.end(`Calling ${decision.request.agentName}`);
                return {
                    pendingSubAgentRequest: decision.request,
                    status: 'executing',
                    iterationCount: state.iterationCount + 1,
                    outputMessages: state.outputMessages,
                    artifacts: state.artifacts,
                    lastSubAgentResult: undefined,
                };
            }

            // Fallback
            timer.end('No action');
            return {
                status: 'error',
                error: 'Orchestrator could not determine next action',
            };
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            log.errorWithTrace(traceContext!, '[ORCHESTRATOR] Error', { error: errorMsg });
            timer.end(`Error: ${errorMsg}`);
            return {
                status: 'error',
                error: `Orchestrator error: ${errorMsg}`,
            };
        }
    };
}

/**
 * Make a decision about what to do next
 */
async function makeDecision(
    state: AgentStateV3,
    llm: ChatAnthropic,
    registry: ISubAgentRegistryV3
): Promise<OrchestratorDecision> {
    // Build context for LLM
    const availableAgents = registry.getAll().map((agent) => ({
        name: agent.name,
        description: agent.description,
        inputTypes: agent.inputTypes,
        outputTypes: agent.outputTypes,
    }));

    const userPrompt = buildDecisionPrompt(state, availableAgents);

    // Call LLM
    const messages = [
        new SystemMessage(ORCHESTRATOR_SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
    ];

    const response = await llm.invoke(messages);
    const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

    // Parse response
    return parseDecision(responseText, state);
}

/**
 * Build the decision prompt
 */
function buildDecisionPrompt(
    state: AgentStateV3,
    availableAgents: Array<{
        name: string;
        description: string;
        inputTypes: string[];
        outputTypes: string[];
    }>
): string {
    const inputText = extractText(state.inputMessage);
    const inputTypes = getContentTypes(state.inputMessage);

    const completedSteps = (state.outputMessages || [])
        .map((msg, i) => `${i + 1}. ${extractText(msg).substring(0, 200)}`)
        .join('\n');

    const artifactSummary = (state.artifacts || [])
        .map((a) => `- ${a.type}: ${a.path}`)
        .join('\n');

    return `## User Goal
${inputText}

## Input Types
${inputTypes.join(', ')}

## Available SubAgents
${JSON.stringify(availableAgents, null, 2)}

## Completed Steps (${state.outputMessages?.length || 0} total)
${completedSteps || '(none yet)'}

## Generated Artifacts
${artifactSummary || '(none yet)'}

## Current Iteration
${state.iterationCount + 1}

Based on the above, decide the next action.`;
}

/**
 * Parse the LLM response into a decision
 */
function parseDecision(
    responseText: string,
    state: AgentStateV3
): OrchestratorDecision {
    try {
        // Extract JSON from response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return {
                action: 'error',
                reasoning: 'Could not parse LLM response',
                error: 'Invalid response format',
            };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.action === 'complete') {
            return {
                action: 'complete',
                reasoning: parsed.reasoning || '',
                result: parsed.result || 'Task completed',
            };
        }

        if (parsed.action === 'error') {
            return {
                action: 'error',
                reasoning: parsed.reasoning || '',
                error: parsed.error || 'Unknown error',
            };
        }

        if (parsed.action === 'call_subagent') {
            const request: SubAgentRequest = {
                id: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                agentName: parsed.agentName,
                input: createTextMessage(parsed.inputText || '', 'system'),
                options: parsed.options,
            };

            // If there are images in the original input and they haven't been processed,
            // pass them along
            if (
                state.inputMessage.content.some((c) => c.type === 'image') &&
                !state.outputMessages?.some((m) =>
                    m.content.some(
                        (c) => c.type === 'text' && c.text.includes('image')
                    )
                )
            ) {
                request.input = {
                    ...request.input,
                    content: [
                        ...request.input.content,
                        ...state.inputMessage.content.filter((c) => c.type === 'image'),
                    ],
                };
            }

            return {
                action: 'call_subagent',
                request,
                reasoning: parsed.reasoning || '',
            };
        }

        return {
            action: 'error',
            reasoning: 'Unknown action type',
            error: `Unknown action: ${parsed.action}`,
        };
    } catch (error) {
        return {
            action: 'error',
            reasoning: 'Failed to parse response',
            error: error instanceof Error ? error.message : 'Parse error',
        };
    }
}

