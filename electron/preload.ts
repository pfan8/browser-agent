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
    createdAt: string;
    updatedAt: string;
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

// Context info for UI display
interface ContextInfo {
    index: number;
    pageCount: number;
    isActive: boolean;
}

interface ElectronAPI {
    // Browser control
    connectBrowser: (
        cdpUrl: string
    ) => Promise<{ success: boolean; error?: string }>;
    disconnectBrowser: () => Promise<void>;
    getBrowserStatus: () => Promise<{ connected: boolean; url?: string }>;

    // Browser operations (all via runCode)
    runCode: (
        code: string
    ) => Promise<{ success: boolean; result?: unknown; error?: string }>;

    // Context management
    getContextsInfo: () => Promise<ContextInfo[]>;
    switchContext: (
        index: number
    ) => Promise<{ success: boolean; error?: string }>;

    // Recording
    getRecording: () => Promise<Recording>;
    clearRecording: () => Promise<void>;
    exportToPlaywright: () => Promise<{
        success: boolean;
        script?: string;
        error?: string;
    }>;
    saveRecording: (
        name: string
    ) => Promise<{ success: boolean; path?: string; error?: string }>;
    loadRecording: (
        path: string
    ) => Promise<{ success: boolean; recording?: Recording; error?: string }>;

    // LLM
    parseNaturalLanguage: (
        input: string,
        pageContext?: string
    ) => Promise<{
        command: string;
        args: Record<string, string>;
        confidence: number;
    }>;
    setLLMApiKey: (
        apiKey: string
    ) => Promise<{ success: boolean; error?: string }>;
    setLLMConfig: (config: {
        apiKey: string;
        baseUrl?: string;
    }) => Promise<{ success: boolean; error?: string }>;
    getLLMConfig: () => Promise<{ hasApiKey: boolean; baseUrl?: string }>;
    isLLMAvailable: () => Promise<boolean>;
    parseUserInput: (
        input: string
    ) => Promise<{
        success: boolean;
        result?: {
            type: 'chat' | 'command' | 'code';
            message?: string;
            command?: string;
            args?: Record<string, string>;
            code?: string;
            confidence?: number;
        };
        error?: string;
    }>;

    // Events - each returns an unsubscribe function
    onOperationRecorded: (
        callback: (operation: Operation) => void
    ) => () => void;
    onBrowserEvent: (
        callback: (event: { type: string; data: unknown }) => void
    ) => () => void;
    onBrowserStatusChanged: (
        callback: (status: { connected: boolean; cdpUrl?: string }) => void
    ) => () => void;

    // Agent (LangGraph-based)
    agent: {
        // Task Execution
        executeTask: (
            task: string,
            options?: { threadId?: string; continueSession?: boolean }
        ) => Promise<{
            success: boolean;
            plan?: TaskPlan;
            result?: string;
            error?: string;
        }>;
        stopTask: () => Promise<{ success: boolean; error?: string }>;
        getStatus: () => Promise<{
            status: AgentStatus;
            isRunning: boolean;
            currentPlan: TaskPlan | null;
            progress: {
                total: number;
                completed: number;
                failed: number;
                pending: number;
                percentage: number;
            } | null;
        }>;
        getState: () => Promise<AgentState>;

        // Chat & Misc
        chat: (
            message: string
        ) => Promise<{ success: boolean; response?: string; error?: string }>;
        reset: () => Promise<{ success: boolean }>;
        updateConfig: (
            config: Partial<AgentConfig>
        ) => Promise<{ success: boolean; error?: string }>;
        getConfig: () => Promise<AgentConfig>;

        // Trace
        getTraceId: () => Promise<string | null>;
        onTraceId: (
            callback: (data: { traceId: string }) => void
        ) => () => void;

        // Execution Mode
        getExecutionMode: () => Promise<ExecutionMode>;
        setExecutionMode: (
            mode: ExecutionMode
        ) => Promise<{ success: boolean; error?: string }>;

        // Events - each returns an unsubscribe function
        onEvent: (callback: (event: AgentEvent) => void) => () => void;
        onStatusChanged: (
            callback: (data: { status: AgentStatus }) => void
        ) => () => void;
        onPlanCreated: (
            callback: (data: { plan: TaskPlan }) => void
        ) => () => void;
        onStepStarted: (callback: (data: unknown) => void) => () => void;
        onStepCompleted: (callback: (data: unknown) => void) => () => void;
        onStepFailed: (callback: (data: unknown) => void) => () => void;
        onTaskCompleted: (callback: (data: unknown) => void) => () => void;
        onTaskFailed: (callback: (data: unknown) => void) => () => void;
        // Streaming updates for thinking and code
        onThinkingUpdate: (
            callback: (data: {
                stepId: string;
                thought: string;
                instruction: string;
            }) => void
        ) => () => void;
        onCodeUpdate: (
            callback: (data: {
                stepId: string;
                code: string;
                instruction: string;
            }) => void
        ) => () => void;

        // Confirmation (Human-in-the-Loop)
        confirmAction: (confirmed: boolean, comment?: string) => void;
        cancelConfirmation: () => void;
        onConfirmationRequested: (
            callback: (request: unknown) => void
        ) => () => void;

        // Beads Task Management
        getBeadsTasks: () => Promise<{
            success: boolean;
            tasks: unknown[];
            initialized?: boolean;
            error?: string;
        }>;
        getBeadsProgress: () => Promise<{
            success: boolean;
            progress: {
                total: number;
                completed: number;
                ready: number;
                blocked: number;
                pending: number;
                failed: number;
                percentage: number;
            } | null;
            initialized?: boolean;
            error?: string;
        }>;
        getBeadsPlan: () => Promise<{
            success: boolean;
            plan: {
                epicId: string;
                epicTitle: string;
                tasks: unknown[];
                completedCount: number;
                totalCount: number;
                percentage: number;
                status: string;
            } | null;
            initialized?: boolean;
            error?: string;
        }>;
    };
}

