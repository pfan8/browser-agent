/**
 * SubAgent Types V3
 *
 * New SubAgent interface with full multimodal support.
 * SubAgents can both consume and produce multimodal content.
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { ChatAnthropic } from '@langchain/anthropic';
import type {
    MultimodalMessage,
    ContentBlock,
    ContentBlockType,
    ArtifactRef,
} from './types';
import type { ArtifactManager } from './artifact-manager';

// ============================================================
// SubAgent Request/Response Types
// ============================================================

/**
 * Request to execute a SubAgent
 */
export interface SubAgentRequest {
    /** Unique request ID */
    id: string;

    /** Target SubAgent name */
    agentName: string;

    /** Input message (multimodal) */
    input: MultimodalMessage;

    /** Execution options */
    options?: SubAgentOptions;
}

/**
 * Options for SubAgent execution
 */
export interface SubAgentOptions {
    /** Execution timeout in ms */
    timeout?: number;

    /** Custom parameters for the SubAgent */
    params?: Record<string, unknown>;

    /** Whether to generate artifacts */
    generateArtifacts?: boolean;

    /** Output format preferences */
    outputFormat?: string;
}

/**
 * Result from SubAgent execution
 */
export interface SubAgentResult {
    /** Whether execution succeeded */
    success: boolean;

    /** Output message (multimodal) */
    output: MultimodalMessage;

    /** Generated artifacts */
    artifacts: ArtifactRef[];

    /** Error message (if failed) */
    error?: string;

    /** Execution duration in ms */
    duration: number;

    /** Whether this result needs follow-up processing */
    needsFollowUp?: boolean;

    /** Suggested next SubAgent to call */
    suggestedNextAgent?: string;

    /** Updated variables (for state propagation) */
    updatedVariables?: Record<string, unknown>;
}

// ============================================================
// Stream Events
// ============================================================

/**
 * Events emitted during streaming execution
 */
export type StreamEvent =
    | ThinkingEvent
    | ProgressEvent
    | ArtifactEvent
    | PartialResultEvent;

export interface ThinkingEvent {
    type: 'thinking';
    thought: string;
}

export interface ProgressEvent {
    type: 'progress';
    percentage: number;
    message: string;
}

export interface ArtifactEvent {
    type: 'artifact';
    artifact: ArtifactRef;
}

export interface PartialResultEvent {
    type: 'partial';
    content: ContentBlock;
}

// ============================================================
// SubAgent Context
// ============================================================

/**
 * Context provided to SubAgents during execution
 */
export interface SubAgentContext {
    /** Artifact manager for file operations */
    artifactManager: ArtifactManager;

    /** Browser adapter for browser operations */
    browserAdapter: IBrowserAdapter;

    /** LLM instance */
    llm: ChatAnthropic;

    /** Current execution variables */
    variables: Record<string, unknown>;

    /** Trace ID for logging */
    traceId?: string;

    /** All artifacts created in this session */
    sessionArtifacts: ArtifactRef[];

    /** Previous messages in the conversation */
    messageHistory: MultimodalMessage[];
}

// ============================================================
// ISubAgent Interface V3
// ============================================================

/**
 * SubAgent interface with full multimodal support
 */
export interface ISubAgentV3 {
    /** Unique name identifying this SubAgent */
    readonly name: string;

    /** Human-readable description */
    readonly description: string;

    /** Content types this SubAgent can accept as input */
    readonly inputTypes: ContentBlockType[];

    /** Content types this SubAgent can produce as output */
    readonly outputTypes: ContentBlockType[];

    /** Priority for matching (higher = checked first) */
    readonly priority?: number;

    /**
     * Check if this SubAgent can handle the given request
     */
    canHandle(request: SubAgentRequest): boolean;

    /**
     * Execute the SubAgent
     */
    execute(
        request: SubAgentRequest,
        context: SubAgentContext
    ): Promise<SubAgentResult>;

    /**
     * Stream execution (optional)
     * Returns an async generator that yields events and finally returns the result
     */
    executeStream?(
        request: SubAgentRequest,
        context: SubAgentContext
    ): AsyncGenerator<StreamEvent, SubAgentResult>;

    /**
     * Estimate execution time in ms (optional, for planning)
     */
    estimateTime?(request: SubAgentRequest): number;

