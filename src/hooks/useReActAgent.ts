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
import type { Operation, ChatMessage } from '@dsl/types';

// ============================================
// Types
// ============================================

interface PageInfo {
  url: string;
  title: string;
}

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
  checkpointCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CheckpointInfo {
  id: string;
  name: string;
  description?: string;
  stepIndex: number;
  createdAt: string;
  isAutoSave: boolean;
}

// Extended ChatMessage with plan support
interface AgentChatMessage extends ChatMessage {
  plan?: TaskPlan;
}

interface ReActAgentHookReturn {
  // Messages & Operations
  messages: AgentChatMessage[];
  operations: Operation[];
  
  // Connection State
  isConnected: boolean;
  isProcessing: boolean;
  currentPageInfo: PageInfo | null;
  isLoadingPageInfo: boolean;
  
  // Agent State
  currentPlan: TaskPlan | null;
  progress: AgentProgress | null;
  status: string;
  isRunning: boolean;
  
  // Sessions & Checkpoints
  sessions: SessionInfo[];
  currentSessionId: string | null;
  checkpoints: CheckpointInfo[];
  
  // Main Actions
  sendMessage: (content: string) => Promise<void>;
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
  restoreCheckpoint: (checkpointId: string) => Promise<void>;
  restoreLatest: () => Promise<void>;
  deleteCheckpoint: (checkpointId: string) => Promise<void>;
  refreshCheckpoints: () => Promise<void>;
  
  // Utility
  refreshPageInfo: (showLoading?: boolean) => Promise<void>;
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

export function useReActAgent(): ReActAgentHookReturn {
  // ============================================
  // State
  // ============================================
  
  // Messages & Operations
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [operations, setOperations] = useState<Operation[]>([]);
  
  // Connection State
  const [isConnected, setIsConnected] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentPageInfo, setCurrentPageInfo] = useState<PageInfo | null>(null);
  const [isLoadingPageInfo, setIsLoadingPageInfo] = useState(false);
  
  // Agent State
  const [currentPlan, setCurrentPlan] = useState<TaskPlan | null>(null);
  const [progress, setProgress] = useState<AgentProgress | null>(null);
  const [status, setStatus] = useState<string>('idle');
  const [isRunning, setIsRunning] = useState(false);
  
  // Sessions & Checkpoints
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<CheckpointInfo[]>([]);
  
  // API availability
  const hasElectronAPI = typeof window !== 'undefined' && window.electronAPI;
  const hasAgentAPI = hasElectronAPI && window.electronAPI?.agent;

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

  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // ============================================
  // Page Info Management
  // ============================================

  const refreshPageInfo = useCallback(async (showLoading = true) => {
    if (!hasElectronAPI || !isConnected) {
      setCurrentPageInfo(null);
      setIsLoadingPageInfo(false);
      return;
    }
    if (showLoading) {
      setIsLoadingPageInfo(true);
    }
    try {
      const info = await window.electronAPI.getPageInfo();
      setCurrentPageInfo(info);
    } catch {
      setCurrentPageInfo(null);
    } finally {
      if (showLoading) {
        setIsLoadingPageInfo(false);
      }
    }
  }, [hasElectronAPI, isConnected]);

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

  const refreshCheckpoints = useCallback(async () => {
    if (!hasAgentAPI) return;
    
    try {
      const checkpointList = await window.electronAPI.agent.listCheckpoints();
      setCheckpoints(checkpointList);
    } catch (e) {
      console.error('Failed to refresh checkpoints:', e);
    }
  }, [hasAgentAPI]);

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
        setIsLoadingPageInfo(true);
        updateMessage(msgId, {
          content: `✓ 已连接到浏览器 ${cdpUrl}`,
          status: 'success'
        });
        // Fetch current page info after connecting
        try {
          const pageInfo = await window.electronAPI.getPageInfo();
          setCurrentPageInfo(pageInfo);
        } finally {
          setIsLoadingPageInfo(false);
        }
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
      setCurrentPageInfo(null);
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

    const msgId = addMessage('agent', '🔄 正在分析任务...', 'processing', undefined, undefined, undefined, 'task').id;
    setIsRunning(true);
    
