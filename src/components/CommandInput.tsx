import { useState, useCallback, useRef, KeyboardEvent } from 'react';

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
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Support both controlled and uncontrolled modes
  const input = value !== undefined ? value : internalInput;
  const setInput = onValueChange || setInternalInput;

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || disabled) return;

    onSend(trimmed);
    setInput('');
  }, [input, disabled, onSend, setInput]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    // 检查是否正在使用输入法（IME）进行输入
    // 如果是，则不发送消息，让输入法完成拼音到汉字的转换
    if (e.nativeEvent.isComposing || e.key === 'Process') {
      return;
    }
    
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
        <input
          ref={inputRef}
          type="text"
          className="command-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isConnected 
            ? "描述您想要执行的操作..." 
            : "请先连接浏览器..."
          }
          disabled={disabled}
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
