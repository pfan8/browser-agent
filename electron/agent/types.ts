/**
 * Agent Type Definitions
 * 
 * Types for the hierarchical agent architecture:
 * - High-Level Planner: Task decomposition and replanning
 * - Low-Level Executor: ReAct-style step execution
 */

// ============================================
// Agent Status & State
// ============================================

export type AgentStatus = 
  | 'idle'
  | 'planning'
  | 'executing'
  | 'observing'
  | 'thinking'
  | 'complete'
  | 'error'
  | 'paused';

export interface AgentState {
  sessionId: string;
  status: AgentStatus;
  currentTask: string | null;
  plan: TaskPlan | null;
  memory: AgentMemory;
  checkpoints: CheckpointInfo[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Task Planning (High-Level)
// ============================================

export type TaskStepStatus = 
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'skipped';

export interface TaskStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  status: TaskStepStatus;
  result?: StepResult;
  retryCount: number;
  maxRetries: number;
  dependencies?: string[];  // IDs of steps that must complete first
}

export interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  context: Record<string, unknown>;  // Shared context between steps
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface PlanningResult {
  success: boolean;
  plan?: TaskPlan;
  error?: string;
  reasoning?: string;
}

// ============================================
// Step Execution (Low-Level ReAct)
// ============================================

export interface Observation {
  timestamp: string;
  url: string;
  title: string;
  screenshot?: string;  // Base64 encoded screenshot
  domSnapshot?: string;  // Simplified DOM structure
  visibleElements?: ElementInfo[];
  error?: string;
}

export interface ElementInfo {
  selector: string;
  tag: string;
  text?: string;
  attributes: Record<string, string>;
  isVisible: boolean;
  isInteractable: boolean;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface ThinkingResult {
  thought: string;
  action: string;
  reasoning: string;
  confidence: number;
}

export interface StepResult {
  success: boolean;
  action: string;
  observation: Observation;
  error?: string;
  duration: number;
  retryAttempt: number;
}

export interface ExecutionResult {
  stepId: string;
  success: boolean;
  results: StepResult[];
  finalObservation: Observation;
  error?: string;
}

// ============================================
// Memory System
// ============================================

export interface ConversationMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface WorkingMemoryItem {
  key: string;
  value: unknown;
  type: 'observation' | 'variable' | 'intermediate_result';
  timestamp: string;
  expiresAt?: string;  // Optional TTL
}

export interface Fact {
  id: string;
  content: string;
  source: 'extracted' | 'user_provided' | 'learned';
  confidence: number;
  createdAt: string;
  lastUsedAt: string;
  useCount: number;
}

export interface AgentMemory {
  conversation: ConversationMessage[];
  workingMemory: Map<string, WorkingMemoryItem> | Record<string, WorkingMemoryItem>;
  facts: Fact[];
  maxConversationLength: number;
  maxWorkingMemoryItems: number;
}

// Serializable version of AgentMemory (Map -> Record)
export interface SerializableAgentMemory {
  conversation: ConversationMessage[];
  workingMemory: Record<string, WorkingMemoryItem>;
  facts: Fact[];
  maxConversationLength: number;
  maxWorkingMemoryItems: number;
}

// ============================================
// Checkpoint System
// ============================================

export interface CheckpointInfo {
  id: string;
  name: string;
  description?: string;
  stepIndex: number;
  createdAt: string;
  isAutoSave: boolean;
}

export interface Checkpoint {
  info: CheckpointInfo;
  state: SerializableAgentState;
}

export interface SerializableAgentState {
  sessionId: string;
  status: AgentStatus;
  currentTask: string | null;
  plan: TaskPlan | null;
  memory: SerializableAgentMemory;
  checkpoints: CheckpointInfo[];
  createdAt: string;
  updatedAt: string;
}

export interface Session {
  id: string;
  name: string;
  description?: string;
  state: SerializableAgentState;
  checkpoints: Checkpoint[];
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Tool System
// ============================================

export type ToolCategory = 'browser' | 'observation' | 'utility' | 'code';

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  category: ToolCategory;
  parameters: ToolParameter[];
  returns: string;
  examples?: string[];
}

export interface ToolExecutionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  duration: number;
}

export type ToolExecutor = (args: Record<string, unknown>) => Promise<ToolExecutionResult>;

export interface RegisteredTool {
  definition: ToolDefinition;
  executor: ToolExecutor;
}

// ============================================
// Events
// ============================================

export type AgentEventType = 
  | 'status_changed'
  | 'plan_created'
  | 'plan_updated'
  | 'step_started'
  | 'step_completed'
  | 'step_failed'
  | 'observation'
  | 'thinking'
  | 'checkpoint_created'
  | 'checkpoint_restored'
  | 'error'
  | 'task_completed'
  | 'task_failed'
  // ReAct events
  | 'react_iteration_started'
  | 'react_thinking'
  | 'react_action_started'
  | 'react_action_completed'
  | 'react_action_failed'
  | 'react_completed'
  // CodeAct events
  | 'codeact_triggered'
  | 'codeact_executing'
  | 'codeact_completed'
  | 'codeact_failed';

export interface AgentEvent {
  type: AgentEventType;
  timestamp: string;
  data: unknown;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ============================================
// Configuration
// ============================================

export interface AgentConfig {
  maxStepRetries: number;
  stepTimeout: number;  // ms
  observationTimeout: number;  // ms
  autoCheckpoint: boolean;
  checkpointInterval: number;  // After N steps
  maxConversationHistory: number;
  maxWorkingMemoryItems: number;
  llmModel: string;
  enableScreenshots: boolean;
  enableDomSnapshots: boolean;
}

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  maxStepRetries: 3,
  stepTimeout: 30000,
  observationTimeout: 5000,
  autoCheckpoint: true,
  checkpointInterval: 1,
  maxConversationHistory: 50,
  maxWorkingMemoryItems: 100,
  llmModel: 'claude-3-haiku-20240307',
  enableScreenshots: false,
  enableDomSnapshots: true,
};

// ============================================
// ReAct Agent Types
// ============================================

/**
 * ReAct loop status
 */
export type ReActStatus = 
  | 'idle'
  | 'observing'
  | 'thinking'
  | 'acting'
  | 'verifying'
  | 'complete'
  | 'error'
  | 'paused';

/**
 * State for the ReAct agent loop
 */
export interface ReActState {
  status: ReActStatus;
  goal: string;
  currentObservation: Observation | null;
  actionHistory: ReActAction[];
  iterationCount: number;
  maxIterations: number;
  consecutiveFailures: number;
  startTime: string;
  context: Record<string, unknown>;
}

/**
 * Action decided by the ReAct think step
 */
export interface ReActAction {
  id: string;
  thought: string;
  tool: string;
  args: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  requiresCodeAct: boolean;
  timestamp: string;
  result?: ReActActionResult;
}

/**
 * Result of executing a ReAct action
 */
export interface ReActActionResult {
  success: boolean;
  data?: unknown;
  error?: string;
  observation: Observation;
  duration: number;
}

/**
 * Think result from LLM
 */
export interface ReActThinkResult {
  thought: string;
  action: string;
  args: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  shouldCallCodeAct: boolean;
  codeActTask?: string;
  isComplete: boolean;
  completionMessage?: string;
}

/**
 * ReAct configuration
 */
export interface ReActConfig {
  maxIterations: number;
  maxConsecutiveFailures: number;
  thinkTimeout: number;  // ms
  actionTimeout: number;  // ms
  enableCodeAct: boolean;
  codeActTimeout: number;  // ms
  enableScreenshots: boolean;
  enableDomSnapshots: boolean;
}

export const DEFAULT_REACT_CONFIG: ReActConfig = {
  maxIterations: 20,
  maxConsecutiveFailures: 3,
  thinkTimeout: 30000,
  actionTimeout: 30000,
  enableCodeAct: true,
  codeActTimeout: 10000,
  enableScreenshots: false,
  enableDomSnapshots: true,
};

// ============================================
// CodeAct Types
// ============================================

/**
 * CodeAct execution request
 */
export interface CodeActRequest {
  code: string;
  language: 'javascript' | 'typescript';
  context?: Record<string, unknown>;
  timeout?: number;
}

/**
 * CodeAct execution result
 */
export interface CodeActResult {
  success: boolean;
  result?: unknown;
  stdout?: string;
  stderr?: string;
  error?: string;
  duration: number;
}

/**
 * Available sandbox APIs for CodeAct
 */
export interface CodeActSandboxAPI {
  // DOM utilities
  parseHTML: (html: string) => unknown;
  querySelectorAll: (html: string, selector: string) => unknown[];
  