    try {
      const result = await window.electronAPI.agent.executeTask(task);
      
      if (result.success) {
        // Show success message with summary if available
        const successContent = result.result 
          ? String(result.result) 
          : `✓ 任务完成`;
        updateMessage(msgId, {
          content: successContent,
          status: 'success',
          plan: result.plan,
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
        });
      }
      
      await refreshStatus();
    } catch (e) {
      updateMessage(msgId, {
        content: `✗ 错误: ${e instanceof Error ? e.message : 'Unknown error'}`,
        status: 'error',
      });
    } finally {
      setIsRunning(false);
    }
  }, [hasAgentAPI, addMessage, updateMessage, refreshStatus]);

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

  const sendMessage = useCallback(async (content: string) => {
    // Sanitize input
    const sanitized = sanitizeInput(content);
    if (!sanitized) return;

    // Add user message
    addMessage('user', sanitized);
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

      // Send directly to agent for processing
      console.log('Sending to ReAct Agent:', sanitized);
      await executeTask(sanitized);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addMessage('agent', `✗ 错误: ${errorMsg}`, 'error', errorMsg);
    } finally {
      setIsProcessing(false);
    }
  }, [addMessage, hasElectronAPI, hasAgentAPI, executeTask]);

  // ============================================
  // Session Management
  // ============================================

  const createSession = useCallback(async (name: string, description?: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.createSession(name, description);
      if (result.success && result.session) {
        addMessage('system', `📁 会话已创建: ${result.session.name}`, 'success');
        await refreshSessions();
        await refreshCheckpoints();
      } else {
        addMessage('system', `✗ 创建会话失败: ${result.error}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshSessions, refreshCheckpoints]);

  const loadSession = useCallback(async (sessionId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.loadSession(sessionId);
      if (result.success) {
        // Load conversation history from the session and restore to UI
        const conversation = await window.electronAPI.agent.getConversation();
        
        // Convert backend ConversationMessage to UI AgentChatMessage format
        const restoredMessages: AgentChatMessage[] = conversation.map(msg => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp,
          status: 'success' as const,
        }));
        
        // Replace current messages with the loaded conversation
        setMessages(restoredMessages);
        
        await refreshSessions();
        await refreshCheckpoints();
        await refreshStatus();
      } else {
        addMessage('system', `✗ 加载会话失败: ${result.error}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshSessions, refreshCheckpoints, refreshStatus]);

  const deleteSession = useCallback(async (sessionId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const success = await window.electronAPI.agent.deleteSession(sessionId);
      if (success) {
        addMessage('system', `🗑️ 会话已删除`, 'success');
        await refreshSessions();
      } else {
        addMessage('system', `✗ 删除会话失败`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshSessions]);

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

  const restoreCheckpoint = useCallback(async (checkpointId: string) => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.restoreCheckpoint(checkpointId);
      if (result.success) {
        addMessage('system', `⏪ 已恢复到检查点`, 'success');
        await refreshStatus();
        await refreshCheckpoints();
      } else {
        addMessage('system', `✗ 恢复失败: ${result.error}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshStatus, refreshCheckpoints]);

  const restoreLatest = useCallback(async () => {
    if (!hasAgentAPI) return;
    
    try {
      const result = await window.electronAPI.agent.restoreLatest();
      if (result.success) {
        addMessage('system', `⏪ 已恢复到最新检查点`, 'success');
        await refreshStatus();
      } else {
        addMessage('system', `✗ 恢复失败: ${result.error}`, 'error');
      }
    } catch (e) {
      addMessage('system', `✗ 错误: ${e instanceof Error ? e.message : 'Unknown'}`, 'error');
    }
  }, [hasAgentAPI, addMessage, refreshStatus]);

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

    // Cleanup: remove event listener when effect re-runs or component unmounts
    return () => {
      unsubscribe();
    };
  }, [hasElectronAPI]);

  // Agent event subscriptions - using refs to avoid re-subscribing when callbacks change
  const addMessageRef = useRef(addMessage);
  const refreshStatusRef = useRef(refreshStatus);
  
  // Keep refs updated
  useEffect(() => {
    addMessageRef.current = addMessage;
    refreshStatusRef.current = refreshStatus;
  }, [addMessage, refreshStatus]);

  useEffect(() => {
    if (!hasAgentAPI) return;

    // Subscribe to agent events - store unsubscribe functions for cleanup
    const unsubscribers: (() => void)[] = [];

    unsubscribers.push(
      window.electronAPI.agent.onStatusChanged((data) => {
        setStatus(data.status);
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onPlanCreated((data) => {
        setCurrentPlan(data.plan);
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepStarted((data: unknown) => {
        const stepData = data as { step?: { description?: string } } | undefined;
        if (stepData?.step?.description) {
          addMessageRef.current('system', `▶️ ${stepData.step.description}`, 'processing');
        }
        refreshStatusRef.current();
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepCompleted((data: unknown) => {
        const stepData = data as { step?: { description?: string } } | undefined;
        if (stepData?.step?.description) {
          // Update last message status instead of adding new message
          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === 'system' && lastMsg.status === 'processing') {
              return prev.slice(0, -1).concat({
                ...lastMsg,
                content: `✓ ${stepData.step?.description}`,
                status: 'success'
              });
            }
            return prev;
          });
        }
        refreshStatusRef.current();
      })
    );

    unsubscribers.push(
      window.electronAPI.agent.onStepFailed((data: unknown) => {
        const stepData = data as { 
          step?: { description?: string; tool?: string }; 
          error?: string;
          action?: { tool?: string; result?: { error?: string } };
        } | undefined;
        
        // Build detailed error message
        const tool = stepData?.action?.tool || stepData?.step?.tool || 'unknown';
        const errorMsg = stepData?.action?.result?.error || stepData?.error || 'Unknown error';
        const description = stepData?.step?.description || tool;
        
        // Update last message status instead of adding new message
        setMessages(prev => {
          const lastMsg = prev[prev.length - 1];
          if (lastMsg && lastMsg.role === 'system' && lastMsg.status === 'processing') {
            return prev.slice(0, -1).concat({
              ...lastMsg,
              content: `✗ ${description}\n⚠️ 错误: ${errorMsg}`,
              status: 'error'
            });
          }
          return prev;
        });
        
        refreshStatusRef.current();
      })
    );

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

  // Auto-refresh page info periodically when connected
  useEffect(() => {
    if (!isConnected) return;
    
    const interval = setInterval(() => {
      refreshPageInfo(false);
    }, 5000);
    
    return () => clearInterval(interval);
  }, [isConnected, refreshPageInfo]);

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
    currentPageInfo,
    isLoadingPageInfo,
    
    // Agent State
    currentPlan,
    progress,
    status,
    isRunning,
    
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
    refreshPageInfo,
    refreshStatus,
    clearMessages,
  };
}

