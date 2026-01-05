/**
 * Agent State Definition
 *
 * Defines the state annotation for the LangGraph agent.
 * Uses LangGraph's Annotation system for type-safe state management.
 * Supports RA (ReAct loop) and MS (Multi-Step task) requirements.
 */

import { Annotation, messagesStateReducer } from '@langchain/langgraph';
import { BaseMessage } from '@langchain/core/messages';
import { type TraceContext } from './tracing';

/**
 * Memory context injected from long-term memory
 */
export interface MemoryContext {
    /** User preferences summary */
    userPreferences?: string;
    /** Relevant facts for the current task */
    relevantFacts?: string[];
    /** Recent task summaries */
    recentTasks?: string[];
    /** Full context summary for prompt injection */
    contextSummary?: string;
}

/**
 * Variable summary for prompt injection
 * Used to inform LLM about available variables in state
 */
export interface VariableSummary {
    /** Variable name */
    name: string;
    /** JavaScript type of the value */
    type: string;
    /** Preview of the value (first 100 chars) */
    preview: string;
}

/**
 * Agent status enum (RA-05: loop termination states)
 */
export type AgentStatus =
    | 'idle'
    | 'observing'
    | 'planning' // Planner is deciding next step
    | 'executing' // CodeAct is generating/executing code
    | 'thinking' // Legacy: for backwards compatibility
    | 'acting' // Legacy: for backwards compatibility
    | 'complete'
    | 'error'
    | 'paused'
    | 'retrying' // ER-01, ER-02: retry state
    | 'waiting'; // MS-04: waiting for element

/**
 * Execution mode for CodeAct
 */
export type ExecutionMode = 'iterative' | 'script';

/**
 * Page load state for SA-01
 */
export type PageLoadState = 'loading' | 'interactive' | 'complete' | 'error';

/**
 * Tab information for multi-tab operations
 */
export interface TabInfo {
    index: number;
    url: string;
    title: string;
    active: boolean;
}

/**
 * Observation from the browser (RA-01, SA-*)
 */
export interface Observation {
    timestamp: string;
    url: string;
    title: string;
    content?: string;
    screenshot?: string;
    error?: string;
    // SA-01: Page load detection
    loadState?: PageLoadState;
    // SA-04: Intermediate state detection
    hasLoadingIndicator?: boolean;
    hasModalOverlay?: boolean;
    // SA-06: Page change detection
    contentHash?: string;
    previousUrl?: string;
    // Tab list cache - captured during observe to avoid repeated API calls
    tabs?: TabInfo[];
    tabCount?: number;
    // Last action result for context continuity
    lastActionResult?: {
        tool: string;
        success: boolean;
        data?: unknown;
        error?: string;
    };
}

/**
 * Action decided by the agent
 */
export interface AgentAction {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    thought: string;
    reasoning: string;
    timestamp: string;
    result?: ActionResult;
    // ER-01: Selector retry tracking
    selectorAttempts?: SelectorAttempt[];
    // ER-02: Retry tracking
    retryCount?: number;
    maxRetries?: number;
}

/**
 * Selector attempt for ER-01 fallback
 */
export interface SelectorAttempt {
    selector: string;
    strategy: 'css' | 'text' | 'testid' | 'role' | 'xpath';
    success: boolean;
    error?: string;
}

/**
 * Result of executing an action
 */
export interface ActionResult {
    success: boolean;
    data?: unknown;
    error?: string;
    duration: number;
    // SA-02: Verification result
    verified?: boolean;
    verificationDetails?: string;
}

/**
 * Task execution plan
 */
export interface TaskPlan {
    id: string;
    goal: string;
    steps: TaskStep[];
    currentStepIndex: number;
    status: 'active' | 'completed' | 'failed' | 'cancelled';
    createdAt: string;
    updatedAt: string;
}

/**
 * Individual step in a plan
 */
export interface TaskStep {
    id: string;
    description: string;
    tool: string;
    args: Record<string, unknown>;
    status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
    result?: ActionResult;
    retryCount: number;
}

/**
 * Agent configuration (PRD 3.6 parameters)
 */
export interface AgentConfig {
    // Loop control (RA-05, RA-06)
    maxIterations: number;
    maxConsecutiveFailures: number;
    // Timeout settings
    thinkTimeout: number;
    actionTimeout: number;
    observationTimeout: number;
    // Features
    enableScreenshots: boolean;
    // MS parameters (PRD 3.6)
    waitBetweenActions: number;
    maxRetryPerAction: number;
    enableSelectorFallback: boolean;
    enableScrollSearch: boolean;
    // RA-06: Loop detection
    maxRepeatedActions: number;
    // RA-08: Rule fallback
    enableRuleFallback: boolean;
    // CodeAct execution mode
    executionMode: ExecutionMode;
}

