/**
 * Safety Types
 * 
 * Type definitions for the Human-in-the-Loop safety mechanism:
 * - HI-01 ~ HI-09: Danger detection
 * - HI-10 ~ HI-14: Confirmation flow
 */

// ============================================
// Risk Level Types
// ============================================

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface RiskAssessment {
  level: RiskLevel;
  score: number;  // 0-100
  category: DangerCategory;
  reasons: string[];
  recommendation: 'proceed' | 'confirm' | 'block';
}

// ============================================
// Danger Categories (HI-01 ~ HI-04)
// ============================================

export type DangerCategory = 
  | 'delete'          // HI-01: 删除操作
  | 'payment'         // HI-02: 支付操作
  | 'submit'          // HI-03: 提交操作
  | 'account'         // HI-04: 账号操作
  | 'privacy'         // 隐私相关
  | 'irreversible'    // 不可逆操作
  | 'external'        // 外部链接/跳转
  | 'unknown'         // 未知风险
  | 'none';           // 无风险

// ============================================
// Detection Result Types
// ============================================

export interface DangerDetectionResult {
  isDangerous: boolean;
  risk: RiskAssessment;
  matchedPatterns: MatchedPattern[];
  contextAnalysis?: ContextAnalysis;
  llmAnalysis?: LLMAnalysis;
}

export interface MatchedPattern {
  type: 'keyword' | 'button_text' | 'selector' | 'url' | 'context';
  pattern: string;
  matched: string;
  confidence: number;
}

// ============================================
// Context Analysis (HI-06)
// ============================================

export interface ContextAnalysis {
  pageType: PageType;
  formType?: FormType;
  hasPaymentIndicators: boolean;
  hasDeleteIndicators: boolean;
  hasAccountIndicators: boolean;
  relatedElements: RelatedElement[];
}

export type PageType = 
  | 'checkout'
  | 'settings'
  | 'profile'
  | 'admin'
  | 'login'
  | 'signup'
  | 'dashboard'
  | 'form'
  | 'unknown';

export type FormType =
  | 'payment'
  | 'contact'
  | 'registration'
  | 'login'
  | 'settings'
  | 'feedback'
  | 'unknown';

export interface RelatedElement {
  selector: string;
  text: string;
  role?: string;
  isWarning: boolean;
}

// ============================================
// LLM Analysis (HI-07, HI-09)
// ============================================

export interface LLMAnalysis {
  riskAssessment: string;
  potentialConsequences: string[];
  confidence: number;
  suggestedAction: 'proceed' | 'confirm' | 'abort';
  reasoning: string;
}

// ============================================
// Confirmation Request (HI-10 ~ HI-14)
// ============================================

export interface ConfirmationRequest {
  id: string;
  timestamp: string;
  action: PendingAction;
  risk: RiskAssessment;
  preview: ActionPreview;
  timeout: number;  // ms
  status: ConfirmationStatus;
}

export type ConfirmationStatus = 
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'timeout'
  | 'cancelled';

export interface ConfirmationResponse {
  requestId: string;
  status: 'confirmed' | 'rejected';
  timestamp: string;
  userComment?: string;
}

// ============================================
// Pending Action
// ============================================

export interface PendingAction {
  tool: string;
  args: Record<string, unknown>;
  thought: string;
  reasoning: string;
  targetElement?: TargetElement;
}

export interface TargetElement {
  selector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// ============================================
// Action Preview (HI-21)
// ============================================

export interface ActionPreview {
  description: string;
  expectedOutcome: string;
  potentialRisks: string[];
  elementHighlight?: ElementHighlight;
}

export interface ElementHighlight {
  selector: string;
  color: string;  // 'yellow' | 'red' | 'orange'
  label?: string;
}

// ============================================
// Configuration
// ============================================

export interface SafetyConfig {
  enabled: boolean;
  riskThreshold: RiskLevel;  // Actions above this level require confirmation
  useLLMAnalysis: boolean;
  confirmationTimeout: number;  // ms
  alwaysConfirm: DangerCategory[];
  neverConfirm: string[];  // Tool names that never require confirmation
  customPatterns: CustomPattern[];
}

export interface CustomPattern {
  category: DangerCategory;
  keywords: string[];
  riskLevel: RiskLevel;
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  enabled: true,
  riskThreshold: 'medium',
  useLLMAnalysis: false,
  confirmationTimeout: 60000,  // 1 minute
  alwaysConfirm: ['delete', 'payment'],
  neverConfirm: ['observe', 'getPageInfo', 'screenshot', 'wait', 'listPages'],
  customPatterns: [],
};

// ============================================
// Danger Keywords (HI-05, HI-08)
// ============================================

export const DANGER_KEYWORDS = {
  // HI-01: 删除操作
  delete: {
    zh: ['删除', '移除', '清空', '注销', '销毁', '擦除', '清除', '丢弃'],
    en: ['delete', 'remove', 'clear', 'destroy', 'erase', 'discard', 'wipe', 'unsubscribe', 'deactivate'],
  },
  
  // HI-02: 支付操作
  payment: {
    zh: ['支付', '付款', '购买', '结账', '订单', '确认订单', '立即购买', '加入购物车'],
    en: ['pay', 'payment', 'purchase', 'buy', 'checkout', 'order', 'add to cart', 'confirm order', 'place order'],
  },
  
  // HI-03: 提交操作
  submit: {
    zh: ['提交', '确认', '发送', '发布', '申请', '保存', '更新'],
    en: ['submit', 'confirm', 'send', 'post', 'publish', 'apply', 'save changes', 'update'],
  },
  
  // HI-04: 账号操作
  account: {
    zh: ['密码', '账号', '账户', '登出', '退出登录', '修改密码', '绑定', '解绑'],
    en: ['password', 'account', 'logout', 'sign out', 'change password', 'bind', 'unbind', 'link', 'unlink'],
  },
  
  // Privacy related
  privacy: {
    zh: ['隐私', '权限', '授权', '分享', '公开'],
    en: ['privacy', 'permission', 'authorize', 'share', 'public', 'consent'],
  },
};

// ============================================
// Button Text Patterns (HI-05)
// ============================================

export const DANGEROUS_BUTTON_PATTERNS = [
  // Delete patterns
  /^(删除|移除|清空|remove|delete|clear|discard)/i,
  /永久删除|permanently delete/i,
  /确认删除|confirm delete/i,
  
  // Payment patterns
  /^(支付|付款|购买|pay|buy|purchase)/i,
  /立即(支付|购买)|pay now|buy now/i,
  /确认(订单|支付)|confirm (order|payment)/i,
  
  // Account patterns
  /^(注销|登出|sign out|logout|deactivate)/i,
  /删除(账号|账户)|delete account/i,
  
  // Irreversible patterns
  /不可恢复|无法撤销|irreversible|cannot undo/i,
];

// ============================================
// Events
// ============================================

export type SafetyEventType = 
  | 'danger_detected'
  | 'confirmation_requested'
  | 'confirmation_received'
  | 'confirmation_timeout'
  | 'action_blocked'
  | 'action_allowed';

export interface SafetyEvent {
  type: SafetyEventType;
  timestamp: string;
  data: unknown;
}

