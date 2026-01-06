/**
 * SubAgent Executor Node
 *
 * Executes the SubAgent selected by the Orchestrator.
 * Handles context setup, execution, and result processing.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import { ChatAnthropic } from '@langchain/anthropic';
import type { AgentStateV3 } from './state';
import type {
    ISubAgentV3,
    ISubAgentRegistryV3,
    SubAgentContext,
    SubAgentResult,
} from '../multimodal';
import { ArtifactManager } from '../multimodal';
import { createAgentLogger, startTimer } from '../tracing';

const log = createAgentLogger('ExecutorNode');

// ============================================================
// Types
// ============================================================

/**
 * Configuration for the Executor Node
 */
export interface ExecutorNodeConfig {
    /** SubAgent registry */
    subAgentRegistry: ISubAgentRegistryV3;
    /** Browser adapter */
    browserAdapter: IBrowserAdapter;
    /** Artifact manager */
    artifactManager: ArtifactManager;
    /** LLM API key */
    apiKey: string;
    /** LLM base URL */
    baseUrl?: string;
    /** LLM model */
    model?: string;
    /** Default execution timeout in ms */
    defaultTimeout?: number;
}

// ============================================================
// Implementation
// ============================================================

/**
 * Create the SubAgent Executor Node
 */
export function createExecutorNode(config: ExecutorNodeConfig) {
    const {
        subAgentRegistry,
        browserAdapter,
        artifactManager,
        apiKey,
        baseUrl,
        model = 'claude-sonnet-4-20250514',
        defaultTimeout = 300000, // 5 minutes
    } = config;

    // Create shared LLM instance
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
        const timer = startTimer(log, 'executor', traceContext ?? undefined);

        // Check if there's a pending request
        if (!state.pendingSubAgentRequest) {
            log.warnWithTrace(
                traceContext!,
                '[EXECUTOR] No pending request'
            );
            timer.end('No pending request');
            return {
                status: 'error',
                error: 'No pending SubAgent request',
            };
        }

        const request = state.pendingSubAgentRequest;

        log.infoWithTrace(traceContext!, '[EXECUTOR] Executing SubAgent', {
            agentName: request.agentName,
            requestId: request.id,
        });

        try {
            // Find the SubAgent
            const subAgent = subAgentRegistry.findByName(request.agentName);
            if (!subAgent) {
                timer.end('SubAgent not found');
                return {
                    lastSubAgentResult: createErrorResult(
                        `SubAgent not found: ${request.agentName}`,
                        0
                    ),
                    pendingSubAgentRequest: undefined,
                    status: 'orchestrating',
                };
            }

            // Verify SubAgent can handle the request
            if (!subAgent.canHandle(request)) {
                timer.end('SubAgent cannot handle request');
                return {
                    lastSubAgentResult: createErrorResult(
                        `SubAgent ${request.agentName} cannot handle this request`,
                        0
                    ),
                    pendingSubAgentRequest: undefined,
                    status: 'orchestrating',
                };
            }

            // Build execution context
            const context: SubAgentContext = {
                artifactManager,
                browserAdapter,
                llm,
                variables: state.executionVariables || {},
                traceId: traceContext?.traceId,
                sessionArtifacts: state.artifacts || [],
                messageHistory: state.outputMessages || [],
            };

            // Execute with timeout
            const timeout = request.options?.timeout || defaultTimeout;
            const result = await executeWithTimeout(
                subAgent,
                request,
                context,
                timeout
            );

            log.infoWithTrace(traceContext!, '[EXECUTOR] Execution complete', {
                success: result.success,
                duration: result.duration,
                artifactCount: result.artifacts.length,
            });

            timer.end(
                result.success
                    ? `Success in ${result.duration}ms`
                    : `Failed: ${result.error}`
            );

            return {
                lastSubAgentResult: result,
                pendingSubAgentRequest: undefined,
                status: 'orchestrating',
            };
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : String(error);
            log.errorWithTrace(traceContext!, '[EXECUTOR] Error', {
                error: errorMsg,
            });
            timer.end(`Error: ${errorMsg}`);

            return {
                lastSubAgentResult: createErrorResult(errorMsg, 0),
                pendingSubAgentRequest: undefined,
                status: 'orchestrating',
            };
        }
    };
}

/**
 * Execute SubAgent with timeout
 */
async function executeWithTimeout(
    subAgent: ISubAgentV3,
    request: Parameters<ISubAgentV3['execute']>[0],
    context: SubAgentContext,
    timeout: number
): Promise<SubAgentResult> {
    const startTime = Date.now();

    const timeoutPromise = new Promise<SubAgentResult>((_, reject) =>
        setTimeout(() => reject(new Error('Execution timeout')), timeout)
    );

    try {
        const result = await Promise.race([
            subAgent.execute(request, context),
            timeoutPromise,
        ]);
        return result;
    } catch (error) {
        const duration = Date.now() - startTime;
        return createErrorResult(
            error instanceof Error ? error.message : 'Unknown error',
            duration
        );
    }
}

/**
 * Create an error result
 */
function createErrorResult(error: string, duration: number): SubAgentResult {
    return {
        success: false,
        output: {
            id: `error_${Date.now()}`,
            text: error,
            content: [{ type: 'text', text: error }],
            timestamp: new Date(),
            source: 'subagent',
        },
        artifacts: [],
        error,
        duration,
    };
}

// ============================================================
// Routing Functions
// ============================================================

/**
 * Route after orchestrator node
 * - If there's a pending request, go to executor
 * - If complete or error, end
 * - Otherwise, continue to orchestrator (shouldn't happen)
 */
export function routeAfterOrchestrator(
    state: AgentStateV3
): 'executor' | 'end' {
    if (state.isComplete || state.status === 'error') {
        return 'end';
    }

    if (state.pendingSubAgentRequest) {
        return 'executor';
    }

    // Shouldn't reach here - orchestrator should always set a request or complete
    return 'end';
}

/**
 * Route after executor node
 * - Always return to orchestrator for next decision
 */
export function routeAfterExecutor(
    _state: AgentStateV3
): 'orchestrator' {
    return 'orchestrator';
}

