/**
 * Agent State
 *
 * Unified state definition for the multimodal orchestrator architecture.
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import type { BaseMessage } from '@langchain/core/messages';
import type {
    MultimodalMessage,
    ArtifactRef,
    SubAgentRequest,
    SubAgentResult,
} from '../multimodal';
import type { TraceContext } from '../tracing';

// ============================================================
// Reducer Functions
// ============================================================

/**
 * Append-only reducer for arrays
 */
function appendReducer<T>(
    existing: T[] | undefined,
    update: T[] | undefined
): T[] {
    if (!update) return existing || [];
    if (!existing) return update;
    return [...existing, ...update];
}

/**
 * Merge reducer for records
 */
function mergeReducer<T extends Record<string, unknown>>(
    existing: T | undefined,
    update: T | undefined
): T {
    if (!update) return existing || ({} as T);
    if (!existing) return update;
    return { ...existing, ...update };
}

// ============================================================
// State Annotation
// ============================================================

/**
 * Agent State Annotation
 *
 * Defines the state shape with proper reducers for LangGraph.
 */
export const AgentStateAnnotation = Annotation.Root({
    // ============ Input ============
    /** Original user input (multimodal) */
    inputMessage: Annotation<MultimodalMessage>(),

    /** Extracted goal text */
    goal: Annotation<string>(),

    // ============ Orchestration ============
    /** Current execution status */
    status: Annotation<AgentStatus>({
        default: () => 'initializing',
    }),

    /** Pending SubAgent request (set by orchestrator) */
    pendingSubAgentRequest: Annotation<SubAgentRequest | undefined>(),

    /** Last SubAgent result (set by executor) */
    lastSubAgentResult: Annotation<SubAgentResult | undefined>(),

    /** Current iteration count */
    iterationCount: Annotation<number>({
        default: () => 0,
        reducer: (existing, update) => update ?? existing ?? 0,
    }),

    // ============ Outputs ============
    /** Output messages from SubAgents */
    outputMessages: Annotation<MultimodalMessage[]>({
        default: () => [],
        reducer: appendReducer,
    }),

    /** Generated artifacts */
    artifacts: Annotation<ArtifactRef[]>({
        default: () => [],
        reducer: appendReducer,
    }),

    /** Final result (when complete) */
    result: Annotation<string | undefined>(),

    // ============ Execution Variables ============
    /** Variables shared across SubAgent executions */
    executionVariables: Annotation<Record<string, unknown>>({
        default: () => ({}),
        reducer: mergeReducer,
    }),

    // ============ Error Handling ============
    /** Whether execution is complete */
    isComplete: Annotation<boolean>({
        default: () => false,
    }),

    /** Error message (if any) */
    error: Annotation<string | undefined>(),

    // ============ LangGraph Messages (for compatibility) ============
    /** LangGraph messages for checkpointing */
    messages: Annotation<BaseMessage[]>({
        default: () => [],
        reducer: messagesStateReducer,
    }),

    // ============ Tracing ============
    /** Trace context for logging */
    traceContext: Annotation<TraceContext | undefined>(),
});

/**
 * Agent State type alias
 */
export type AgentState = typeof AgentStateAnnotation.State;

/**
 * Agent status values
 */
export type AgentStatus =
    | 'initializing'
    | 'orchestrating'
    | 'executing'
    | 'complete'
    | 'error';

// ============================================================
// State Helpers
// ============================================================

/**
 * Create initial state from user input
 */
export function createInitialState(
    inputMessage: MultimodalMessage,
    goal?: string,
    traceContext?: TraceContext
): Partial<AgentState> {
    // Extract goal from input if not provided
    const extractedGoal =
        goal ||
        inputMessage.text ||
        inputMessage.content
            .filter((c) => c.type === 'text')
            .map((c) => (c as { text: string }).text)
            .join('\n');

    return {
        inputMessage,
        goal: extractedGoal,
        status: 'initializing',
        iterationCount: 0,
        outputMessages: [],
        artifacts: [],
        executionVariables: {},
        isComplete: false,
        messages: [],
        traceContext,
    };
}

/**
 * Check if state indicates task is complete
 */
export function isTaskComplete(state: AgentState): boolean {
    return (
        state.isComplete ||
        state.status === 'complete' ||
        state.status === 'error'
    );
}

/**
 * Get a summary of the current state
 */
export function getStateSummary(state: AgentState): {
    status: AgentStatus;
    iterationCount: number;
    outputCount: number;
    artifactCount: number;
    isComplete: boolean;
    hasError: boolean;
} {
    return {
        status: state.status,
        iterationCount: state.iterationCount,
        outputCount: state.outputMessages?.length || 0,
        artifactCount: state.artifacts?.length || 0,
        isComplete: state.isComplete,
        hasError: !!state.error,
    };
}

