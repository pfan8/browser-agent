/**
 * Electron Preload Script
 * 
 * Exposes a safe API to the renderer process via contextBridge.
 * This is the bridge between the main process and the React app.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { Operation, Recording } from '../dsl/types';

// ============================================
// Type Definitions (matching agent-core types)
// ============================================

type AgentStatus = 
  | 'idle'
  | 'observing'
  | 'thinking'
  | 'acting'
  | 'complete'
  | 'error'
  | 'paused'
  | 'running';

interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

interface TaskStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  retryCount: number;
}

interface AgentState {
  sessionId: string;
  status: AgentStatus;
  currentTask: string | null;
  plan: TaskPlan | null;
  memory: {
    conversation: ConversationMessage[];
    workingMemory: Record<string, unknown>;
    facts: unknown[];
  };
  checkpoints: CheckpointInfo[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface CheckpointInfo {
  id: string;
  name: string;
  description?: string;
  stepIndex: number;
  createdAt: string;
  isAutoSave: boolean;
}

type ExecutionMode = 'iterative' | 'script';

interface AgentConfig {
  maxIterations: number;
  maxConsecutiveFailures: number;
  thinkTimeout: number;
  actionTimeout: number;
  enableScreenshots: boolean;
  llmModel: string;
  executionMode: ExecutionMode;
}

interface AgentEvent {
  type: string;
  timestamp: string;
  data: unknown;
}

// ============================================
// Electron API Interface
// ============================================

interface ElectronAPI {
  // Browser control
  connectBrowser: (cdpUrl: string) => Promise<{ success: boolean; error?: string }>;
  disconnectBrowser: () => Promise<void>;
  getBrowserStatus: () => Promise<{ connected: boolean; url?: string }>;
  
  // Browser operations
  navigate: (url: string) => Promise<{ success: boolean; error?: string }>;
  click: (selector: string) => Promise<{ success: boolean; error?: string }>;
  type: (selector: string, text: string) => Promise<{ success: boolean; error?: string }>;
  press: (key: string) => Promise<{ success: boolean; error?: string }>;
  screenshot: (name?: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  waitFor: (ms: number) => Promise<{ success: boolean }>;
  getPageInfo: () => Promise<{ url: string; title: string }>;
  evaluateSelector: (description: string) => Promise<{ selector: string; alternatives: string[] }>;
  listPages: () => Promise<{ index: number; url: string; title: string; active: boolean }[]>;
  switchToPage: (index: number) => Promise<{ success: boolean; error?: string; data?: { index: number; url?: string; title?: string } }>;
  runCode: (code: string) => Promise<{ success: boolean; error?: string }>;
  
  // Recording
  getRecording: () => Promise<Recording>;
  clearRecording: () => Promise<void>;
  exportToPlaywright: () => Promise<{ success: boolean; script?: string; error?: string }>;
  saveRecording: (name: string) => Promise<{ success: boolean; path?: string; error?: string }>;
  loadRecording: (path: string) => Promise<{ success: boolean; recording?: Recording; error?: string }>;
  
  // LLM
  parseNaturalLanguage: (input: string, pageContext?: string) => Promise<{ 
    command: string;
    args: Record<string, string>;
    confidence: number;
  }>;
  setLLMApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setLLMConfig: (config: { apiKey: string; baseUrl?: string }) => Promise<{ success: boolean; error?: string }>;
  getLLMConfig: () => Promise<{ hasApiKey: boolean; baseUrl?: string }>;
  isLLMAvailable: () => Promise<boolean>;
  parseUserInput: (input: string) => Promise<{ success: boolean; result?: { type: 'chat' | 'command' | 'code'; message?: string; command?: string; args?: Record<string, string>; code?: string; confidence?: number }; error?: string }>;
  
  // Events - each returns an unsubscribe function
  onOperationRecorded: (callback: (operation: Operation) => void) => () => void;
  onBrowserEvent: (callback: (event: { type: string; data: unknown }) => void) => () => void;
  onBrowserStatusChanged: (callback: (status: { connected: boolean; cdpUrl?: string }) => void) => () => void;
  
  // Agent (LangGraph-based)
  agent: {
    // Task Execution
    executeTask: (task: string) => Promise<{ success: boolean; plan?: TaskPlan; result?: string; error?: string }>;
    stopTask: () => Promise<{ success: boolean; error?: string }>;
    getStatus: () => Promise<{ status: AgentStatus; isRunning: boolean; currentPlan: TaskPlan | null; progress: { total: number; completed: number; failed: number; pending: number; percentage: number } | null }>;
    getState: () => Promise<AgentState>;
    
    // Sessions
    createSession: (name: string, description?: string) => Promise<{ success: boolean; session?: { id: string; name: string }; error?: string }>;
    loadSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;
    listSessions: () => Promise<Array<{ id: string; name: string; description?: string; checkpointCount: number; createdAt: string; updatedAt: string }>>;
    deleteSession: (sessionId: string) => Promise<boolean>;
    getCurrentSession: () => Promise<string | null>;
    
    // Checkpoints
    createCheckpoint: (name: string, description?: string) => Promise<{ success: boolean; checkpointId?: string; error?: string }>;
    listCheckpoints: () => Promise<CheckpointInfo[]>;
    restoreCheckpoint: (checkpointId: string) => Promise<{ success: boolean; error?: string }>;
    restoreLatest: () => Promise<{ success: boolean; error?: string }>;
    deleteCheckpoint: (checkpointId: string) => Promise<boolean>;
    
    // Memory & History
    getConversation: (limit?: number) => Promise<ConversationMessage[]>;
    clearMemory: () => Promise<{ success: boolean }>;
    getMemorySummary: () => Promise<string>;
    
    // Chat & Misc
    chat: (message: string) => Promise<{ success: boolean; response?: string; error?: string }>;
    reset: () => Promise<{ success: boolean }>;
    updateConfig: (config: Partial<AgentConfig>) => Promise<{ success: boolean; error?: string }>;
    getConfig: () => Promise<AgentConfig>;
    
    // Trace
    getTrace: () => Promise<string>;
    
    // Execution Mode
    getExecutionMode: () => Promise<ExecutionMode>;
    setExecutionMode: (mode: ExecutionMode) => Promise<{ success: boolean; error?: string }>;
    
    // Events - each returns an unsubscribe function
    onEvent: (callback: (event: AgentEvent) => void) => () => void;
    onStatusChanged: (callback: (data: { status: AgentStatus }) => void) => () => void;
    onPlanCreated: (callback: (data: { plan: TaskPlan }) => void) => () => void;
    onStepStarted: (callback: (data: unknown) => void) => () => void;
    onStepCompleted: (callback: (data: unknown) => void) => () => void;
    onStepFailed: (callback: (data: unknown) => void) => () => void;
    onTaskCompleted: (callback: (data: unknown) => void) => () => void;
    onTaskFailed: (callback: (data: unknown) => void) => () => void;
    // Streaming updates for thinking and code
    onThinkingUpdate: (callback: (data: { stepId: string; thought: string; instruction: string }) => void) => () => void;
    onCodeUpdate: (callback: (data: { stepId: string; code: string; instruction: string }) => void) => () => void;
    
    // Confirmation (Human-in-the-Loop)
    confirmAction: (confirmed: boolean, comment?: string) => void;
    cancelConfirmation: () => void;
    onConfirmationRequested: (callback: (request: unknown) => void) => () => void;
  };
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
  // Browser control
  connectBrowser: (cdpUrl: string) => ipcRenderer.invoke('connect-browser', cdpUrl),
  disconnectBrowser: () => ipcRenderer.invoke('disconnect-browser'),
  getBrowserStatus: () => ipcRenderer.invoke('get-browser-status'),
  
  // Browser operations
  navigate: (url: string) => ipcRenderer.invoke('navigate', url),
  click: (selector: string) => ipcRenderer.invoke('click', selector),
  type: (selector: string, text: string) => ipcRenderer.invoke('type', selector, text),
  press: (key: string) => ipcRenderer.invoke('press', key),
  screenshot: (name?: string) => ipcRenderer.invoke('screenshot', name),
  waitFor: (ms: number) => ipcRenderer.invoke('wait-for', ms),
  getPageInfo: () => ipcRenderer.invoke('get-page-info'),
  evaluateSelector: (description: string) => ipcRenderer.invoke('evaluate-selector', description),
  listPages: () => ipcRenderer.invoke('list-pages'),
  switchToPage: (index: number) => ipcRenderer.invoke('switch-to-page', index),
  runCode: (code: string) => ipcRenderer.invoke('run-code', code),
  
  // Recording
  getRecording: () => ipcRenderer.invoke('get-recording'),
  clearRecording: () => ipcRenderer.invoke('clear-recording'),
  exportToPlaywright: () => ipcRenderer.invoke('export-to-playwright'),
  saveRecording: (name: string) => ipcRenderer.invoke('save-recording', name),
  loadRecording: (filePath: string) => ipcRenderer.invoke('load-recording', filePath),
  
  // LLM
  parseNaturalLanguage: (input: string, pageContext?: string) => 
    ipcRenderer.invoke('parse-natural-language', input, pageContext),
  setLLMApiKey: (apiKey: string) => ipcRenderer.invoke('set-llm-api-key', apiKey),
  setLLMConfig: (config: { apiKey: string; baseUrl?: string }) => ipcRenderer.invoke('set-llm-config', config),
  getLLMConfig: () => ipcRenderer.invoke('get-llm-config'),
  isLLMAvailable: () => ipcRenderer.invoke('is-llm-available'),
  parseUserInput: (input: string) => ipcRenderer.invoke('parse-user-input', input),
  
  // Events - each returns an unsubscribe function
  onOperationRecorded: (callback: (operation: Operation) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, operation: Operation) => callback(operation);
    ipcRenderer.on('operation-recorded', handler);
    return () => ipcRenderer.removeListener('operation-recorded', handler);
  },
  onBrowserEvent: (callback: (event: { type: string; data: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, browserEvent: { type: string; data: unknown }) => callback(browserEvent);
    ipcRenderer.on('browser-event', handler);
    return () => ipcRenderer.removeListener('browser-event', handler);
  },
  // Browser status change listener (for auto-connect)
  onBrowserStatusChanged: (callback: (status: { connected: boolean; cdpUrl?: string }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: { connected: boolean; cdpUrl?: string }) => {
      callback(status);
    };
    ipcRenderer.on('browser-status-changed', handler);
    return () => ipcRenderer.removeListener('browser-status-changed', handler);
  },
  
  // Agent (LangGraph-based)
  agent: {
    // Task Execution
    executeTask: (task: string) => ipcRenderer.invoke('agent-execute-task', task),
    stopTask: () => ipcRenderer.invoke('agent-stop-task'),
    getStatus: () => ipcRenderer.invoke('agent-get-status'),
    getState: () => ipcRenderer.invoke('agent-get-state'),
    
    // Sessions
    createSession: (name: string, description?: string) => 
      ipcRenderer.invoke('agent-create-session', name, description),
    loadSession: (sessionId: string) => ipcRenderer.invoke('agent-load-session', sessionId),
    listSessions: () => ipcRenderer.invoke('agent-list-sessions'),
    deleteSession: (sessionId: string) => ipcRenderer.invoke('agent-delete-session', sessionId),
    getCurrentSession: () => ipcRenderer.invoke('agent-get-current-session'),
    
    // Checkpoints
    createCheckpoint: (name: string, description?: string) => 
      ipcRenderer.invoke('agent-create-checkpoint', name, description),
    listCheckpoints: () => ipcRenderer.invoke('agent-list-checkpoints'),
    restoreCheckpoint: (checkpointId: string) => 
      ipcRenderer.invoke('agent-restore-checkpoint', checkpointId),
    restoreLatest: () => ipcRenderer.invoke('agent-restore-latest'),
    deleteCheckpoint: (checkpointId: string) => 
      ipcRenderer.invoke('agent-delete-checkpoint', checkpointId),
    
    // Memory & History
    getConversation: (limit?: number) => ipcRenderer.invoke('agent-get-conversation', limit),
    clearMemory: () => ipcRenderer.invoke('agent-clear-memory'),
    getMemorySummary: () => ipcRenderer.invoke('agent-get-memory-summary'),
    
    // Chat & Misc
    chat: (message: string) => ipcRenderer.invoke('agent-chat', message),
    reset: () => ipcRenderer.invoke('agent-reset'),
    updateConfig: (config: Partial<AgentConfig>) => ipcRenderer.invoke('agent-update-config', config),
    getConfig: () => ipcRenderer.invoke('agent-get-config'),
    
    // Trace
    getTrace: () => ipcRenderer.invoke('agent-get-trace'),
    
    // Execution Mode
    getExecutionMode: () => ipcRenderer.invoke('agent-get-execution-mode'),
    setExecutionMode: (mode: ExecutionMode) => ipcRenderer.invoke('agent-set-execution-mode', mode),
    
    // Events - each returns an unsubscribe function
    onEvent: (callback: (event: AgentEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, agentEvent: AgentEvent) => callback(agentEvent);
      ipcRenderer.on('agent-event', handler);
      return () => ipcRenderer.removeListener('agent-event', handler);
    },
    onStatusChanged: (callback: (data: { status: AgentStatus }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { status: AgentStatus }) => callback(data);
      ipcRenderer.on('agent-status-changed', handler);
      return () => ipcRenderer.removeListener('agent-status-changed', handler);
    },
    onPlanCreated: (callback: (data: { plan: TaskPlan }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { plan: TaskPlan }) => callback(data);
      ipcRenderer.on('agent-plan-created', handler);
      return () => ipcRenderer.removeListener('agent-plan-created', handler);
    },
    onStepStarted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent-step-started', handler);
      return () => ipcRenderer.removeListener('agent-step-started', handler);
    },
    onStepCompleted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent-step-completed', handler);
      return () => ipcRenderer.removeListener('agent-step-completed', handler);
    },
    onStepFailed: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent-step-failed', handler);
      return () => ipcRenderer.removeListener('agent-step-failed', handler);
    },
    onTaskCompleted: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent-task-completed', handler);
      return () => ipcRenderer.removeListener('agent-task-completed', handler);
    },
    onTaskFailed: (callback: (data: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) => callback(data);
      ipcRenderer.on('agent-task-failed', handler);
      return () => ipcRenderer.removeListener('agent-task-failed', handler);
    },
    // Streaming updates for thinking and code
    onThinkingUpdate: (callback: (data: { stepId: string; thought: string; instruction: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { stepId: string; thought: string; instruction: string }) => callback(data);
      ipcRenderer.on('agent-thinking-update', handler);
      return () => ipcRenderer.removeListener('agent-thinking-update', handler);
    },
    onCodeUpdate: (callback: (data: { stepId: string; code: string; instruction: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { stepId: string; code: string; instruction: string }) => callback(data);
      ipcRenderer.on('agent-code-update', handler);
      return () => ipcRenderer.removeListener('agent-code-update', handler);
    },
    
    // Confirmation (Human-in-the-Loop)
    confirmAction: (confirmed: boolean, comment?: string) => {
      ipcRenderer.send('agent-confirm-action', confirmed, comment);
    },
    cancelConfirmation: () => {
      ipcRenderer.send('agent-cancel-confirmation');
    },
    onConfirmationRequested: (callback: (request: unknown) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, request: unknown) => callback(request);
      ipcRenderer.on('agent-confirmation-requested', handler);
      return () => ipcRenderer.removeListener('agent-confirmation-requested', handler);
    },
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
