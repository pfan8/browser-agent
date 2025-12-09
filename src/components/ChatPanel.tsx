import { useRef, useEffect } from 'react';
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

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="chat-panel">
      <MessageList 
        messages={messages} 
        isProcessing={isProcessing}
        checkpoints={checkpoints}
        onRestoreCheckpoint={onRestoreCheckpoint}
      />
      <div ref={messagesEndRef} />
      <CommandInput 
        onSend={onSendMessage} 
        disabled={isProcessing}
        isConnected={isConnected}
        isRunning={isRunning || isProcessing}
        onStop={onStop}
      />
    </div>
  );
}

