import { useState, useCallback, useEffect, useRef } from 'react'
import ChatPanel from './components/ChatPanel'
import OperationPreview from './components/OperationPreview'
import SettingsPanel from './components/SettingsPanel'
import { SessionPanel } from './components/SessionPanel'
import { useReActAgent } from './hooks/useReActAgent'

interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

function App() {
  // ReAct Agent hook - all input goes to agent
  const { 
    messages, 
    operations, 
    isConnected, 
    isProcessing,
    currentPageInfo,
    isLoadingPageInfo,
    sendMessage, 
    connectBrowser, 
    disconnectBrowser,
    clearRecording,
    exportScript,
    refreshPageInfo,
    // Agent features
    sessions,
    currentSessionId,
    checkpoints,
    currentPlan,
    progress,
    status: agentStatus,
    isRunning: isAgentRunning,
    stopTask,
    createSession,
    loadSession,
    deleteSession,
    restoreCheckpoint,
  } = useReActAgent()
  
  const [showPreview, setShowPreview] = useState(false)
  const [showAgentPanel, setShowAgentPanel] = useState(true)
  const [exportedScript, setExportedScript] = useState<string | null>(null)
  const [showTabsDropdown, setShowTabsDropdown] = useState(false)
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [loadingTabs, setLoadingTabs] = useState(false)
  const [tabsFetched, setTabsFetched] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowTabsDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Fetch tabs (used for initial load and manual refresh)
  const fetchTabs = useCallback(async () => {
    if (!isConnected || !window.electronAPI) return
    
    setLoadingTabs(true)
    try {
      const pages = await window.electronAPI.listPages()
      setTabs(pages)
      setTabsFetched(true)
    } catch (e) {
      console.error('Failed to fetch tabs:', e)
    } finally {
      setLoadingTabs(false)
    }
  }, [isConnected])

  // Toggle dropdown - only fetch if not already fetched
  const handleTabsDropdownToggle = useCallback(() => {
    const willOpen = !showTabsDropdown
    setShowTabsDropdown(willOpen)
    
    // If opening the dropdown and tabs haven't been fetched yet, fetch them
    if (willOpen && !tabsFetched && isConnected) {
      fetchTabs()
    }
  }, [showTabsDropdown, tabsFetched, isConnected, fetchTabs])

  // Manual refresh tabs
  const handleRefreshTabs = useCallback((e: React.MouseEvent) => {
    e.stopPropagation() // Prevent dropdown from closing
    fetchTabs()
  }, [fetchTabs])

  // Reset tabs cache when disconnecting
  useEffect(() => {
    if (!isConnected) {
      setTabs([])
      setTabsFetched(false)
    }
  }, [isConnected])

  // Switch to a tab
  const handleSwitchTab = useCallback(async (index: number) => {
    if (!window.electronAPI) return
    try {
      const result = await window.electronAPI.switchToPage(index)
      if (result.success) {
        setShowTabsDropdown(false)
        refreshPageInfo()
        // Update tabs list to reflect new active tab
        setTabs(prev => prev.map(tab => ({
          ...tab,
          active: tab.index === index
        })))
      }
    } catch (e) {
      console.error('Failed to switch tab:', e)
    }
  }, [refreshPageInfo])

  const handleExport = useCallback(async () => {
    const script = await exportScript()
    if (script) {
      setExportedScript(script)
    }
  }, [exportScript])

  const handleCloseExport = useCallback(() => {
    setExportedScript(null)
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
            <div className="tabs-dropdown-container" ref={dropdownRef}>
              {isLoadingPageInfo ? (
                <div className="current-page-info loading">
                  <span className="page-title">Loading page info...</span>
                  <span className="page-url">
                    <span className="loading-spinner"></span>
                  </span>
                </div>
              ) : currentPageInfo ? (
                <div 
                  className={`current-page-info ${showTabsDropdown ? 'active' : ''}`} 
                  onClick={handleTabsDropdownToggle}
                  title="点击查看所有标签页"
                >
                  <span className="page-title">{currentPageInfo.title || 'Untitled'}</span>
                  <span className="page-url">
                    {currentPageInfo.url}
                    <span className="dropdown-arrow">{showTabsDropdown ? '▲' : '▼'}</span>
                  </span>
                </div>
              ) : (
                <div className="current-page-info error">
                  <span className="page-title">No page info</span>
                  <span className="page-url" onClick={() => refreshPageInfo(true)}>Click to retry</span>
                </div>
              )}
              
              {showTabsDropdown && !isLoadingPageInfo && currentPageInfo && (
                <div className="tabs-dropdown">
                  <div className="tabs-dropdown-header">
                    <span>Open Tabs</span>
                    <div className="tabs-header-right">
                      <span className="tabs-count">{tabs.length}</span>
                      <button 
                        className="tabs-refresh-btn" 
                        onClick={handleRefreshTabs}
                        disabled={loadingTabs}
                        title="刷新标签页列表"
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                  <div className="tabs-dropdown-list">
                    {loadingTabs ? (
                      <div className="tabs-loading">Loading...</div>
                    ) : tabs.length === 0 ? (
                      <div className="tabs-empty">No tabs found</div>
                    ) : (
                      tabs.map(tab => (
                        <div 
                          key={tab.index}
                          className={`tabs-dropdown-item ${tab.active ? 'active' : ''}`}
                          onClick={() => handleSwitchTab(tab.index)}
                        >
                          <span className="tab-indicator">{tab.active ? '●' : '○'}</span>
                          <div className="tab-info">
                            <span className="tab-title">{tab.title || 'Untitled'}</span>
                            <span className="tab-url">{tab.url}</span>
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
          onRestoreCheckpoint={restoreCheckpoint}
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
            progress={progress}
            status={agentStatus}
            isRunning={isAgentRunning}
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
    </div>
  )
}

export default App
