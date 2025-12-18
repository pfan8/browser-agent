import { useRef, useEffect, useState, useCallback } from 'react';
import MessageList from './MessageList';
import CommandInput from './CommandInput';
import type { ChatMessage } from '@dsl/types';

interface CheckpointInfo {
  id: string;
  name: string;
  description?: string;
  stepIndex: number;
  createdAt: string;
  isAutoSave: boolean;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isProcessing: boolean;
  isConnected: boolean;
  checkpoints?: CheckpointInfo[];
  onRestoreCheckpoint?: (checkpointId: string) => void;
  isRunning?: boolean;
  onStop?: () => void;
}

export default function ChatPanel({ 
  messages, 
  onSendMessage, 
  isProcessing, 
  isConnected,
  checkpoints,
  onRestoreCheckpoint,
  isRunning,
  onStop,
}: ChatPanelProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [inputValue, setInputValue] = useState('');

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle example click - set input value
  const handleExampleClick = useCallback((text: string) => {
    setInputValue(text);
  }, []);

  // Handle send message and clear input
  const handleSendMessage = useCallback((message: string) => {
    onSendMessage(message);
    setInputValue('');
  }, [onSendMessage]);

  return (
    <div className="chat-panel">
      <MessageList 
        messages={messages} 
        isProcessing={isProcessing}
        checkpoints={checkpoints}
        onRestoreCheckpoint={onRestoreCheckpoint}
        onExampleClick={handleExampleClick}
      />
      <div ref={messagesEndRef} />
      <CommandInput 
        onSend={handleSendMessage} 
        disabled={isProcessing}
        isConnected={isConnected}
        isRunning={isRunning || isProcessing}
        onStop={onStop}
        value={inputValue}
        onValueChange={setInputValue}
      />
    </div>
  );
}

