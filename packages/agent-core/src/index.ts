/**
 * Agent Core Package
 *
 * LangGraph-based browser automation agent with multimodal orchestrator architecture.
 *
 * Architecture:
 *   START ──► Orchestrator ──► Executor ──► Orchestrator ──► ... ──► END
 *
 * The Orchestrator (LLM-driven) decides which SubAgent to call.
 * The Executor runs the selected SubAgent and returns results.
 */

// ============================================================
// Graph and Agent
// ============================================================

export {
    createGraph,
    type GraphConfig,
    type CompiledGraph,
    type ExecuteOptions,
    type GraphEvent,
    // Re-exports from graph
    AgentStateAnnotation,
    type AgentState,
    type AgentStatus,
    type MultimodalMessage,
    type ContentBlock,
    type ArtifactRef,
    createTextMessage,
    createMultimodalMessage,
    type ISubAgent,
    type ISubAgentRegistry,
    type SubAgentRequest,
    type SubAgentResult,
} from './graph';

// BrowserAgent wrapper
export { BrowserAgent, type BrowserAgentConfig } from './browser-agent';

// ============================================================
// Orchestrator Layer
// ============================================================

export {
    // State
    createInitialState,
    isTaskComplete,
    getStateSummary,
    // Orchestrator Node
    type OrchestratorNodeConfig,
    type OrchestratorDecision,
    createOrchestratorNode,
    // Executor Node
    type ExecutorNodeConfig,
    createExecutorNode,
    routeAfterOrchestrator,
    routeAfterExecutor,
} from './orchestrator';

// ============================================================
// Multimodal Types and Utilities
// ============================================================

export {
    // Content types
    type ContentBlockType,
    type TextBlock,
    type ImageBlock,
    type AudioBlock,
    type VideoBlock,
    type FileBlock,
    type CodeBlock,
    type ArtifactType,
    // Helpers
    extractText,
    extractBlocks,
    hasContentType,
    getContentTypes,
    generateArtifactId,
    // Artifact Manager
    type ArtifactManagerConfig,
    ArtifactManager,
    createArtifactManager,
    // SubAgent types
    type SubAgentOptions,
    type StreamEvent,
    type ThinkingEvent,
    type ProgressEvent,
    type ArtifactEvent,
    type PartialResultEvent,
    type SubAgentContext,
    BaseSubAgent,
    SubAgentRegistry,
    createSubAgentRegistry,
} from './multimodal';

// ============================================================
// SubAgents
// ============================================================

export {
    // CodeAct SubAgent
    type CodeActSubAgentConfig,
    CodeActSubAgent,
    createCodeActSubAgent,
    // Vision SubAgent
    type VisionSubAgentConfig,
    VisionSubAgent,
    createVisionSubAgent,
} from './subagents';

// ============================================================
// Planner (for Beads integration)
// ============================================================

export {
    createPlannerNode,
    createBeadsPlannerNode,
    type PlannerNodeConfig,
    type BeadsPlannerNodeConfig,
    type PlanStep,
    type Plan,
    type PlannerDecision,
    type PlannerObservation,
    type PlannerHistoryEntry,
    // Beads planning prompts/utils
    PLANNER_INITIAL_SYSTEM_PROMPT,
    buildInitialPlanningMessage,
    buildProgressUpdateMessage,
    parseInitialPlanningResponse,
    findMergeableGroups,
    mergeTaskTitles,
} from './planner';

// ============================================================
// CodeAct Node (ReAct loop)
// ============================================================

export {
    createCodeActNode,
    type CodeActNodeConfig,
    type CodeAction,
    type CodeResult,
    type CodeActDecision,
    type CodeActConfig,
    type ExecutionMode,
} from './codeact';

// ============================================================
// Router (for Beads task dispatch)
// ============================================================

export { createRouterNode, type RouterNodeConfig } from './router';

// ============================================================
// Beads Task Management
// ============================================================

export {
    // Types
    type BeadsTask,
    type BeadsTaskStatus,
    type BeadsPriority,
    type BeadsEpic,
    type BeadsTaskUI,
    type BeadsPlannerOutput,
    type BeadsPlannerTask,
    type CreateTaskOptions,
    type ListTasksFilter,
    type BeadsOperationResult,
    // Client interface
    type IBeadsClient,
    type BeadsClientFactory,
    // CLI adapter
    BeadsCliAdapter,
    createBeadsCliAdapter,
} from './beads';

// ============================================================
// Context Management
// ============================================================

export {
    ContextManager,
    LLMSummarizer,
    RuleBasedSummarizer,
    createSummarizer,
    DEFAULT_CONTEXT_CONFIG,
    type ContextConfig,
    type LayeredContext,
    type BuildContextInput,
    type BuildContextResult,
    type ISummarizer,
    type SummarizerConfig,
} from './context';

// ============================================================
// Configuration
// ============================================================

export {
    loadLLMConfig,
    getConfigPath,
    clearConfigCache,
    createSampleConfig,
    DEFAULT_LLM_CONFIG,
    type LLMConfig,
    type LLMProvider,
} from './config';

// ============================================================
// Legacy State (for backwards compatibility)
// ============================================================

export {
    // Legacy state types (also exported without prefix for compat)
    type AgentState as LegacyAgentState,
    type AgentAction,
    type Observation,
    type AgentConfig,
    type VariableSummary,
    AgentStateAnnotation as LegacyAgentStateAnnotation,
    DEFAULT_AGENT_CONFIG,
    // State utilities
    computeActionSignature,
    isRepeatedAction,
    updateActionSignature,
    computeContentHash,
    hasPageChanged,
    buildFailureReport,
} from './state';

// ============================================================
// Tracing
// ============================================================

export {
    type TraceContext,
    type SpanEvent,
    type CompletedSpan,
    type LogLevel,
    type LogLayer,
    type StructuredLogEntry,
    type AgentLoggerConfig,
    type ModuleAgentLogger,
    type OperationTimer,
    type LangSmithConfig,
    generateTraceId,
    generateSpanId,
    createTraceContext,
    createChildSpan,
    completeSpan,
    createSpanEvent,
    extractTraceHeaders,
    parseTraceHeaders,
    formatTraceContext,
    configureAgentLogger,
    setTraceContext,
    getTraceContext,
    createAgentLogger,
    startTimer,
    // LangSmith
    getLangSmithConfig,
    isLangSmithEnabled,
    initLangSmith,
    getLangSmithEnvVars,
    LANGSMITH_SETUP_INSTRUCTIONS,
} from './tracing';
