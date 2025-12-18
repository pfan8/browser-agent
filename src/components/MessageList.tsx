import { useState, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage, ExecutionStep } from '@dsl/types';

interface CheckpointInfo {
  id: string;
  name: string;
  description?: string;
  stepIndex: number;
  createdAt: string;
  isAutoSave: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
  isProcessing: boolean;
  checkpoints?: CheckpointInfo[];
  onRestoreCheckpoint?: (checkpointId: string) => void;
  onExampleClick?: (text: string) => void;
}

// Collapsible thinking component
function ThinkingSection({ thinking }: { thinking: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <div className="thinking-section">
      <button 
        className="thinking-toggle"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`thinking-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        <span className="thinking-label">思考过程</span>
      </button>
      {isExpanded && (
        <div className="thinking-content">
          <Markdown>{thinking}</Markdown>
        </div>
      )}
    </div>
  );
}

// Get icon for step type
function getStepIcon(type: ExecutionStep['type'], status: ExecutionStep['status']) {
  if (status === 'running') return '⟳';
  if (status === 'error') return '✗';
  if (status === 'success') {
    switch (type) {
      case 'planner': return '🧠';
      case 'codeact': return '⚡';
      case 'observe': return '👁';
      default: return '•';
    }
  }
  return '○';
}

// Get step type label
function getStepTypeLabel(type: ExecutionStep['type']): string {
  switch (type) {
    case 'planner': return 'THINK';
    case 'codeact': return 'ACT';
    case 'observe': return 'OBSERVE';
  }
}

// Get status class for step
function getStepStatusClass(status: ExecutionStep['status']) {
  switch (status) {
    case 'running': return 'step-running';
    case 'success': return 'step-success';
    case 'error': return 'step-error';
    default: return 'step-pending';
  }
}

// Format duration
function formatDuration(ms?: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// Collapsible code block component
function CodeBlock({ code }: { code: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const lines = code.split('\n');
  const previewLines = lines.slice(0, 3).join('\n');
  const hasMore = lines.length > 3;
  
  return (
    <div className="step-code-block">
      <div className="code-header">
        <span className="code-label">📝 Code</span>
        {hasMore && (
          <button 
            className="code-expand-btn"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? '收起' : `展开 (${lines.length}行)`}
          </button>
        )}
      </div>
      <pre className="code-content">
        <code>{isExpanded ? code : (hasMore ? previewLines + '\n...' : code)}</code>
      </pre>
    </div>
  );
}

// Enhanced execution step component
function ExecutionStepItem({ step, index }: { step: ExecutionStep; index: number }) {
  const [isExpanded, setIsExpanded] = useState(step.status === 'running');
  
  // Auto-expand when running
  if (step.status === 'running' && !isExpanded) {
    setIsExpanded(true);
  }
  
  const hasDetails = step.thought || step.instruction || step.code || step.observation;
  
  return (
    <div 
      className={`execution-step ${getStepStatusClass(step.status)} ${step.type}`}
    >
      <div 
        className="step-header"
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        style={{ cursor: hasDetails ? 'pointer' : 'default' }}
      >
        <span className="step-number">{index + 1}</span>
        <span className={`step-icon ${step.status === 'running' ? 'spinning' : ''}`}>
          {getStepIcon(step.type, step.status)}
        </span>
        <span className="step-type">{getStepTypeLabel(step.type)}</span>
        {step.tool && <span className="step-tool">{step.tool}</span>}
        <span className="step-content-preview">{step.content}</span>
        {step.duration && (
          <span className="step-duration">{formatDuration(step.duration)}</span>
        )}
        {hasDetails && (
          <span className={`step-expand-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        )}
      </div>
      
      {isExpanded && hasDetails && (
        <div className="step-details">
          {/* Show thinking/reasoning for planner steps */}
          {step.thought && (
            <div className="step-thought">
              <span className="detail-label">💭 思考:</span>
              <span className="detail-content streaming-text">{step.thought}</span>
            </div>
          )}
          
          {/* Show instruction */}
          {step.instruction && (
            <div className="step-instruction">
              <span className="detail-label">📋 指令:</span>
              <span className="detail-content">{step.instruction}</span>
            </div>
          )}
          
          {/* Show generated code for codeact steps */}
          {step.code && (
            <CodeBlock code={step.code} />
          )}
          
          {/* Show observation for observe steps */}
          {step.observation && (
            <div className="step-observation">
              <span className="detail-label">🔍 页面:</span>
              <span className="detail-content">
                {step.observation.title && <span className="obs-title">{step.observation.title}</span>}
                {step.observation.url && <span className="obs-url">{step.observation.url}</span>}
              </span>
            </div>
          )}
        </div>
      )}
      
      {step.error && (
        <div className="step-error-msg">
          ⚠️ {step.error}
        </div>
      )}
    </div>
  );
}

