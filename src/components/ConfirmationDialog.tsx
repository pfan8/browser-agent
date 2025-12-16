/**
 * Confirmation Dialog Component
 * 
 * Implements Human-in-the-Loop confirmation UI:
 * - HI-20: Confirmation dialog with operation description and risk warning
 * - HI-21: Operation preview with element highlight
 * - HI-22: "Waiting for confirmation" status indicator
 * - HI-23: Risk level color distinction
 */

import React, { useEffect, useState } from 'react';
import type { ConfirmationRequest, RiskLevel } from '../../electron/agent/safety/types';

interface ConfirmationDialogProps {
  request: ConfirmationRequest | null;
  onConfirm: (confirmed: boolean, comment?: string) => void;
  onCancel: () => void;
}

// Risk level colors (HI-23)
const RISK_COLORS: Record<RiskLevel, { bg: string; border: string; text: string; badge: string }> = {
  safe: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    badge: 'bg-green-100 text-green-800',
  },
  low: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    text: 'text-blue-800',
    badge: 'bg-blue-100 text-blue-800',
  },
  medium: {
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-800',
    badge: 'bg-yellow-100 text-yellow-800',
  },
  high: {
    bg: 'bg-orange-50',
    border: 'border-orange-200',
    text: 'text-orange-800',
    badge: 'bg-orange-100 text-orange-800',
  },
  critical: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-800',
    badge: 'bg-red-100 text-red-800',
  },
};

// Risk level icons
const RISK_ICONS: Record<RiskLevel, string> = {
  safe: '✓',
  low: 'ℹ',
  medium: '⚠',
  high: '⚠',
  critical: '🛑',
};

// Risk level labels
const RISK_LABELS: Record<RiskLevel, string> = {
  safe: '安全',
  low: '低风险',
  medium: '中等风险',
  high: '高风险',
  critical: '危险操作',
};

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  request,
  onConfirm,
  onCancel,
}) => {
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [comment, setComment] = useState('');

  // Timer countdown
  useEffect(() => {
    if (!request) return;

    const timeout = request.timeout;
    const startTime = new Date(request.timestamp).getTime();
    
    const updateTimer = () => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, timeout - elapsed);
      setTimeRemaining(remaining);
      
      if (remaining <= 0) {
        // Timeout - auto reject
        onConfirm(false, 'Timeout');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    return () => clearInterval(interval);
  }, [request, onConfirm]);

  if (!request) return null;

  const colors = RISK_COLORS[request.risk.level];
  const icon = RISK_ICONS[request.risk.level];
  const label = RISK_LABELS[request.risk.level];
  const timeRemainingSeconds = Math.ceil(timeRemaining / 1000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />
      
      {/* Dialog */}
      <div className={`relative w-full max-w-lg mx-4 rounded-xl shadow-2xl ${colors.bg} ${colors.border} border-2`}>
        {/* Header (HI-22: Status indicator) */}
        <div className={`flex items-center justify-between px-6 py-4 border-b ${colors.border}`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{icon}</span>
            <div>
              <h2 className={`text-lg font-bold ${colors.text}`}>需要确认</h2>
              <p className="text-sm text-gray-500">检测到潜在风险操作</p>
            </div>
          </div>
          
          {/* Risk badge (HI-23) */}
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors.badge}`}>
            {label}
          </span>
        </div>

        {/* Content */}
        <div className="px-6 py-4 space-y-4">
          {/* Operation Description (HI-20) */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">操作详情</h3>
            <div className="bg-white/70 rounded-lg p-3 font-mono text-sm">
              <div className="text-gray-900">{request.action.tool}</div>
              <div className="text-gray-600 text-xs mt-1">
                {JSON.stringify(request.action.args, null, 2)}
              </div>
            </div>
          </div>

          {/* Agent's Reasoning */}
          {request.action.reasoning && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Agent 分析</h3>
              <p className="text-sm text-gray-600 bg-white/50 rounded-lg p-3">
                {request.action.reasoning}
              </p>
            </div>
          )}

          {/* Risk Warning (HI-20) */}
          {request.risk.reasons.length > 0 && (
            <div className={`${colors.bg} rounded-lg p-3 border ${colors.border}`}>
              <h3 className={`text-sm font-medium ${colors.text} mb-2`}>⚠️ 风险提示</h3>
              <ul className="text-sm text-gray-700 space-y-1">
                {request.risk.reasons.map((reason: string, i: number) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-gray-400">•</span>
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Target Element Preview (HI-21) */}
          {request.action.targetElement && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">目标元素</h3>
              <div className="bg-white/70 rounded-lg p-3 text-sm">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 bg-gray-200 rounded text-xs font-mono">
                    {request.action.targetElement.tag}
                  </span>
                  {request.action.targetElement.text && (
                    <span className="text-gray-600">
                      "{request.action.targetElement.text.slice(0, 50)}"
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1 font-mono">
                  {request.action.targetElement.selector}
                </div>
              </div>
            </div>
          )}

          {/* Comment Input */}
          <div>
            <label className="text-sm font-medium text-gray-700 mb-2 block">
              备注 (可选)
            </label>
            <input
              type="text"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="添加备注..."
              className="w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Footer */}
        <div className={`flex items-center justify-between px-6 py-4 border-t ${colors.border} bg-white/30`}>
          {/* Timeout indicator (HI-22) */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>等待确认... {timeRemainingSeconds}s</span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => onConfirm(false, comment)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              拒绝
            </button>
            <button
              onClick={() => onConfirm(true, comment)}
              className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                request.risk.level === 'critical' 
                  ? 'bg-red-600 hover:bg-red-700'
                  : request.risk.level === 'high'
                    ? 'bg-orange-600 hover:bg-orange-700'
                    : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              确认执行
            </button>
          </div>
        </div>

        {/* Risk Score Bar */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>风险评分</span>
            <span>{request.risk.score}/100</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all duration-500 ${
                request.risk.level === 'critical' ? 'bg-red-500' :
                request.risk.level === 'high' ? 'bg-orange-500' :
                request.risk.level === 'medium' ? 'bg-yellow-500' :
                request.risk.level === 'low' ? 'bg-blue-500' : 'bg-green-500'
              }`}
              style={{ width: `${request.risk.score}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;