  // Data utilities
  sortBy: <T>(arr: T[], key: string) => T[];
  filterBy: <T>(arr: T[], predicate: (item: T) => boolean) => T[];
  groupBy: <T>(arr: T[], key: string) => Record<string, T[]>;
  
  // String utilities
  similarity: (str1: string, str2: string) => number;
  extractText: (html: string) => string;
  
  // Selector generation
  generateSelector: (element: ElementInfo) => string;
  findBestMatch: (elements: ElementInfo[], description: string) => ElementInfo | null;
}

// ============================================
// Gating Logic Types
// ============================================

/**
 * Gating rule type
 */
export type GatingRuleType = 
  | 'dom_size'
  | 'selector_failures'
  | 'complex_logic'
  | 'user_instruction'
  | 'data_extraction';

/**
 * Gating rule definition
 */
export interface GatingRule {
  type: GatingRuleType;
  description: string;
  condition: (context: GatingContext) => boolean;
  priority: number;
}

/**
 * Context for gating decisions
 */
export interface GatingContext {
  observation: Observation;
  goal: string;
  actionHistory: ReActAction[];
  consecutiveSelectorFailures: number;
  domSize: number;
  userInstruction: string;
  requiredOperation?: string;
}

/**
 * Gating decision result
 */
export interface GatingDecision {
  shouldUseCodeAct: boolean;
  triggeredRules: GatingRuleType[];
  suggestedTask?: string;
  confidence: number;
}

// ============================================
// DOM Query Types
// ============================================

/**
 * Enhanced DOM query result
 */
export interface DOMQueryResult {
  success: boolean;
  html?: string;
  elements?: ElementInfo[];
  totalSize: number;
  truncated: boolean;
  error?: string;
}

/**
 * DOM query options
 */
export interface DOMQueryOptions {
  selector?: string;
  maxElements?: number;
  maxDepth?: number;
  includeHidden?: boolean;
  attributes?: string[];
}

// ============================================
// Utility Types
// ============================================

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyMemory(): AgentMemory {
  return {
    conversation: [],
    workingMemory: new Map(),
    facts: [],
    maxConversationLength: DEFAULT_AGENT_CONFIG.maxConversationHistory,
    maxWorkingMemoryItems: DEFAULT_AGENT_CONFIG.maxWorkingMemoryItems,
  };
}

export function createEmptyState(sessionId?: string): AgentState {
  const now = new Date().toISOString();
  return {
    sessionId: sessionId || generateId('session'),
    status: 'idle',
    currentTask: null,
    plan: null,
    memory: createEmptyMemory(),
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeMemory(memory: AgentMemory): SerializableAgentMemory {
  const workingMemoryRecord: Record<string, WorkingMemoryItem> = {};
  
  if (memory.workingMemory instanceof Map) {
    memory.workingMemory.forEach((value, key) => {
      workingMemoryRecord[key] = value;
    });
  } else {
    Object.assign(workingMemoryRecord, memory.workingMemory);
  }
  
  return {
    conversation: memory.conversation,
    workingMemory: workingMemoryRecord,
    facts: memory.facts,
    maxConversationLength: memory.maxConversationLength,
    maxWorkingMemoryItems: memory.maxWorkingMemoryItems,
  };
}

export function deserializeMemory(serialized: SerializableAgentMemory): AgentMemory {
  const workingMemoryMap = new Map<string, WorkingMemoryItem>();
  
  Object.entries(serialized.workingMemory).forEach(([key, value]) => {
    workingMemoryMap.set(key, value);
  });
  
  return {
    conversation: serialized.conversation,
    workingMemory: workingMemoryMap,
    facts: serialized.facts,
    maxConversationLength: serialized.maxConversationLength,
    maxWorkingMemoryItems: serialized.maxWorkingMemoryItems,
  };
}

export function serializeState(state: AgentState): SerializableAgentState {
  return {
    sessionId: state.sessionId,
    status: state.status,
    currentTask: state.currentTask,
    plan: state.plan,
    memory: serializeMemory(state.memory),
    checkpoints: state.checkpoints,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

export function deserializeState(serialized: SerializableAgentState): AgentState {
  return {
    sessionId: serialized.sessionId,
    status: serialized.status,
    currentTask: serialized.currentTask,
    plan: serialized.plan,
    memory: deserializeMemory(serialized.memory),
    checkpoints: serialized.checkpoints,
    createdAt: serialized.createdAt,
    updatedAt: serialized.updatedAt,
  };
}

