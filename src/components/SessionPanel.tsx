/**
 * Session Panel Component
 * 
 * UI for managing agent sessions and checkpoints.
 * Allows creating, loading, and deleting sessions and checkpoints.
 */

import React, { useState } from 'react';

interface SessionInfo {
  id: string;
  name: string;
  description?: string;
  checkpointCount: number;
  createdAt: string;
  updatedAt: string;
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

interface SessionPanelProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  currentPlan: TaskPlan | null;
  progress: AgentProgress | null;
  status: string;
  isRunning: boolean;
  onCreateSession: (name: string, description?: string) => void;
  onLoadSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onStopTask: () => void;
}

export function SessionPanel({
  sessions,
  currentSessionId,
  currentPlan,
  progress,
  status,
  isRunning,
  onCreateSession,
  onLoadSession,
  onDeleteSession,
  onStopTask,
}: SessionPanelProps) {
  const [activeTab, setActiveTab] = useState<'sessions' | 'plan'>('plan');
  const [newSessionName, setNewSessionName] = useState('');
  const [showNewSession, setShowNewSession] = useState(false);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusIcon = (stepStatus: string) => {
    switch (stepStatus) {
      case 'completed': return '✓';
      case 'in_progress': return '▶';
      case 'failed': return '✗';
      case 'skipped': return '⏭';
      default: return '○';
    }
  };

  const getStatusColor = (stepStatus: string) => {
    switch (stepStatus) {
      case 'completed': return '#22c55e';
      case 'in_progress': return '#3b82f6';
      case 'failed': return '#ef4444';
      case 'skipped': return '#6b7280';
      default: return '#9ca3af';
    }
  };

  return (
    <div className="session-panel">
      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-indicator">
          <span className={`status-dot ${status}`} />
          <span className="status-text">{status}</span>
        </div>
        {isRunning && (
          <button className="stop-btn" onClick={onStopTask}>
            ⏹ Stop
          </button>
        )}
      </div>

      {/* Progress Bar */}
      {progress && currentPlan && (
        <div className="progress-section">
          <div className="progress-header">
            <span className="progress-label">Progress</span>
            <span className="progress-value">{progress.percentage}%</span>
          </div>
          <div className="progress-bar">
            <div 
              className="progress-fill" 
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
          <div className="progress-stats">
            <span className="stat completed">{progress.completed} done</span>
            <span className="stat failed">{progress.failed} failed</span>
            <span className="stat pending">{progress.pending} remaining</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        <button
          className={`tab ${activeTab === 'plan' ? 'active' : ''}`}
          onClick={() => setActiveTab('plan')}
        >
          Plan
        </button>
        <button
          className={`tab ${activeTab === 'sessions' ? 'active' : ''}`}
          onClick={() => setActiveTab('sessions')}
        >
          Sessions ({sessions.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {activeTab === 'plan' && (
          <div className="plan-view">
            {currentPlan ? (
              <>
                <div className="plan-goal">
                  <strong>Goal:</strong> {currentPlan.goal}
                </div>
                <div className="plan-steps">
                  {currentPlan.steps.map((step, index) => (
                    <div 
                      key={step.id} 
                      className={`plan-step ${step.status}`}
                    >
                      <span 
                        className="step-icon" 
                        style={{ color: getStatusColor(step.status) }}
                      >
                        {getStatusIcon(step.status)}
                      </span>
                      <span className="step-index">{index + 1}.</span>
                      <span className="step-description">{step.description}</span>
                      <span className="step-tool">{step.tool}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="empty-state">
                <p>No active plan</p>
                <p className="hint">Send a task to create a plan</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'sessions' && (
          <div className="sessions-view">
            <div className="list-header">
              <button 
                className="new-btn"
                onClick={() => setShowNewSession(!showNewSession)}
              >
                + New Session
              </button>
            </div>
            
            {showNewSession && (
              <div className="new-item-form">
                <input
                  type="text"
                  placeholder="Session name..."
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newSessionName.trim()) {
                      onCreateSession(newSessionName.trim());
                      setNewSessionName('');
                      setShowNewSession(false);
                    }
                  }}
                />
                <button
                  onClick={() => {
                    if (newSessionName.trim()) {
                      onCreateSession(newSessionName.trim());
                      setNewSessionName('');
                      setShowNewSession(false);
                    }
                  }}
                >
                  Create
                </button>
              </div>
            )}

            <div className="list">
              {sessions.map((session) => (
                <div 
                  key={session.id} 
                  className={`list-item ${session.id === currentSessionId ? 'active' : ''}`}
                >
                  <div className="item-main" onClick={() => onLoadSession(session.id)}>
                    <span className="item-name">{session.name}</span>
                    <span className="item-meta">
                      {session.checkpointCount} checkpoints • {formatDate(session.updatedAt)}
                    </span>
                  </div>
                  <button 
                    className="delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              ))}
              {sessions.length === 0 && (
                <div className="empty-state">
                  <p>No sessions yet</p>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      <style>{`
        .session-panel {
          display: flex;
          flex-direction: column;
          height: 100%;
          background: var(--bg-secondary, #1a1a2e);
          border-left: 1px solid var(--border-color, #2a2a4a);
          font-size: 13px;
        }

        .status-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 12px;
          background: var(--bg-tertiary, #0f0f1a);
          border-bottom: 1px solid var(--border-color, #2a2a4a);
        }

        .status-indicator {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #6b7280;
        }

        .status-dot.idle { background: #6b7280; }
        .status-dot.planning { background: #f59e0b; animation: pulse 1s infinite; }
        .status-dot.executing { background: #3b82f6; animation: pulse 1s infinite; }
        .status-dot.complete { background: #22c55e; }
        .status-dot.error { background: #ef4444; }
        .status-dot.paused { background: #f59e0b; }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .status-text {
          color: var(--text-secondary, #a0a0c0);
          text-transform: capitalize;
        }

        .stop-btn {
          padding: 4px 10px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
        }

        .stop-btn:hover {
          background: #dc2626;
        }

        .progress-section {
          padding: 12px;
          border-bottom: 1px solid var(--border-color, #2a2a4a);
        }

        .progress-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 6px;
        }

        .progress-label {
          color: var(--text-secondary, #a0a0c0);
        }

        .progress-value {
          color: var(--text-primary, #e0e0f0);
          font-weight: 600;
        }

        .progress-bar {
          height: 6px;
          background: var(--bg-tertiary, #0f0f1a);
          border-radius: 3px;
          overflow: hidden;
        }

        .progress-fill {
          height: 100%;
          background: linear-gradient(90deg, #3b82f6, #8b5cf6);
          border-radius: 3px;
          transition: width 0.3s ease;
        }

        .progress-stats {
          display: flex;
          gap: 12px;
          margin-top: 8px;
          font-size: 11px;
        }

        .stat { color: var(--text-secondary, #a0a0c0); }
        .stat.completed { color: #22c55e; }
        .stat.failed { color: #ef4444; }

        .tabs {
          display: flex;
          border-bottom: 1px solid var(--border-color, #2a2a4a);
        }

        .tab {
          flex: 1;
          padding: 10px;
          background: none;
          border: none;
          color: var(--text-secondary, #a0a0c0);
          cursor: pointer;
          font-size: 12px;
          transition: all 0.2s;
        }

        .tab:hover {
          background: var(--bg-tertiary, #0f0f1a);
        }

        .tab.active {
          color: var(--text-primary, #e0e0f0);
          border-bottom: 2px solid #8b5cf6;
        }

        .tab-content {
          flex: 1;
          overflow-y: auto;
          padding: 12px;
        }

        .plan-view, .sessions-view, .checkpoints-view {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .plan-goal {
          padding: 10px;
          background: var(--bg-tertiary, #0f0f1a);
          border-radius: 6px;
          color: var(--text-primary, #e0e0f0);
        }

        .plan-steps {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .plan-step {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          background: var(--bg-tertiary, #0f0f1a);
          border-radius: 4px;
          border-left: 3px solid transparent;
        }

        .plan-step.in_progress {
          border-left-color: #3b82f6;
          background: rgba(59, 130, 246, 0.1);
        }

        .plan-step.completed {
          border-left-color: #22c55e;
          opacity: 0.7;
        }

        .plan-step.failed {
          border-left-color: #ef4444;
        }

        .step-icon {
          font-size: 12px;
          width: 16px;
        }

        .step-index {
          color: var(--text-secondary, #a0a0c0);
          font-size: 11px;
        }

        .step-description {
          flex: 1;
          color: var(--text-primary, #e0e0f0);
        }

        .step-tool {
          font-size: 10px;
          padding: 2px 6px;
          background: var(--bg-secondary, #1a1a2e);
          border-radius: 3px;
          color: var(--text-secondary, #a0a0c0);
        }

        .list-header {
          display: flex;
          gap: 8px;
        }

        .new-btn, .restore-btn {
          padding: 6px 12px;
          background: var(--bg-tertiary, #0f0f1a);
          border: 1px solid var(--border-color, #2a2a4a);
          border-radius: 4px;
          color: var(--text-primary, #e0e0f0);
          cursor: pointer;
          font-size: 12px;
        }

        .new-btn:hover, .restore-btn:hover {
          background: var(--bg-secondary, #1a1a2e);
          border-color: #8b5cf6;
        }

        .new-item-form {
          display: flex;
          gap: 8px;
        }

        .new-item-form input {
          flex: 1;
          padding: 8px;
          background: var(--bg-tertiary, #0f0f1a);
          border: 1px solid var(--border-color, #2a2a4a);
          border-radius: 4px;
          color: var(--text-primary, #e0e0f0);
          font-size: 12px;
        }

        .new-item-form input:focus {
          outline: none;
          border-color: #8b5cf6;
        }

        .new-item-form button {
          padding: 8px 16px;
          background: #8b5cf6;
          border: none;
          border-radius: 4px;
          color: white;
          cursor: pointer;
          font-size: 12px;
        }

        .list {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .list-item {
          display: flex;
          align-items: center;
          padding: 10px;
          background: var(--bg-tertiary, #0f0f1a);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .list-item:hover {
          background: rgba(139, 92, 246, 0.1);
        }

        .list-item.active {
          border: 1px solid #8b5cf6;
        }

        .item-main {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .item-name {
          color: var(--text-primary, #e0e0f0);
        }

        .item-meta {
          font-size: 11px;
          color: var(--text-secondary, #a0a0c0);
        }

        .delete-btn {
          padding: 4px 8px;
          background: none;
          border: none;
          color: var(--text-secondary, #a0a0c0);
          cursor: pointer;
          opacity: 0;
          transition: opacity 0.2s;
        }

        .list-item:hover .delete-btn {
          opacity: 1;
        }

        .delete-btn:hover {
          color: #ef4444;
        }

        .empty-state {
          text-align: center;
          padding: 24px;
          color: var(--text-secondary, #a0a0c0);
        }

        .empty-state .hint {
          font-size: 11px;
          margin-top: 8px;
          opacity: 0.7;
        }
      `}</style>
    </div>
  );
}

