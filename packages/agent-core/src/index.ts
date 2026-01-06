/**
 * Agent Core Package
 *
 * LangGraph-based browser automation agent.
 * Uses a two-layer architecture:
 * - Planner: High-level task planning (doesn't know Playwright)
 * - CodeAct: Code generation and execution (knows Playwright API)
 */

// State types and utilities
export * from './state';

// Graph and agent
export {
    createAgentGraph,
    createBeadsAgentGraph,
    BrowserAgent,
    type AgentGraphConfig,
    type BeadsAgentGraphConfig,
    type BrowserAgentConfig,
} from './graph';

// Planner module
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

// CodeAct module
export {
    createCodeActNode,
    type CodeActNodeConfig,
    type CodeAction,
    type CodeResult,
    type CodeActDecision,
    type CodeActConfig,
    type ExecutionMode,
} from './codeact';

// Checkpointer
export {
    createCheckpointer,
    defaultCheckpointer,
    SqliteCheckpointer,
    PersistentCheckpointer,
    ThreadMetadataStore,
    type CheckpointerConfig,
    type CheckpointerType,
    type ThreadMetadata,
    type CheckpointHistoryItem,
} from './checkpointer';

// Memory module
export {
    // Store and Manager
    SqliteMemoryStore,
    MemoryManager,
    // Types
    type Memory,
    type MemoryNamespace,
    type MemoryImportance,
    type MemoryMetadata,
    type CreateMemoryInput,
    type UpdateMemoryInput,
    type MemorySearchOptions,
    type IMemoryStore,
    type MemoryStoreStats,
    type MemoryExtractionResult,
    type MemoryManagerConfig,
    type UserPreferencesMemory,
    type FactMemory,
    type TaskSummaryMemory,
    type LearnedPathMemory,
} from './memory';

// Context management module
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

// Configuration
export {
    loadLLMConfig,
    getConfigPath,
    clearConfigCache,
    createSampleConfig,
    DEFAULT_LLM_CONFIG,
    type LLMConfig,
    type LLMProvider,
} from './config';

// Beads task management
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

// Sub-agents
export {
    // Types
    type ISubAgent,
    type ISubAgentRegistry,
    type SubAgentTask,
    type SubAgentContext,
    type SubAgentResult,
    type SubAgentTaskType,
    type SubAgentConfig,
    DEFAULT_SUBAGENT_CONFIG,
    // Implementations
    CodeActSubAgent,
    createCodeActSubAgent,
    type CodeActAdapterConfig,
    SubAgentRegistry,
    createSubAgentRegistry,
} from './sub-agents';

// Router
export { createRouterNode, type RouterNodeConfig } from './router';

// Tracing
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

// ============================================================
// V3 Multimodal Orchestrator Architecture
// ============================================================

// Multimodal types and utilities
export {
    // Content types
    type ContentBlock,
    type ContentBlockType,
    type TextBlock,
    type ImageBlock,
    type AudioBlock,
    type VideoBlock,
    type FileBlock,
    type CodeBlock,
    type MultimodalMessage,
    type ArtifactType,
    type ArtifactRef,
    // Helpers
    createTextMessage,
    createMultimodalMessage,
    extractText,
    extractBlocks,
    hasContentType,
    getContentTypes,
    generateArtifactId,
    // Artifact Manager
    type ArtifactManagerConfig,
    ArtifactManager,
    createArtifactManager,
    // SubAgent types V3
    type SubAgentRequest,
    type SubAgentOptions,
    type SubAgentResult as SubAgentResultV3,
    type StreamEvent,
    type SubAgentContext as SubAgentContextV3,
    type ISubAgentV3,
    type ISubAgentRegistryV3,
    BaseSubAgent,
    SubAgentRegistryV3,
    createSubAgentRegistryV3,
} from './multimodal';

// Orchestrator (V3 Graph nodes)
export {
    // State
    AgentStateAnnotationV3,
    type AgentStateV3,
    type AgentStatusV3,
    createInitialStateV3,
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

// SubAgents V3
export {
    // CodeAct SubAgent
    type CodeActSubAgentConfig,
    CodeActSubAgentV3,
    createCodeActSubAgentV3,
    // Vision SubAgent
    type VisionSubAgentConfig,
    VisionSubAgentV3,
    createVisionSubAgentV3,
} from './subagents-v3';

// V3 Graph
export {
    createGraphV3,
    type GraphV3Config,
    type CompiledGraphV3,
    type ExecuteOptions,
    type GraphEvent,
} from './graph-v3';
