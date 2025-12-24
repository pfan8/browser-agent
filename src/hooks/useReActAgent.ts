/**
 * useReActAgent Hook
 * 
 * Simplified React hook for the ReAct agent system.
 * All user input goes directly to the agent - no command parsing.
 * 
 * Architecture:
 * - User input → Sanitize → Agent (ReAct) → Execute
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { Operation, ChatMessage, ExecutionStep } from '@dsl/types';

// ============================================
// Types
// ============================================

interface TaskStep {
  id: string;
  description: string;
  tool: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
}

interface TaskPlan {
  id: string;
  goal: string;
  steps: TaskStep[];
  currentStepIndex: number;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
}

interface AgentProgress {
  total: number;
  completed: number;
  failed: number;
  pending: number;
  percentage: number;
}

interface SessionInfo {
  id: string;
  name: string;
  description?: string;
  checkpointCount?: number;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

interface CheckpointInfo {
  id: string;
  threadId: string;
  createdAt: string;
  step: number;
  messagePreview?: string;
  isUserMessage: boolean;
  parentCheckpointId?: string;
  // Legacy fields for backward compatibility
  name?: string;
  description?: string;
  stepIndex?: number;
  isAutoSave?: boolean;
}

// Extended ChatMessage with plan support
interface AgentChatMessage extends ChatMessage {
  plan?: TaskPlan;
}

// Toast callback interface for lightweight notifications
interface ToastCallbacks {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

// Hook options
interface UseReActAgentOptions {
  toast?: ToastCallbacks;
}

interface ReActAgentHookReturn {
  // Messages & Operations
  messages: AgentChatMessage[];
  operations: Operation[];
  
  // Connection State
  isConnected: boolean;
  isProcessing: boolean;
  
  // Agent State
  currentPlan: TaskPlan | null;
  progress: AgentProgress | null;
  status: string;
  isRunning: boolean;
  traceId: string | null;
  
  // Sessions & Checkpoints
  sessions: SessionInfo[];
  currentSessionId: string | null;
  checkpoints: CheckpointInfo[];
  
  // Main Actions
  sendMessage: (content: string, editCheckpointId?: string) => Promise<void>;
  connectBrowser: (url?: string) => Promise<void>;
  disconnectBrowser: () => Promise<void>;
  
  // Recording
  clearRecording: () => void;
  exportScript: () => Promise<string | null>;
  
  // Task Control
  stopTask: () => Promise<void>;
  
  // Session Management
  createSession: (name: string, description?: string) => Promise<void>;
  loadSession: (sessionId: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  refreshSessions: () => Promise<void>;
  
  // Checkpoint Management
  createCheckpoint: (name: string, description?: string) => Promise<void>;
  restoreCheckpoint: (checkpointId: string, threadId?: string) => Promise<void>;
  restoreLatest: (threadId?: string) => Promise<void>;
  deleteCheckpoint: (checkpointId: string) => Promise<void>;
  refreshCheckpoints: (threadId?: string) => Promise<void>;
  
  // Utility
  refreshStatus: () => Promise<void>;
  clearMessages: () => void;
}

// ============================================
// Input Sanitization
// ============================================

function sanitizeInput(input: string): string {
  // Trim whitespace
  let sanitized = input.trim();
  
  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');
  
  // Remove control characters (except newlines)
  sanitized = sanitized.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return sanitized;
}

// ============================================
// Hook Implementation
// ============================================

export function useReActAgent(options: UseReActAgentOptions = {}): ReActAgentHookReturn {
  const { toast } = options;
  // ============================================
  // State
  // ============================================
  
  // Messages & Operations
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  
  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Agent State
  const [currentPlan, setCurrentPlan] = useState<TaskPlan | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [traceId, setTraceId] = useState<string | null>(null);
  
  // Sessions & Checkpoints
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  
  // API availability
  const hasElectronAPI = typeof window !== 'undefined' && window.electronAPI;
  const hasAgentAPI = hasElectronAPI && window.electronAPI?.agent;
  
  // Track current task message for execution steps
  const currentTaskMsgRef = useRef<string | null>(null);
  const executionStepsRef = useRef<ExecutionStep[]>([]);

  // ============================================
  // Message Helpers
  // ============================================

  const addMessage = useCallback((
    role: 'user' | 'agent' | 'system',
    content: string,
    status?: AgentChatMessage['status'],
    error?: string,
    thinking?: string,
    plan?: TaskPlan,
    type?: AgentChatMessage['type']
  ): AgentChatMessage => {
    const message: AgentChatMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      status,
      error,
      thinking,
      plan,
      type,
    };
    setMessages(prev => [...prev, message]);
    return message;
  }, []);

  const updateMessage = useCallback((id: string, updates: Partial<AgentChatMessage>) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, ...updates } : msg
    ));
  }, []);

  // Add or update an execution step
  const addExecutionStep = useCallback((step: ExecutionStep) => {
    const msgId = currentTaskMsgRef.current;
    if (!msgId) return;
    
    executionStepsRef.current = [...executionStepsRef.current, step];
    
    setMessages(prev => prev.map(msg => 
      msg.id === msgId 
        ? { ...msg, executionSteps: [...executionStepsRef.current] }
        : msg
    ));
  }, []);

  // Update an existing execution step
  const updateExecutionStep = useCallback((stepId: string, updates: Partial<ExecutionStep>) => {
    const msgId = currentTaskMsgRef.current;
    if (!msgId) return;
    
    executionStepsRef.current = executionStepsRef.current.map(step =>
      step.id === stepId ? { ...step, ...updates } : step
    );
    
    setMessages(prev => prev.map(msg => 
      msg.id === msgId 
        ? { ...msg, executionSteps: [...executionStepsRef.current] }
        : msg
    ));
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // ============================================
  // Status & Session Refresh
  // ============================================

  const refreshStatus = useCallback(async () => {
    if (!hasAgentAPI) return;
    
    try {
      const statusData = await window.electronAPI.agent.getStatus();
      setStatus(statusData.status);
      setIsRunning(statusData.isRunning);
      setCurrentPlan(statusData.currentPlan);
      setProgress(statusData.progress);
    } catch (e) {
      console.error('Failed to refresh status:', e);
    }
  }, [hasAgentAPI]);

  const refreshSessions = useCallback(async () => {
    if (!hasAgentAPI) return;
    
    try {
      const sessionList = await window.electronAPI.agent.listSessions();
      setSessions(sessionList);
      
      const currentId = await window.electronAPI.agent.getCurrentSession();
      setCurrentSessionId(currentId);
    } catch (e) {
      console.error('Failed to refresh sessions:', e);
    }
  }, [hasAgentAPI]);

  const refreshCheckpoints = useCallback(async (threadId?: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const targetThreadId = threadId || currentSessionId;
      if (targetThreadId) {
        const checkpointList = await window.electronAPI.agent.getCheckpointHistory(targetThreadId);
        setCheckpoints(checkpointList);
      } else {
        const checkpointList = await window.electronAPI.agent.listCheckpoints();
        setCheckpoints(checkpointList);
      }
    } catch (e) {
      console.error('Failed to refresh checkpoints:', e);
    }
  }, [hasAgentAPI, currentSessionId]);

  // ============================================
  // Browser Connection (via Agent)
  // ============================================

  const connectBrowser = useCallback(async (url?: string) => {
    if (!hasElectronAPI) {
      addMessage('agent', '⚠️ Electron API not available. Running in browser mode.', 'error');
      return;
    }

    const cdpUrl = url || 'http://localhost:9222';
    setIsProcessing(true);

    const msgId = addMessage('agent', `正在连接浏览器 ${cdpUrl}...`, 'processing').id;

    try {
      const result = await window.electronAPI.connectBrowser(cdpUrl);
      if (result.success) {
        setIsConnected(true);
        updateMessage(msgId, {
          content: `✓ 已连接到浏览器 ${cdpUrl}`,
          status: 'success'
        });
      } else {
        updateMessage(msgId, {
          content: `✗ 连接失败: ${result.error}`,
          status: 'error',
          error: result.error
        });
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      updateMessage(msgId, {
        content: `✗ 连接失败: ${errorMsg}`,
        status: 'error',
        error: errorMsg
      });
    } finally {
      setIsProcessing(false);
    }
  }, [hasElectronAPI, addMessage, updateMessage]);

  const disconnectBrowser = useCallback(async () => {
    if (!hasElectronAPI) return;
    
    try {
      await window.electronAPI.disconnectBrowser();
      setIsConnected(false);
      addMessage('agent', '✓ 已断开浏览器连接', 'success');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage('agent', `✗ 断开连接失败: ${errorMsg}`, 'error', errorMsg);
    }
  }, [hasElectronAPI, addMessage]);

  // ============================================
  // Recording Management
  // ============================================

  const clearRecording = useCallback(() => {
    setOperations([]);
    addMessage('agent', '✓ 录制已清空', 'success');
  }, [addMessage]);

  const exportScript = useCallback(async (): Promise<string | null> => {
    if (!hasElectronAPI) {
      addMessage('agent', '⚠️ Electron API not available', 'error');
      return null;
    }

    if (operations.length === 0) {
      addMessage('agent', '⚠️ 没有可导出的操作', 'error');
      return null;
    }

    try {
      const result = await window.electronAPI.exportToPlaywright();
      if (result.success && result.script) {
        addMessage('agent', '✓ Playwright 脚本已生成', 'success');
        return result.script;
      } else {
        addMessage('agent', `✗ 生成脚本失败: ${result.error}`, 'error');
        return null;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage('agent', `✗ 导出失败: ${errorMsg}`, 'error');
      return null;
    }
  }, [hasElectronAPI, operations.length, addMessage]);

  // ============================================
  // Task Execution (All input goes to Agent)
  // ============================================

  const executeTask = useCallback(async (task: string) => {
    if (!hasAgentAPI) {
      addMessage('agent', '⚠️ Agent API 不可用', 'error');
      return;
    }

    // Reset execution steps tracking
    executionStepsRef.current = [];
    const msgId = addMessage('agent', '🔄 正在分析任务...', 'processing', undefined, undefined, undefined, 'task').id;
    currentTaskMsgRef.current = msgId;
    setIsRunning(true);
    
    try {
      // Execute task with current session ID for continuation
      const result = await window.electronAPI.agent.executeTask(task, {
        threadId: currentSessionId || undefined,
        continueSession: !!currentSessionId,
      });
      
      if (result.success) {
        // Show success message with summary if available
        const successContent = result.result 
          ? String(result.result) 
          : `✓ 任务完成`;
        updateMessage(msgId, {
          content: successContent,
          status: 'success',
          plan: result.plan,
          executionSteps: [...executionStepsRef.current],
        });
      } else {
        // Show full failure summary if available, otherwise show error
        const failureContent = result.result 
          ? String(result.result) 
          : `✗ 任务失败: ${result.error || 'Unknown error'}`;
        updateMessage(msgId, {
          content: failureContent,
          status: 'error',
          error: result.error,
          executionSteps: [...executionStepsRef.current],
        });
      }
      
      await refreshStatus();
      
      // Refresh sessions to update message count
      await refreshSessions();
    } catch (e) {
      updateMessage(msgId, {
        content: `✗ 错误: ${e instanceof Error ? e.message : 'Unknown error'}`,
        status: 'error',
        executionSteps: [...executionStepsRef.current],
      });
    } finally {
      setIsRunning(false);
      currentTaskMsgRef.current = null;
    }
  }, [hasAgentAPI, addMessage, updateMessage, refreshStatus, refreshSessions, currentSessionId]);

  const stopTask = useCallback(async () => {
    if (!hasAgentAPI) return;
    
    try {
      await window.electronAPI.agent.stopTask();
      addMessage('system', '⏹️ 任务已停止', 'success');
      setIsRunning(false);
      setIsProcessing(false);
      await refreshStatus();
    } catch (e) {
      addMessage('system', `✗ 停止失败: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshStatus]);

  // ============================================
  // Main Send Message Handler (All Input → Agent)
  // ============================================

  const sendMessage = useCallback(async (content: string, editCheckpointId?: string) => {
    // Sanitize input
    const sanitized = sanitizeInput(content);
    if (!sanitized) return;

    setIsProcessing(true);

    try {
      // Check if Electron API is available
      if (!hasElectronAPI) {
        addMessage('agent', '⚠️ Electron API 不可用', 'error');
        return;
      }

      // Check if Agent API is available
      if (!hasAgentAPI) {
        addMessage('agent', '⚠️ Agent API 不可用，请检查设置', 'error');
        return;
      }

      // Check if LLM is available
      const llmAvailable = await window.electronAPI.isLLMAvailable();
      if (!llmAvailable) {
        addMessage('agent', '💡 LLM 未配置，请在设置中配置 API Key', 'error');
        return;
      }

      // If editing a previous message, restore checkpoint first
      if (editCheckpointId) {
        console.log('Restoring checkpoint before edit:', editCheckpointId);
        const restoreResult = await window.electronAPI.agent.restoreCheckpoint(editCheckpointId);
        if (!restoreResult.success) {
          addMessage('agent', `⚠️ 恢复检查点失败: ${restoreResult.error || '未知错误'}`, 'error');
          return;
        }
        // Reload messages after checkpoint restore via getConversation
        const conversation = await window.electronAPI.agent.getConversation();
        if (conversation && conversation.length > 0) {
          const restoredMessages: AgentChatMessage[] = conversation.map((msg) => ({
            id: msg.id,
            role: (msg.role === 'assistant' ? 'agent' : msg.role) as 'user' | 'agent' | 'system',
            content: msg.content,
            timestamp: msg.timestamp,
            status: 'success' as const,
          }));
          setMessages(restoredMessages);
        } else {
          // No messages in checkpoint, clear the UI
          setMessages([]);
        }
        toast?.info('已恢复到编辑点');
      }

      // Add user message
      addMessage('user', sanitized);

      // Send directly to agent for processing
      console.log('Sending to ReAct Agent:', sanitized);
      await executeTask(sanitized);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage('agent', `✗ 错误: ${errorMsg}`, 'error', errorMsg);
    } finally {
      setIsProcessing(false);
    }
  }, [addMessage, hasElectronAPI, hasAgentAPI, executeTask, toast, setMessages]);

  // ============================================
  // Session Management
  // ============================================

  const createSession = useCallback(async (name: string, description?: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.createSession(name, description);
      if (result.success && result.session) {
        toast?.success(`会话已创建: ${result.session.name}`);
        await refreshSessions();
        await refreshCheckpoints();
      } else {
        toast?.error(`创建会话失败: ${result.error}`);
      }
    } catch (e) {
      toast?.error(`错误: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }, [hasAgentAPI, toast, refreshSessions, refreshCheckpoints]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.loadSession(sessionId);
      if (result.success) {
        // Set the current session ID
        setCurrentSessionId(sessionId);
        
        // Load conversation history from the session
        const conversation = await window.electronAPI.agent.getConversation(sessionId);
        
        if (conversation && conversation.length > 0) {
          // Convert backend ConversationMessage to UI AgentChatMessage format
          // Map 'assistant' role to 'agent' for UI compatibility
          const restoredMessages: AgentChatMessage[] = conversation.map(msg => ({
            id: msg.id,
            role: (msg.role === 'assistant' ? 'agent' : msg.role) as 'user' | 'agent' | 'system',
            content: msg.content,
            timestamp: msg.timestamp,
            status: 'success' as const,
          }));
          
          // Replace current messages with the loaded conversation
          setMessages(restoredMessages);
          
          // Show toast for session switch
          const session = sessions.find(s => s.id === sessionId);
          const sessionName = session?.name || sessionId.substring(0, 12);
          toast?.info(`已切换到会话: ${sessionName}`);
        } else {
          // No conversation history, clear messages and show toast
          setMessages([]);
          
          const session = sessions.find(s => s.id === sessionId);
          const sessionName = session?.name || sessionId.substring(0, 12);
          // Check if metadata showed messages but data is empty (data loss scenario)
          const expectedMessageCount = session?.messageCount || 0;
          if (expectedMessageCount > 0) {
            toast?.error(`已切换到会话: ${sessionName} (历史消息已丢失，可能因为使用了内存模式)`);
          } else {
            toast?.info(`已切换到会话: ${sessionName} (无历史消息)`);
          }
        }
        
        await refreshSessions();
        await refreshStatus();
        // Also refresh checkpoints for the loaded session
        await refreshCheckpoints(sessionId);
      } else {
        toast?.error(`加载会话失败: ${result.error}`);
      }
    } catch (e) {
      toast?.error(`错误: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }, [hasAgentAPI, toast, refreshSessions, refreshStatus, refreshCheckpoints, sessions, setMessages]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const success = await window.electronAPI.agent.deleteSession(sessionId);
      if (success) {
        toast?.success('会话已删除');
        await refreshSessions();
      } else {
        toast?.error('删除会话失败');
      }
    } catch (e) {
      toast?.error(`错误: ${e instanceof Error ? e.message : 'Unknown'}`);
    }
  }, [hasAgentAPI, toast, refreshSessions]);

  // ============================================
  // Checkpoint Management
  // ============================================

  const createCheckpoint = useCallback(async (name: string, description?: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.createCheckpoint(name, description);
      if (result.success) {
        addMessage('system', `💾 检查点已保存: ${name}`, 'success');
        await refreshCheckpoints();
      } else {
        addMessage('system', `✗ 创建检查点失败: ${result.error}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshCheckpoints]);

  const restoreCheckpoint = useCallback(async (checkpointId: string, threadId?: string) => {
    if (!hasAgentAPI) return;
    
    const targetThreadId = threadId || currentSessionId;
    if (!targetThreadId) {
      addMessage('system', `✗ 恢复失败: 没有选择会话`, 'error');
      return;
    }
    
    try {
      const result = await window.electronAPI.agent.restoreCheckpoint(targetThreadId, checkpointId);
      if (result.success && result.state) {
        // Restore messages from the checkpoint
        if (result.state.messages && result.state.messages.length > 0) {
          const restoredMessages: AgentChatMessage[] = result.state.messages.map((msg: { id: string; role: string; content: string; timestamp: string }) => ({
            id: msg.id,
            role: (msg.role === 'assistant' ? 'agent' : msg.role) as 'user' | 'agent' | 'system',
            content: msg.content,
            timestamp: msg.timestamp,
            status: 'success' as const,
          }));
          setMessages(restoredMessages);
        }
        
        toast?.success('已恢复到检查点');
        await refreshStatus();
        await refreshCheckpoints(targetThreadId);
      } else {
        addMessage('system', `✗ 恢复失败: ${result.error || '检查点未找到'}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshStatus, refreshCheckpoints, currentSessionId, toast, setMessages]);

  const restoreLatest = useCallback(async (threadId?: string) => {
    if (!hasAgentAPI) return;
    
    const targetThreadId = threadId || currentSessionId;
    
    try {
      const result = await window.electronAPI.agent.restoreLatest(targetThreadId || undefined);
      if (result.success && result.state) {
        // Restore messages from the latest checkpoint
        if (result.state.messages && result.state.messages.length > 0) {
          const restoredMessages: AgentChatMessage[] = result.state.messages.map((msg: { id: string; role: string; content: string; timestamp: string }) => ({
            id: msg.id,
            role: (msg.role === 'assistant' ? 'agent' : msg.role) as 'user' | 'agent' | 'system',
            content: msg.content,
            timestamp: msg.timestamp,
            status: 'success' as const,
          }));
          setMessages(restoredMessages);
        }
        
        toast?.success('已恢复到最新检查点');
        await refreshStatus();
      } else {
        addMessage('system', `✗ 恢复失败: ${result.error || '无可用检查点'}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshStatus, currentSessionId, toast, setMessages]);

  const deleteCheckpoint = useCallback(async (checkpointId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const success = await window.electronAPI.agent.deleteCheckpoint(checkpointId);
      if (success) {
        addMessage('system', `🗑️ 检查点已删除`, 'success');
        await refreshCheckpoints();
      } else {
        addMessage('system', `✗ 删除检查点失败`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshCheckpoints]);

  // ============================================
  // Event Listeners & Initialization
  // ============================================

  useEffect(() => {
    if (!hasElectronAPI) return;

    // Listen for operations from the main process
    const handleOperation = (operation: Operation) => {
      setOperations(prev => [...prev, operation]);
    };

    const unsubscribe = window.electronAPI.onOperationRecorded(handleOperation);

    // Check initial connection status
    window.electronAPI.getBrowserStatus().then(status => {
      setIsConnected(status.connected);
    });

    // Listen for browser status changes (from auto-connect)
    let unsubscribeStatus: (() => void) | undefined;
    if (window.electronAPI.onBrowserStatusChanged) {
      unsubscribeStatus = window.electronAPI.onBrowserStatusChanged((status) => {
        setIsConnected(status.connected);
      });
    }

    // Cleanup: remove event listener when effect re-runs or component unmounts
    return () => {
      unsubscribe();
      unsubscribeStatus?.();
    };
  }, [hasElectronAPI]);

  // Agent event subscriptions - using refs to avoid re-subscribing when callbacks change
  const addMessageRef = useRef(addMessage);
  const refreshStatusRef = useRef(refreshStatus);
  const addExecutionStepRef = useRef(addExecutionStep);
  const updateExecutionStepRef = useRef(updateExecutionStep);
  
  // Keep refs updated
  useEffect(() => {
    addMessageRef.current = addMessage;
    refreshStatusRef.current = refreshStatus;
    addExecutionStepRef.current = addExecutionStep;
    updateExecutionStepRef.current = updateExecutionStep;
  }, [addMessage, refreshStatus, addExecutionStep, updateExecutionStep]);

  useEffect(() => {
    if (!hasAgentAPI) return;

    // Subscribe to agent events - store unsubscribe functions for cleanup
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      window.electronAPI.agent.onStatusChanged((data) => {
        setStatus(data.status);
      })
    );

    // Subscribe to trace ID updates
    if (window.electronAPI.agent.onTraceId) {
      unsubscribers.push(
        window.electronAPI.agent.onTraceId((data) => {
          setTraceId(data.traceId);
        })
      );
    }

    unsubscribers.push(
      window.electronAPI.agent.onPlanCreated((data) => {
        setCurrentPlan(data.plan);
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepStarted((data: unknown) => {
        const stepData = data as { 
          step?: { id?: string; description?: string; tool?: string };
          node?: string;
          observation?: { url?: string; title?: string };
          action?: { instruction?: string; thought?: string };
        } | undefined;
        
        if (stepData?.step) {
          // Map node names to step types
          const stepType = stepData.node === 'planner' ? 'planner' : 
                          stepData.node === 'observe' ? 'observe' : 'codeact';
          
          const step: ExecutionStep = {
            id: stepData.step.id || uuidv4(),
            type: stepType,
            timestamp: new Date().toISOString(),
            content: stepData.step.description || `执行中...`,
            tool: stepData.step.tool,
            status: 'running',
            observation: stepData.observation,
            thought: stepData.action?.thought,
            instruction: stepData.action?.instruction,
          };
          
          addExecutionStepRef.current(step);
        }
        refreshStatusRef.current();
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepCompleted((data: unknown) => {
        const stepData = data as { 
          step?: { id?: string; description?: string };
          duration?: number;
          thought?: string;
          instruction?: string;
          observation?: { url?: string; title?: string };
        } | undefined;
        
        if (stepData?.step?.id) {
          updateExecutionStepRef.current(stepData.step.id, {
            status: 'success',
            duration: stepData.duration,
            content: stepData.step.description || '',
            thought: stepData.thought,
            instruction: stepData.instruction,
            observation: stepData.observation,
          });
        }
        refreshStatusRef.current();
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepFailed((data: unknown) => {
        const stepData = data as { 
          step?: { id?: string; description?: string; tool?: string }; 
          error?: string;
          action?: { tool?: string; result?: { error?: string } };
          duration?: number;
        } | undefined;
        
        // Build detailed error message
        const errorMsg = stepData?.action?.result?.error || stepData?.error || 'Unknown error';
        
        if (stepData?.step?.id) {
          updateExecutionStepRef.current(stepData.step.id, {
            status: 'error',
            error: errorMsg,
            duration: stepData.duration,
            content: stepData.step.description || '执行失败',
          });
        }
        
        refreshStatusRef.current();
      })
    );

    // Subscribe to streaming updates (if available)
    if (window.electronAPI.agent.onThinkingUpdate) {
      unsubscribers.push(
        window.electronAPI.agent.onThinkingUpdate((data: { stepId: string; thought: string; instruction: string }) => {
          if (data.stepId) {
            updateExecutionStepRef.current(data.stepId, {
              thought: data.thought,
              instruction: data.instruction,
            });
          }
        })
      );
    }

    if (window.electronAPI.agent.onCodeUpdate) {
      unsubscribers.push(
        window.electronAPI.agent.onCodeUpdate((data: { stepId: string; code: string; instruction: string }) => {
          if (data.stepId) {
            updateExecutionStepRef.current(data.stepId, {
              code: data.code,
              instruction: data.instruction,
            });
          }
        })
      );
    }

    unsubscribers.push(
      window.electronAPI.agent.onTaskCompleted(() => {
        setIsRunning(false);
        refreshStatusRef.current();
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onTaskFailed((data: unknown) => {
        setIsRunning(false);
        
        // If there's a message/summary in the failure data, it will be handled by executeTask
        // This is just for state updates
        const failData = data as { error?: string; message?: string } | undefined;
        if (failData?.message) {
          // Task failure with summary - the summary should already be shown by executeTask
          console.log('Task failed with summary');
        }
        
        refreshStatusRef.current();
      })
    );

    // Initial data load
    refreshStatusRef.current();
    refreshSessions();
    refreshCheckpoints();

    // Cleanup: remove all event listeners when effect re-runs or component unmounts
    return () => {
      unsubscribers.forEach(unsub => unsub());
    };
  }, [hasAgentAPI, refreshSessions, refreshCheckpoints]);

  // ============================================
  // Return Hook Interface
  // ============================================

  return {
    // Messages & Operations
    messages,
    operations,
    
    // Connection State
    isConnected,
    isProcessing,
    
    // Agent State
    currentPlan,
    progress,
    status,
    isRunning,
    traceId,
    
    // Sessions & Checkpoints
    sessions,
    currentSessionId,
    checkpoints,
    
    // Main Actions
    sendMessage,
    connectBrowser,
    disconnectBrowser,
    
    // Recording
    clearRecording,
    exportScript,
    
    // Task Control
    stopTask,
    
    // Session Management
    createSession,
    loadSession,
    deleteSession,
    refreshSessions,
    
    // Checkpoint Management
    createCheckpoint,
    restoreCheckpoint,
    restoreLatest,
    deleteCheckpoint,
    refreshCheckpoints,
    
    // Utility
    refreshStatus,
    clearMessages,
  };
}