// Collapsible execution steps component
function ExecutionStepsSection({ steps }: { steps: ExecutionStep[] }) {
  const [isExpanded, setIsExpanded] = useState(true); // Default expanded
  
  if (!steps || steps.length === 0) return null;
  
  const completedCount = steps.filter(s => s.status === 'success').length;
  const hasRunning = steps.some(s => s.status === 'running');
  const hasError = steps.some(s => s.status === 'error');
  
  return (
    <div className="execution-steps-section">
      <button 
        className={`execution-steps-toggle ${hasRunning ? 'running' : ''} ${hasError ? 'has-error' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <span className={`execution-steps-arrow ${isExpanded ? 'expanded' : ''}`}>▶</span>
        <span className={`execution-steps-icon ${hasRunning ? 'spinning' : ''}`}>
          {hasRunning ? '⟳' : hasError ? '⚠' : '✓'}
        </span>
        <span className="execution-steps-label">
          {hasRunning ? '执行中...' : '执行步骤'}
        </span>
        <span className="execution-steps-count">
          {completedCount}/{steps.length}
        </span>
      </button>
      {isExpanded && (
        <div className="execution-steps-content">
          {steps.map((step, index) => (
            <ExecutionStepItem key={step.id} step={step} index={index} />
          ))}
        </div>
      )}
    </div>
  );
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit' 
  });
}

function extractMessage(content: string): string {
  let text = content;
  
  // Remove markdown code block wrapper if present (```json ... ```)
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }
  
  // Try to parse as JSON and extract message field
  if (text.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed.message) {
        return parsed.message;
      }
    } catch {
      // Not valid JSON, continue
    }
  }
  
  return content;
}

export default function MessageList({ messages, isProcessing, checkpoints = [], onRestoreCheckpoint, onExampleClick }: MessageListProps) {
  // Build a map of message index -> associated checkpoint
  // For each user message, find the first checkpoint created after it
  const messageCheckpointMap = useMemo(() => {
    const map = new Map<number, CheckpointInfo>();
    
    if (!checkpoints || checkpoints.length === 0) return map;
    
    // Sort checkpoints by creation time
    const sortedCheckpoints = [...checkpoints].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    // For each user message, find the next checkpoint after it
    messages.forEach((message, index) => {
      if (message.role !== 'user') return;
      
      const messageTime = new Date(message.timestamp).getTime();
      
      // Find the first checkpoint created after this message
      const checkpoint = sortedCheckpoints.find(cp => 
        new Date(cp.createdAt).getTime() > messageTime
      );
      
      if (checkpoint) {
        map.set(index, checkpoint);
      }
    });
    
    return map;
  }, [messages, checkpoints]);

  if (messages.length === 0) {
    return (
      <div className="message-list">
        <div className="welcome-message">
          <h2>欢迎使用 Chat Browser Agent</h2>
          <p>用自然语言描述您想要执行的操作，AI 会帮您完成。</p>
          <div className="command-examples">
            {[
              { command: '当前浏览器打开了哪些tab', desc: '获取页面列表' },
              { command: '点击登录按钮', desc: '点击页面元素' },
              { command: '在搜索框中输入关键词', desc: '输入文本内容' },
              { command: '截图保存当前页面', desc: '截取屏幕截图' },
              { command: '填写表单并提交', desc: '执行多步骤任务' },
              { command: '帮我登录这个网站', desc: '复杂自动化任务' },
            ].map((example) => (
              <div 
                key={example.command}
                className={`command-example ${onExampleClick ? 'clickable' : ''}`}
                onClick={() => onExampleClick?.(example.command)}
                role={onExampleClick ? 'button' : undefined}
                tabIndex={onExampleClick ? 0 : undefined}
                onKeyDown={(e) => {
                  if (onExampleClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onExampleClick(example.command);
                  }
                }}
              >
                <code>{example.command}</code>
                <span>{example.desc}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="message-list">
      {messages.map((message, index) => {
        const checkpoint = messageCheckpointMap.get(index);
        
        return (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-avatar">
              {message.role === 'user' ? '◇' : message.role === 'system' ? '⚙' : '◈'}
            </div>
            <div className="message-content">
              {message.executionSteps && message.executionSteps.length > 0 && (
                <ExecutionStepsSection steps={message.executionSteps} />
              )}
              {message.thinking && (
                <ThinkingSection thinking={message.thinking} />
              )}
              <div className="message-text">
                <Markdown remarkPlugins={[remarkGfm]}>{extractMessage(message.content)}</Markdown>
              </div>
              <div className="message-footer">
                <span className="message-time">
                  {formatTime(message.timestamp)}
                </span>
                {message.role === 'user' && checkpoint && onRestoreCheckpoint && (
                  <button 
                    className="restore-checkpoint-btn"
                    onClick={() => onRestoreCheckpoint(checkpoint.id)}
                    title={`恢复到此检查点: ${checkpoint.name}`}
                  >
                    ⏪ 恢复
                  </button>
                )}
              </div>
              {message.status && message.status !== 'pending' && (
                <div className={`message-status ${message.status}`}>
                  {message.status === 'success' && '✓ Success'}
                  {message.status === 'error' && `✗ ${message.error || 'Failed'}`}
                  {message.status === 'processing' && (
                    <span className="typing-indicator">
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                      <span className="typing-dot"></span>
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
      
      {isProcessing && (
        <div className="message agent">
          <div className="message-avatar">◈</div>
          <div className="message-content">
            <div className="typing-indicator">
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
              <span className="typing-dot"></span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