    /**
     * Initialize the SubAgent (optional)
     */
    initialize?(): Promise<void>;

    /**
     * Cleanup resources (optional)
     */
    cleanup?(): Promise<void>;
}

// ============================================================
// SubAgent Registry V3
// ============================================================

/**
 * Registry for managing SubAgents
 */
export interface ISubAgentRegistryV3 {
    /**
     * Register a SubAgent
     */
    register(agent: ISubAgentV3): void;

    /**
     * Unregister a SubAgent by name
     */
    unregister(name: string): boolean;

    /**
     * Get all registered SubAgents
     */
    getAll(): ISubAgentV3[];

    /**
     * Find a SubAgent by name
     */
    findByName(name: string): ISubAgentV3 | null;

    /**
     * Find a SubAgent that can handle the given request
     */
    findForRequest(request: SubAgentRequest): ISubAgentV3 | null;

    /**
     * Find SubAgents that support a specific input type
     */
    findByInputType(type: ContentBlockType): ISubAgentV3[];

    /**
     * Find SubAgents that can produce a specific output type
     */
    findByOutputType(type: ContentBlockType): ISubAgentV3[];
}

// ============================================================
// Base SubAgent Implementation
// ============================================================

/**
 * Base class for SubAgent implementations
 */
export abstract class BaseSubAgent implements ISubAgentV3 {
    abstract readonly name: string;
    abstract readonly description: string;
    abstract readonly inputTypes: ContentBlockType[];
    abstract readonly outputTypes: ContentBlockType[];
    readonly priority?: number;

    /**
     * Default canHandle - checks if input contains supported types
     */
    canHandle(request: SubAgentRequest): boolean {
        const inputTypes = request.input.content.map((c) => c.type);
        return inputTypes.some((t) => this.inputTypes.includes(t));
    }

    abstract execute(
        request: SubAgentRequest,
        context: SubAgentContext
    ): Promise<SubAgentResult>;

    /**
     * Helper to create a success result
     */
    protected createSuccessResult(
        output: MultimodalMessage,
        artifacts: ArtifactRef[],
        duration: number,
        options?: Partial<SubAgentResult>
    ): SubAgentResult {
        return {
            success: true,
            output,
            artifacts,
            duration,
            ...options,
        };
    }

    /**
     * Helper to create an error result
     */
    protected createErrorResult(
        error: string,
        duration: number
    ): SubAgentResult {
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
}

// ============================================================
// SubAgent Registry Implementation
// ============================================================

/**
 * Default implementation of SubAgent registry
 */
export class SubAgentRegistryV3 implements ISubAgentRegistryV3 {
    private agents: Map<string, ISubAgentV3> = new Map();

    register(agent: ISubAgentV3): void {
        if (this.agents.has(agent.name)) {
            console.warn(`[SubAgentRegistry] Replacing agent: ${agent.name}`);
        }
        this.agents.set(agent.name, agent);
    }

    unregister(name: string): boolean {
        return this.agents.delete(name);
    }

    getAll(): ISubAgentV3[] {
        return Array.from(this.agents.values()).sort(
            (a, b) => (b.priority || 0) - (a.priority || 0)
        );
    }

    findByName(name: string): ISubAgentV3 | null {
        return this.agents.get(name) || null;
    }

    findForRequest(request: SubAgentRequest): ISubAgentV3 | null {
        // If agent name is specified, find by name
        if (request.agentName) {
            const agent = this.findByName(request.agentName);
            if (agent && agent.canHandle(request)) {
                return agent;
            }
        }

        // Otherwise, find first agent that can handle the request
        const sortedAgents = this.getAll();
        for (const agent of sortedAgents) {
            if (agent.canHandle(request)) {
                return agent;
            }
        }

        return null;
    }

    findByInputType(type: ContentBlockType): ISubAgentV3[] {
        return this.getAll().filter((a) => a.inputTypes.includes(type));
    }

    findByOutputType(type: ContentBlockType): ISubAgentV3[] {
        return this.getAll().filter((a) => a.outputTypes.includes(type));
    }
}

/**
 * Create a new SubAgent registry
 */
export function createSubAgentRegistryV3(): ISubAgentRegistryV3 {
    return new SubAgentRegistryV3();
}