/**
 * Default agent configuration (PRD 3.6)
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
    maxIterations: 20,
    maxConsecutiveFailures: 3,
    thinkTimeout: 30000,
    actionTimeout: 30000,
    observationTimeout: 5000,
    enableScreenshots: false,
    waitBetweenActions: 500,
    maxRetryPerAction: 3,
    enableSelectorFallback: true,
    enableScrollSearch: true,
    maxRepeatedActions: 3,
    enableRuleFallback: true,
    executionMode: 'iterative',
};

/**
 * Action signature for loop detection (RA-06)
 */
export interface ActionSignature {
    tool: string;
    argsHash: string;
    count: number;
}

/**
 * Compute action signature hash
 */
export function computeActionSignature(
    tool: string,
    args: Record<string, unknown>
): string {
    return `${tool}:${JSON.stringify(args)}`;
}

/**
 * Agent State Annotation
 *
 * This defines the shape of the agent's state and how each field
 * should be updated when new values come in.
 * Supports RA (ReAct) and MS (Multi-Step) requirements.
 */
export const AgentStateAnnotation = Annotation.Root({
    // Messages history (uses built-in reducer for message merging)
    messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => [],
    }),

    // Current goal/task (SA-05: context preservation)
    goal: Annotation<string>({
        reducer: (_, newValue) => newValue,
        default: () => '',
    }),

    // Original goal for SA-05 context tracking
    originalGoal: Annotation<string>({
        reducer: (existing, newValue) => existing || newValue,
        default: () => '',
    }),

    // Current observation from browser (RA-01)
    observation: Annotation<Observation | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Previous observation for SA-06 change detection
    previousObservation: Annotation<Observation | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Action history
    actionHistory: Annotation<AgentAction[]>({
        reducer: (existing, newActions) => [...existing, ...newActions],
        default: () => [],
    }),

    // Current status
    status: Annotation<AgentStatus>({
        reducer: (_, newValue) => newValue,
        default: () => 'idle',
    }),

    // Iteration counter (RA-05)
    iterationCount: Annotation<number>({
        reducer: (_, newValue) => newValue,
        default: () => 0,
    }),

    // Consecutive failure counter (RA-07)
    consecutiveFailures: Annotation<number>({
        reducer: (_, newValue) => newValue,
        default: () => 0,
    }),

    // RA-06: Repeated action tracking for loop detection
    actionSignatures: Annotation<Map<string, number>>({
        reducer: (_, newValue) => newValue,
        default: () => new Map(),
    }),

    // RA-06: Flag for detected loop
    loopDetected: Annotation<boolean>({
        reducer: (_, newValue) => newValue,
        default: () => false,
    }),

    // Current plan (optional)
    plan: Annotation<TaskPlan | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // MS: Current step index for multi-step tasks
    currentStepIndex: Annotation<number>({
        reducer: (_, newValue) => newValue,
        default: () => 0,
    }),

    // MS: Completed steps for progress tracking
    completedSteps: Annotation<string[]>({
        reducer: (existing, newSteps) => [...existing, ...newSteps],
        default: () => [],
    }),

    // Final result message
    result: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Error message if any
    error: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Flag to indicate completion (RA-05)
    isComplete: Annotation<boolean>({
        reducer: (_, newValue) => newValue,
        default: () => false,
    }),

    // RA-08: Flag indicating LLM is unavailable
    useFallbackRules: Annotation<boolean>({
        reducer: (_, newValue) => newValue,
        default: () => false,
    }),

    // Trace context for distributed tracing
    traceContext: Annotation<TraceContext | null>({
        reducer: (existing, newValue) => newValue ?? existing,
        default: () => null,
    }),

    // CodeAct: Current instruction from Planner for CodeAct to execute
    currentInstruction: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // CodeAct: Planner's thought/reasoning for current step
    plannerThought: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // CodeAct: Execution mode
    executionMode: Annotation<ExecutionMode>({
        reducer: (_, newValue) => newValue,
        default: () => 'iterative',
    }),

    // Long-term memory context
    memoryContext: Annotation<MemoryContext | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Session/thread ID for session continuity
    threadId: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Context management: compressed conversation summary
    conversationSummary: Annotation<string | null>({
        reducer: (_, newValue) => newValue,
        default: () => null,
    }),

    // Context management: count of messages included in summary
    summaryMessageCount: Annotation<number>({
        reducer: (_, newValue) => newValue,
        default: () => 0,
    }),

    // CodeAct: Persistent execution variables across code executions
    // Variables stored here are accessible via `state` object in generated code
    // Uses replace strategy (not merge) to properly handle variable deletions
    executionVariables: Annotation<Record<string, unknown>>({
        reducer: (existing, newVars) => {
            // If newVars is undefined/null, keep existing state
            if (newVars === undefined || newVars === null) return existing;
            // Replace entirely to handle variable deletions properly
            // The executor returns the complete updated state object
            return newVars;
        },
        default: () => ({}),
    }),

    // CodeAct: Variable summary for prompt injection
    // Informs LLM about available variables in state
    variableSummary: Annotation<VariableSummary[]>({
        reducer: (existing, newValue) => {
            // If newValue is undefined/null, keep existing summary
            if (newValue === undefined || newValue === null) return existing;
            return newValue;
        },
        default: () => [],
    }),

    // ============================================
    // Beads Task Management
    // ============================================

    // Beads: Current epic ID (top-level task group)
    beadsEpicId: Annotation<string | null>({
        reducer: (existing, newValue) => {
            // Preserve existing value when not explicitly updated
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => null,
    }),

    // Beads: Currently executing task ID
    beadsCurrentTaskId: Annotation<string | null>({
        reducer: (existing, newValue) => {
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => null,
    }),

    // Beads: Total number of tasks created for current epic
    beadsTaskCount: Annotation<number>({
        reducer: (existing, newValue) => {
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => 0,
    }),

    // Beads: Number of completed tasks
    beadsCompletedCount: Annotation<number>({
        reducer: (existing, newValue) => {
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => 0,
    }),

    // Beads: IDs of tasks that are ready (no blockers)
    beadsReadyTaskIds: Annotation<string[]>({
        reducer: (existing, newValue) => {
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => [],
    }),

    // Beads: Whether initial planning is complete
    beadsPlanningComplete: Annotation<boolean>({
        reducer: (existing, newValue) => {
            if (newValue === undefined) return existing;
            return newValue;
        },
        default: () => false,
    }),
});

/**
 * Type alias for the agent state
 */
export type AgentState = typeof AgentStateAnnotation.State;

/**
 * Generate a unique ID
 */
export function generateId(prefix: string = 'id'): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
}

/**
 * Check if action is a repeated loop (RA-06)
 */
export function isRepeatedAction(
    signatures: Map<string, number>,
    tool: string,
    args: Record<string, unknown>,
    maxRepeats: number
): boolean {
    const sig = computeActionSignature(tool, args);
    const count = signatures.get(sig) || 0;
    return count >= maxRepeats;
}

/**
 * Update action signature count (RA-06)
 */
export function updateActionSignature(
    signatures: Map<string, number>,
    tool: string,
    args: Record<string, unknown>
): Map<string, number> {
    const newSigs = new Map(signatures);
    const sig = computeActionSignature(tool, args);
    newSigs.set(sig, (newSigs.get(sig) || 0) + 1);
    return newSigs;
}

/**
 * Compute content hash for change detection (SA-06)
 */
export function computeContentHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return hash.toString(16);
}

/**
 * Check if page content changed (SA-06)
 */
export function hasPageChanged(
    current: Observation | null,
    previous: Observation | null
): boolean {
    if (!previous || !current) return true;

    // URL changed
    if (current.url !== previous.url) return true;

    // Content hash changed (if available)
    if (current.contentHash && previous.contentHash) {
        return current.contentHash !== previous.contentHash;
    }

    return false;
}

/**
 * Build failure report for ER-06
 * Returns a user-friendly error message in Chinese
 */
export function buildFailureReport(state: AgentState): string {
    const completedActions = state.actionHistory.filter(
        (a) => a.result?.success
    );
    const failedActions = state.actionHistory.filter(
        (a) => a.result && !a.result.success
    );
    const lastFailed = failedActions[failedActions.length - 1];

    let report = `❌ 任务未能完成\n\n`;

    // Determine the main failure reason
    const failureReason = getFailureReason(state, lastFailed);
    report += `📋 失败原因: ${failureReason}\n\n`;

    if (completedActions.length > 0) {
        report += `✅ 已完成的步骤 (${completedActions.length}个):\n`;
        completedActions.slice(-5).forEach((a, i) => {
            const actionDesc = getActionDescription(a.tool, a.args);
            report += `  ${i + 1}. ${actionDesc}\n`;
        });
        if (completedActions.length > 5) {
            report += `  ... 及其他 ${completedActions.length - 5} 个步骤\n`;
        }
        report += '\n';
    }

    if (lastFailed) {
        const actionDesc = getActionDescription(
            lastFailed.tool,
            lastFailed.args
        );
        report += `❌ 失败的步骤:\n`;
        report += `  - 操作: ${actionDesc}\n`;
        report += `  - 错误: ${translateError(lastFailed.result?.error)}\n`;
    }

    report += `\n💡 建议: ${getSuggestion(state, lastFailed)}`;

    return report;
}

/**
 * Get human-readable failure reason
 */
function getFailureReason(state: AgentState, lastFailed?: AgentAction): string {
    if (state.loopDetected) {
        return '检测到操作循环，同一操作重复执行多次';
    }
    if (state.consecutiveFailures >= 3) {
        return '连续多次操作失败';
    }
    if (state.iterationCount >= 20) {
        return '超过最大执行步数限制';
    }
    if (lastFailed?.result?.error?.includes('Unknown tool')) {
        return 'AI 响应解析失败，无法理解指令';
    }
    if (
        lastFailed?.result?.error?.includes('not found') ||
        lastFailed?.result?.error?.includes('Element')
    ) {
        return '无法找到目标元素';
    }
    if (
        lastFailed?.result?.error?.includes('timeout') ||
        lastFailed?.result?.error?.includes('Timeout')
    ) {
        return '操作超时';
    }
    return '执行过程中发生错误';
}

/**
 * Get human-readable action description
 */
function getActionDescription(
    tool: string,
    args: Record<string, unknown>
): string {
    switch (tool) {
        case 'navigate':
            return `导航到 ${args.url}`;
        case 'click':
            return `点击 "${args.selector}"`;
        case 'type':
            return `在 "${args.selector}" 输入 "${args.text}"`;
        case 'press':
            return `按下 ${args.key} 键`;
        case 'screenshot':
            return '截取屏幕截图';
        case 'wait':
            return `等待 ${args.ms}ms`;
        case 'waitForSelector':
            return `等待元素 "${args.selector}" 出现`;
        case 'scroll':
            return `滚动页面`;
        case 'hover':
            return `悬停在 "${args.selector}"`;
        case 'select':
            return `选择 "${args.value}"`;
        default:
            if (!tool) return '解析失败的操作';
            return `${tool}(${JSON.stringify(args)})`;
    }
}

/**
 * Translate common errors to Chinese
 */
function translateError(error?: string): string {
    if (!error) return '未知错误';

    if (error.includes('Unknown tool')) {
        return 'AI 返回了无效的操作指令';
    }
    if (error.includes('Element not found') || error.includes('not found')) {
        return '页面上找不到指定的元素';
    }
    if (error.includes('Timeout') || error.includes('timeout')) {
        return '操作超时，页面响应太慢';
    }
    if (error.includes('not visible')) {
        return '元素存在但不可见';
    }
    if (error.includes('not clickable') || error.includes('intercepted')) {
        return '元素被其他内容遮挡，无法点击';
    }
    if (error.includes('disconnected') || error.includes('Disconnected')) {
        return '浏览器连接已断开';
    }
    if (error.includes('navigation')) {
        return '页面导航失败';
    }

    return error;
}

/**
 * Get suggestion based on failure type
 */
function getSuggestion(state: AgentState, lastFailed?: AgentAction): string {
    if (state.loopDetected) {
        return '请尝试换一种方式描述你的任务';
    }
    if (lastFailed?.result?.error?.includes('Unknown tool')) {
        return '请用更简单明确的语言描述任务，例如: "打开 google.com" 或 "点击登录按钮"';
    }
    if (lastFailed?.result?.error?.includes('not found')) {
        return '请确认目标元素是否存在，或尝试使用更精确的描述';
    }
    if (lastFailed?.result?.error?.includes('timeout')) {
        return '页面加载较慢，请稍后重试';
    }
    if (state.consecutiveFailures >= 3) {
        return '多次尝试失败，请检查浏览器状态或刷新页面后重试';
    }
    return '请检查任务描述是否清晰，或尝试将任务拆分为更小的步骤';
}