// Expose the API to the renderer process
const electronAPI: ElectronAPI = {
    // Browser control
    connectBrowser: (cdpUrl: string) =>
        ipcRenderer.invoke('connect-browser', cdpUrl),
    disconnectBrowser: () => ipcRenderer.invoke('disconnect-browser'),
    getBrowserStatus: () => ipcRenderer.invoke('get-browser-status'),

    // Browser operations (all via runCode)
    runCode: (code: string) => ipcRenderer.invoke('run-code', code),

    // Context management
    getContextsInfo: () => ipcRenderer.invoke('get-contexts-info'),
    switchContext: (index: number) =>
        ipcRenderer.invoke('switch-context', index),

    // Recording
    getRecording: () => ipcRenderer.invoke('get-recording'),
    clearRecording: () => ipcRenderer.invoke('clear-recording'),
    exportToPlaywright: () => ipcRenderer.invoke('export-to-playwright'),
    saveRecording: (name: string) => ipcRenderer.invoke('save-recording', name),
    loadRecording: (filePath: string) =>
        ipcRenderer.invoke('load-recording', filePath),

    // LLM
    parseNaturalLanguage: (input: string, pageContext?: string) =>
        ipcRenderer.invoke('parse-natural-language', input, pageContext),
    setLLMApiKey: (apiKey: string) =>
        ipcRenderer.invoke('set-llm-api-key', apiKey),
    setLLMConfig: (config: { apiKey: string; baseUrl?: string }) =>
        ipcRenderer.invoke('set-llm-config', config),
    getLLMConfig: () => ipcRenderer.invoke('get-llm-config'),
    isLLMAvailable: () => ipcRenderer.invoke('is-llm-available'),
    parseUserInput: (input: string) =>
        ipcRenderer.invoke('parse-user-input', input),

    // Events - each returns an unsubscribe function
    onOperationRecorded: (callback: (operation: Operation) => void) => {
        const handler = (
            _event: Electron.IpcRendererEvent,
            operation: Operation
        ) => callback(operation);
        ipcRenderer.on('operation-recorded', handler);
        return () => ipcRenderer.removeListener('operation-recorded', handler);
    },
    onBrowserEvent: (
        callback: (event: { type: string; data: unknown }) => void
    ) => {
        const handler = (
            _event: Electron.IpcRendererEvent,
            browserEvent: { type: string; data: unknown }
        ) => callback(browserEvent);
        ipcRenderer.on('browser-event', handler);
        return () => ipcRenderer.removeListener('browser-event', handler);
    },
    // Browser status change listener (for auto-connect)
    onBrowserStatusChanged: (
        callback: (status: { connected: boolean; cdpUrl?: string }) => void
    ) => {
        const handler = (
            _event: Electron.IpcRendererEvent,
            status: { connected: boolean; cdpUrl?: string }
        ) => {
            callback(status);
        };
        ipcRenderer.on('browser-status-changed', handler);
        return () =>
            ipcRenderer.removeListener('browser-status-changed', handler);
    },

    // Agent (LangGraph-based)
    agent: {
        // Task Execution
        executeTask: (
            task: string,
            options?: { threadId?: string; continueSession?: boolean }
        ) => ipcRenderer.invoke('agent-execute-task', task, options),
        stopTask: () => ipcRenderer.invoke('agent-stop-task'),
        getStatus: () => ipcRenderer.invoke('agent-get-status'),
        getState: () => ipcRenderer.invoke('agent-get-state'),

        // Chat & Misc
        chat: (message: string) => ipcRenderer.invoke('agent-chat', message),
        reset: () => ipcRenderer.invoke('agent-reset'),
        updateConfig: (config: Partial<AgentConfig>) =>
            ipcRenderer.invoke('agent-update-config', config),
        getConfig: () => ipcRenderer.invoke('agent-get-config'),

        // Trace
        getTraceId: () => ipcRenderer.invoke('agent-get-trace-id'),
        onTraceId: (callback: (data: { traceId: string }) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: { traceId: string }
            ) => callback(data);
            ipcRenderer.on('agent-trace-id', handler);
            return () => ipcRenderer.removeListener('agent-trace-id', handler);
        },

        // Execution Mode
        getExecutionMode: () => ipcRenderer.invoke('agent-get-execution-mode'),
        setExecutionMode: (mode: ExecutionMode) =>
            ipcRenderer.invoke('agent-set-execution-mode', mode),

        // Events - each returns an unsubscribe function
        onEvent: (callback: (event: AgentEvent) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                agentEvent: AgentEvent
            ) => callback(agentEvent);
            ipcRenderer.on('agent-event', handler);
            return () => ipcRenderer.removeListener('agent-event', handler);
        },
        onStatusChanged: (
            callback: (data: { status: AgentStatus }) => void
        ) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: { status: AgentStatus }
            ) => callback(data);
            ipcRenderer.on('agent-status-changed', handler);
            return () =>
                ipcRenderer.removeListener('agent-status-changed', handler);
        },
        onPlanCreated: (callback: (data: { plan: TaskPlan }) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: { plan: TaskPlan }
            ) => callback(data);
            ipcRenderer.on('agent-plan-created', handler);
            return () =>
                ipcRenderer.removeListener('agent-plan-created', handler);
        },
        onStepStarted: (callback: (data: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: unknown
            ) => callback(data);
            ipcRenderer.on('agent-step-started', handler);
            return () =>
                ipcRenderer.removeListener('agent-step-started', handler);
        },
        onStepCompleted: (callback: (data: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: unknown
            ) => callback(data);
            ipcRenderer.on('agent-step-completed', handler);
            return () =>
                ipcRenderer.removeListener('agent-step-completed', handler);
        },
        onStepFailed: (callback: (data: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: unknown
            ) => callback(data);
            ipcRenderer.on('agent-step-failed', handler);
            return () =>
                ipcRenderer.removeListener('agent-step-failed', handler);
        },
        onTaskCompleted: (callback: (data: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: unknown
            ) => callback(data);
            ipcRenderer.on('agent-task-completed', handler);
            return () =>
                ipcRenderer.removeListener('agent-task-completed', handler);
        },
        onTaskFailed: (callback: (data: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: unknown
            ) => callback(data);
            ipcRenderer.on('agent-task-failed', handler);
            return () =>
                ipcRenderer.removeListener('agent-task-failed', handler);
        },
        // Streaming updates for thinking and code
        onThinkingUpdate: (
            callback: (data: {
                stepId: string;
                thought: string;
                instruction: string;
            }) => void
        ) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: { stepId: string; thought: string; instruction: string }
            ) => callback(data);
            ipcRenderer.on('agent-thinking-update', handler);
            return () =>
                ipcRenderer.removeListener('agent-thinking-update', handler);
        },
        onCodeUpdate: (
            callback: (data: {
                stepId: string;
                code: string;
                instruction: string;
            }) => void
        ) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                data: { stepId: string; code: string; instruction: string }
            ) => callback(data);
            ipcRenderer.on('agent-code-update', handler);
            return () =>
                ipcRenderer.removeListener('agent-code-update', handler);
        },

        // Confirmation (Human-in-the-Loop)
        confirmAction: (confirmed: boolean, comment?: string) => {
            ipcRenderer.send('agent-confirm-action', confirmed, comment);
        },
        cancelConfirmation: () => {
            ipcRenderer.send('agent-cancel-confirmation');
        },
        onConfirmationRequested: (callback: (request: unknown) => void) => {
            const handler = (
                _event: Electron.IpcRendererEvent,
                request: unknown
            ) => callback(request);
            ipcRenderer.on('agent-confirmation-requested', handler);
            return () =>
                ipcRenderer.removeListener(
                    'agent-confirmation-requested',
                    handler
                );
        },

        // Beads Task Management
        getBeadsTasks: () => ipcRenderer.invoke('agent-get-beads-tasks'),
        getBeadsProgress: () => ipcRenderer.invoke('agent-get-beads-progress'),
        getBeadsPlan: () => ipcRenderer.invoke('agent-get-beads-plan'),
    },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
