/// <reference types="vite/client" />

// Import agent types for type definitions
type AgentTypes = typeof import('@electron/agent/types');
type AgentStatus = AgentTypes['AgentStatus'] extends infer T ? T : never;
type TaskPlan = import('@electron/agent/types').TaskPlan;
type AgentState = import('@electron/agent/types').AgentState;
type CheckpointInfo = import('@electron/agent/types').CheckpointInfo;
type ConversationMessage = import('@electron/agent/types').ConversationMessage;
type AgentConfig = import('@electron/agent/types').AgentConfig;
type AgentEvent = import('@electron/agent/types').AgentEvent;

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
    
    // Agent (Hierarchical Agent System)
    agent: {
      // Task Execution
      executeTask: (task: string) => Promise<{ success: boolean; plan?: TaskPlan; error?: string }>
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
    }
  }
}

