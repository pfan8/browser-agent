/**
 * Toast Component
 * 
 * Lightweight toast notifications for session operations and other non-critical messages.
 */

import { useEffect, useState, useCallback } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }) {
  const [isExiting, setIsExiting] = useState(false);
  
  useEffect(() => {
    const duration = toast.duration || 3000;
    const exitTimer = setTimeout(() => {
      setIsExiting(true);
    }, duration - 300); // Start exit animation 300ms before removal
    
    const removeTimer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    
    return () => {
      clearTimeout(exitTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, toast.duration, onDismiss]);
  
  const getIcon = () => {
    switch (toast.type) {
      case 'success': return '✓';
      case 'error': return '✗';
      case 'info': return 'ℹ';
    }
  };
  
  return (
    <div className={`toast-item ${toast.type} ${isExiting ? 'exiting' : ''}`}>
      <span className="toast-icon">{getIcon()}</span>
      <span className="toast-message">{toast.message}</span>
      <button className="toast-close" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  );
}

export function ToastContainer({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null;
  
  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
      
      <style>{`
        .toast-container {
          position: fixed;
          top: 60px;
          right: 20px;
          z-index: 10000;
          display: flex;
          flex-direction: column;
          gap: 8px;
          pointer-events: none;
        }
        
        .toast-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          background: var(--bg-secondary, #1a1a2e);
          border: 1px solid var(--border-color, #2a2a4a);
          border-radius: 8px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
          color: var(--text-primary, #e0e0f0);
          font-size: 13px;
          pointer-events: auto;
          animation: toast-slide-in 0.3s ease-out;
          max-width: 320px;
        }
        
        .toast-item.exiting {
          animation: toast-slide-out 0.3s ease-in forwards;
        }
        
        @keyframes toast-slide-in {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
        
        @keyframes toast-slide-out {
          from {
            transform: translateX(0);
            opacity: 1;
          }
          to {
            transform: translateX(100%);
            opacity: 0;
          }
        }
        
        .toast-item.success {
          border-left: 3px solid #22c55e;
        }
        
        .toast-item.error {
          border-left: 3px solid #ef4444;
        }
        
        .toast-item.info {
          border-left: 3px solid #3b82f6;
        }
        
        .toast-icon {
          font-size: 14px;
          flex-shrink: 0;
        }
        
        .toast-item.success .toast-icon {
          color: #22c55e;
        }
        
        .toast-item.error .toast-icon {
          color: #ef4444;
        }
        
        .toast-item.info .toast-icon {
          color: #3b82f6;
        }
        
        .toast-message {
          flex: 1;
          line-height: 1.4;
        }
        
        .toast-close {
          background: none;
          border: none;
          color: var(--text-secondary, #a0a0c0);
          cursor: pointer;
          font-size: 16px;
          padding: 0 4px;
          opacity: 0.6;
          transition: opacity 0.2s;
        }
        
        .toast-close:hover {
          opacity: 1;
        }
      `}</style>
    </div>
  );
}




