/// <reference types="vite/client" />

// Local type definitions to avoid import issues
type AgentStatus = 
  | 'idle'
  | 'observing'
  | 'thinking'
  | 'acting'
  | 'complete'
  | 'error'
  | 'paused'
  | 'running';

interface TaskStep {
  id: string;
  description: string;
  tool: string;
  args: Record<string, unknown>;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  retryCount: number;
}

interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
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

interface AgentConfig {
  maxIterations: number;
  maxConsecutiveFailures: number;
  thinkTimeout: number;
  actionTimeout: number;
  enableScreenshots: boolean;
  llmModel: string;
}

interface AgentEvent {
  type: string;
  timestamp: string;
  data: unknown;
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

interface Window {
  electronAPI: {
    // Browser control
    connectBrowser: (cdpUrl: string) => Promise<{ success: boolean; error?: string }>
    disconnectBrowser: () => Promise<void>
    getBrowserStatus: () => Promise<{ connected: boolean; url?: string }>
    
    // Browser operations
    navigate: (url: string) => Promise<{ success: boolean; error?: string }>
    click: (selector: string) => Promise<{ success: boolean; error?: string }>
    type: (selector: string, text: string) => Promise<{ success: boolean; error?: string }>
    press: (key: string) => Promise<{ success: boolean; error?: string }>
    screenshot: (name?: string) => Promise<{ success: boolean; path?: string; error?: string }>
    waitFor: (ms: number) => Promise<{ success: boolean }>
    getPageInfo: () => Promise<{ url: string; title: string }>
    evaluateSelector: (description: string) => Promise<{ selector: string; alternatives: string[] }>
    listPages: () => Promise<{ index: number; url: string; title: string; active: boolean }[]>
    switchToPage: (index: number) => Promise<{ success: boolean; error?: string; data?: { index: number; url?: string; title?: string } }>
    runCode: (code: string) => Promise<{ success: boolean; error?: string }>
    
    // Recording
    getRecording: () => Promise<import('@dsl/types').Recording>
    clearRecording: () => Promise<void>
    exportToPlaywright: () => Promise<{ success: boolean; script?: string; error?: string }>
    saveRecording: (name: string) => Promise<{ success: boolean; path?: string; error?: string }>
    loadRecording: (path: string) => Promise<{ success: boolean; recording?: import('@dsl/types').Recording; error?: string }>
    
    // LLM
    parseNaturalLanguage: (input: string, pageContext?: string) => Promise<{ 
      command: string
      args: Record<string, string>
      code?: string
      confidence: number
    }>
    setLLMApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
    setLLMConfig: (config: { apiKey: string; baseUrl?: string }) => Promise<{ success: boolean; error?: string }>
    getLLMConfig: () => Promise<{ hasApiKey: boolean; baseUrl?: string }>
    isLLMAvailable: () => Promise<boolean>
    parseUserInput: (input: string) => Promise<{ success: boolean; result?: { type: 'chat' | 'command' | 'code'; message?: string; command?: string; args?: Record<string, string>; code?: string; confidence?: number }; error?: string }>
    
    // Events - each returns an unsubscribe function
    onOperationRecorded: (callback: (operation: import('@dsl/types').Operation) => void) => () => void
    onBrowserEvent: (callback: (event: { type: string; data: unknown }) => void) => () => void
    onBrowserStatusChanged: (callback: (status: { connected: boolean; cdpUrl?: string }) => void) => () => void
    
    // Agent (LangGraph-based)
    agent: {
      // Task Execution
      executeTask: (task: string) => Promise<{ success: boolean; plan?: TaskPlan; result?: string; error?: string }>
      stopTask: () => Promise<{ success: boolean; error?: string }>
      getStatus: () => Promise<{ 
        status: string
        isRunning: boolean
        currentPlan: TaskPlan | null
        progress: { total: number; completed: number; failed: number; pending: number; percentage: number } | null 
      }>
      getState: () => Promise<AgentState>
      
      // Sessions
      createSession: (name: string, description?: string) => Promise<{ success: boolean; session?: { id: string; name: string }; error?: string }>
      loadSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>
      listSessions: () => Promise<Array<{ id: string; name: string; description?: string; checkpointCount: number; createdAt: string; updatedAt: string }>>
      deleteSession: (sessionId: string) => Promise<boolean>
      getCurrentSession: () => Promise<string | null>
      
      // Checkpoints
      createCheckpoint: (name: string, description?: string) => Promise<{ success: boolean; checkpointId?: string; error?: string }>
      listCheckpoints: () => Promise<CheckpointInfo[]>
      restoreCheckpoint: (checkpointId: string) => Promise<{ success: boolean; error?: string }>
      restoreLatest: () => Promise<{ success: boolean; error?: string }>
      deleteCheckpoint: (checkpointId: string) => Promise<boolean>
      
      // Memory & History
      getConversation: (limit?: number) => Promise<ConversationMessage[]>
      clearMemory: () => Promise<{ success: boolean }>
      getMemorySummary: () => Promise<string>
      
      // Chat & Misc
      chat: (message: string) => Promise<{ success: boolean; response?: string; error?: string }>
      reset: () => Promise<{ success: boolean }>
      updateConfig: (config: Partial<AgentConfig>) => Promise<{ success: boolean; error?: string }>
      getConfig: () => Promise<AgentConfig>
      
      // Events - each returns an unsubscribe function
      onEvent: (callback: (event: AgentEvent) => void) => () => void
      onStatusChanged: (callback: (data: { status: string }) => void) => () => void
      onPlanCreated: (callback: (data: { plan: TaskPlan }) => void) => () => void
      onStepStarted: (callback: (data: unknown) => void) => () => void
      onStepCompleted: (callback: (data: unknown) => void) => () => void
      onStepFailed: (callback: (data: unknown) => void) => () => void
      onTaskCompleted: (callback: (data: unknown) => void) => () => void
      onTaskFailed: (callback: (data: unknown) => void) => () => void
      
      // Confirmation (Human-in-the-Loop)
      confirmAction: (confirmed: boolean, comment?: string) => void
      cancelConfirmation: () => void
      onConfirmationRequested: (callback: (request: unknown) => void) => () => void
    }
  }
}

