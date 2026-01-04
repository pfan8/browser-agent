import { useState, useCallback, useRef, KeyboardEvent, useEffect } from 'react';

interface CommandInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  isConnected: boolean;
  isRunning?: boolean;
  onStop?: () => void;
  value?: string;
  onValueChange?: (value: string) => void;
}

export default function CommandInput({ 
  onSend, 
  disabled, 
  isConnected,
  isRunning = false,
  onStop,
  value,
  onValueChange,
}: CommandInputProps) {
  const [internalInput, setInternalInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Support both controlled and uncontrolled modes
  const input = value !== undefined ? value : internalInput;
  const setInput = onValueChange || setInternalInput;

  // 自动调整 textarea 高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      const scrollHeight = textarea.scrollHeight;
      // 限制最大高度为 150px（约 6 行）
      textarea.style.height = `${Math.min(scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setInput('');
    // 重置 textarea 高度
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, disabled, onSend, setInput]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 检查是否正在使用输入法（IME）进行输入
    // 如果是，则不发送消息，让输入法完成拼音到汉字的转换
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return;
    }
    
    // Shift+Enter 换行，Enter 提交
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  const handleStop = useCallback(() => {
    if (onStop) {
      onStop();
    }
  }, [onStop]);

  return (
    <div className="command-input-container">
      <div className="command-input-wrapper">
        <textarea
          ref={textareaRef}
          className="command-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected 
            ? "描述您想要执行的操作... (Shift+Enter 换行)" 
            : "请先连接浏览器..."
          }
          disabled={disabled}
          rows={1}
        />
        
        {isRunning ? (
          <button 
            className="stop-btn" 
            onClick={handleStop}
            title="停止当前任务"
          >
            ⏹ 停止
          </button>
        ) : (
          <button 
            className="send-btn" 
            onClick={handleSubmit}
            disabled={disabled || !input.trim()}
          >
            ▶ 发送
          </button>
        )}
      </div>
    </div>
  );
}
