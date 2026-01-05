import { useState, useCallback, useEffect, useRef } from 'react'
import ChatPanel from './components/ChatPanel'
import OperationPreview from './components/OperationPreview'
import SettingsPanel from './components/SettingsPanel'
import { SessionPanel } from './components/SessionPanel'
import { ConfirmationDialog } from './components/ConfirmationDialog'
import { ToastContainer } from './components/Toast'
import { useReActAgent } from './hooks/useReActAgent'
import { useToast } from './hooks/useToast'
import type { ConfirmationRequest } from '../electron/agent/safety/types'

interface ContextInfo {
  index: number;
  pageCount: number;
  isActive: boolean;
}

function App() {
  // Toast notifications for lightweight feedback
  const { toasts, dismissToast, success, error, info } = useToast()
  
  // ReAct Agent hook - all input goes to agent
  const { 
    messages, 
    operations, 
    isConnected, 
    isProcessing,
    sendMessage, 
    connectBrowser, 
    disconnectBrowser,
    clearRecording,
    exportScript,
    // Agent features
    sessions,
    currentSessionId,
    checkpoints,
    currentPlan,
    beadsPlan,
    progress,
    status: agentStatus,
    isRunning: isAgentRunning,
    traceId,
    stopTask,
    createSession,
    loadSession,
    deleteSession,
  } = useReActAgent({ toast: { success, error, info } })
  
  const [showPreview, setShowPreview] = useState(false)
  const [showAgentPanel, setShowAgentPanel] = useState(true)
  const [exportedScript, setExportedScript] = useState<string | null>(null)
  const [showContextDropdown, setShowContextDropdown] = useState(false)
  const [contexts, setContexts] = useState<ContextInfo[]>([])
  const [loadingContexts, setLoadingContexts] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [pendingConfirmation, setPendingConfirmation] = useState<ConfirmationRequest | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowContextDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch contexts info
  const fetchContexts = useCallback(async () => {
    if (!isConnected || !window.electronAPI) return
    
    setLoadingContexts(true)
    try {
      const contextsInfo = await window.electronAPI.getContextsInfo()
      setContexts(contextsInfo)
    } catch (e) {
      console.error('Failed to fetch contexts:', e)
    } finally {
      setLoadingContexts(false)
    }
  }, [isConnected])

  // Toggle context dropdown
  const handleContextDropdownToggle = useCallback(() => {
    const willOpen = !showContextDropdown
    setShowContextDropdown(willOpen)
    
    if (willOpen && isConnected) {
      fetchContexts()
    }
  }, [showContextDropdown, isConnected, fetchContexts])

  // Manual refresh contexts
  const handleRefreshContexts = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    fetchContexts()
  }, [fetchContexts])

  // Reset contexts when disconnecting
  useEffect(() => {
    if (!isConnected) {
      setContexts([])
    }
  }, [isConnected])

  // Switch to a context
  const handleSwitchContext = useCallback(async (index: number) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.switchContext(index)
      if (result.success) {
        setShowContextDropdown(false)
        // Update contexts list to reflect new active context
        setContexts(prev => prev.map(ctx => ({
          ...ctx,
          isActive: ctx.index === index
        })))
      }
    } catch (e) {
      console.error('Failed to switch context:', e)
    }
  }, [])

  const handleExport = useCallback(async () => {
    const script = await exportScript()
    if (script) {
      setExportedScript(script)
    }
  }, [exportScript])

  const handleCloseExport = useCallback(() => {
    setExportedScript(null)
  }, [])

  // Handle confirmation dialog
  const handleConfirmAction = useCallback((confirmed: boolean, comment?: string) => {
    if (window.electronAPI?.agent?.confirmAction) {
      window.electronAPI.agent.confirmAction(confirmed, comment)
    }
    setPendingConfirmation(null)
  }, [])

  const handleCancelConfirmation = useCallback(() => {
    if (window.electronAPI?.agent?.cancelConfirmation) {
      window.electronAPI.agent.cancelConfirmation()
    }
    setPendingConfirmation(null)
  }, [])

  // Listen for confirmation requests
  useEffect(() => {
    if (!window.electronAPI?.agent?.onConfirmationRequested) return

    const unsubscribe = window.electronAPI.agent.onConfirmationRequested((request: unknown) => {
      setPendingConfirmation(request as ConfirmationRequest)
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <span className="title-icon">◈</span>
            Chat Browser Agent
          </h1>
          <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
            <span className="status-dot"></span>
            {isConnected ? 'Connected' : 'Disconnected'}
          </div>
          {isConnected && (
            <div className="context-dropdown-container" ref={dropdownRef}>
              <div 
                className={`context-selector ${showContextDropdown ? 'active' : ''}`} 
                onClick={handleContextDropdownToggle}
                title="点击查看所有 Context"
              >
                <span className="context-label">
                  Context #{contexts.find(c => c.isActive)?.index ?? 0} 
                  ({contexts.find(c => c.isActive)?.pageCount ?? 0} pages)
                </span>
                <span className="dropdown-arrow">{showContextDropdown ? '▲' : '▼'}</span>
              </div>
              
              {showContextDropdown && (
                <div className="context-dropdown">
                  <div className="context-dropdown-header">
                    <span>Browser Contexts</span>
                    <div className="context-header-right">
                      <span className="context-count">{contexts.length}</span>
                      <button 
                        className="context-refresh-btn" 
                        onClick={handleRefreshContexts}
                        disabled={loadingContexts}
                        title="刷新 Context 列表"
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                  <div className="context-dropdown-list">
                    {loadingContexts ? (
                      <div className="context-loading">Loading...</div>
                    ) : contexts.length === 0 ? (
                      <div className="context-empty">No contexts found</div>
                    ) : (
                      contexts.map(ctx => (
                        <div 
                          key={ctx.index}
                          className={`context-dropdown-item ${ctx.isActive ? 'active' : ''}`}
                          onClick={() => handleSwitchContext(ctx.index)}
                        >
                          <span className="context-indicator">{ctx.isActive ? '●' : '○'}</span>
                          <div className="context-info">
                            <span className="context-name">Context #{ctx.index}</span>
                            <span className="context-pages">{ctx.pageCount} pages</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="header-actions">
          <button 
            className="header-btn toggle-btn"
            onClick={() => setShowAgentPanel(!showAgentPanel)}
          >
            {showAgentPanel ? '◧ Hide Agent' : '◨ Agent Panel'}
          </button>
          <button 
            className="header-btn toggle-btn"
            onClick={() => setShowPreview(!showPreview)}
          >
            {showPreview ? '◧ Hide Preview' : '◨ Show Preview'}
          </button>
          <button 
            className="header-btn export-btn"
            onClick={handleExport}
            disabled={operations.length === 0}
          >
            ⬡ Export Script
          </button>
          {isConnected ? (
            <button className="header-btn disconnect-btn" onClick={disconnectBrowser}>
              ⊗ Disconnect
            </button>
          ) : (
            <button className="header-btn connect-btn" onClick={() => connectBrowser()}>
              ⊕ Connect Browser
            </button>
          )}
          <div className="header-divider"></div>
          <button 
            className="header-btn icon-btn settings-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            ⚙
          </button>
        </div>
      </header>

      <main className="app-main">
        <ChatPanel
          messages={messages}
          onSendMessage={sendMessage}
          isProcessing={isProcessing}
          isConnected={isConnected}
          checkpoints={checkpoints}
          isRunning={isAgentRunning}
          onStop={stopTask}
        />
        
        {showPreview && (
          <OperationPreview 
            operations={operations}
            onClear={clearRecording}
          />
        )}
        
        {showAgentPanel && (
          <SessionPanel
            sessions={sessions}
            currentSessionId={currentSessionId}
            currentPlan={currentPlan}
            beadsPlan={beadsPlan}
            progress={progress}
            status={agentStatus}
            isRunning={isAgentRunning}
            traceId={traceId}
            onCreateSession={createSession}
            onLoadSession={loadSession}
            onDeleteSession={deleteSession}
            onStopTask={stopTask}
          />
        )}
      </main>

      {/* Settings Panel */}
      {showSettings && (
        <div className="settings-overlay">
          <SettingsPanel onClose={() => setShowSettings(false)} />
        </div>
      )}

      {exportedScript && (
        <div className="modal-overlay" onClick={handleCloseExport}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Generated Playwright Script</h2>
              <button className="modal-close" onClick={handleCloseExport}>×</button>
            </div>
            <pre className="script-preview">
              <code>{exportedScript}</code>
            </pre>
            <div className="modal-actions">
              <button 
                className="modal-btn copy-btn"
                onClick={() => navigator.clipboard.writeText(exportedScript)}
              >
                Copy to Clipboard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog (HI-20 ~ HI-23) */}
      <ConfirmationDialog
        request={pendingConfirmation}
        onConfirm={handleConfirmAction}
        onCancel={handleCancelConfirmation}
      />

      {/* Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}

export default App
