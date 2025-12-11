/**
 * Danger Detector
 * 
 * Detects dangerous operations that require user confirmation:
 * - HI-01: Delete operations
 * - HI-02: Payment operations
 * - HI-03: Submit operations
 * - HI-04: Account operations
 * - HI-05: Button text recognition
 * - HI-06: Context awareness
 * - HI-07: Agent intelligent judgment (LLM)
 * - HI-08: Semantic variant recognition
 * - HI-09: Consequence reasoning
 */

import type {
  RiskLevel,
  RiskAssessment,
  DangerCategory,
  DangerDetectionResult,
  MatchedPattern,
  ContextAnalysis,
  PageType,
  FormType,
  SafetyConfig,
  PendingAction,
} from './types';
import {
  DEFAULT_SAFETY_CONFIG,
  DANGER_KEYWORDS,
  DANGEROUS_BUTTON_PATTERNS,
} from './types';

// ============================================
// Danger Detector Class
// ============================================

export class DangerDetector {
  private config: SafetyConfig;

  constructor(config: Partial<SafetyConfig> = {}) {
    this.config = { ...DEFAULT_SAFETY_CONFIG, ...config };
  }

  /**
   * Main detection method
   */
  async detect(action: PendingAction, pageContext?: {
    url?: string;
    title?: string;
    html?: string;
    visibleElements?: Array<{
      selector: string;
      tag: string;
      text?: string;
      attributes?: Record<string, string>;
    }>;
  }): Promise<DangerDetectionResult> {
    if (!this.config.enabled) {
      return this.createSafeResult();
    }

    // Check if tool is in never-confirm list
    if (this.config.neverConfirm.includes(action.tool)) {
      return this.createSafeResult();
    }

    const matchedPatterns: MatchedPattern[] = [];
    
    // HI-01 ~ HI-04: Check keywords in args and thought
    const keywordMatches = this.checkKeywords(action);
    matchedPatterns.push(...keywordMatches);
    
    // HI-05: Check button text patterns
    if (action.targetElement?.text) {
      const buttonMatches = this.checkButtonText(action.targetElement.text);
      matchedPatterns.push(...buttonMatches);
    }
    
    // HI-06: Context analysis
    const contextAnalysis = pageContext ? this.analyzeContext(pageContext) : undefined;
    if (contextAnalysis) {
      const contextMatches = this.getContextPatterns(contextAnalysis);
      matchedPatterns.push(...contextMatches);
    }
    
    // HI-08: Check semantic variants
    const variantMatches = this.checkSemanticVariants(action);
    matchedPatterns.push(...variantMatches);
    
    // Calculate risk
    const risk = this.calculateRisk(matchedPatterns, contextAnalysis);
    
    // HI-09: Consequence reasoning
    if (risk.level !== 'safe') {
      risk.reasons.push(...this.inferConsequences(action, risk.category));
    }
    
    return {
      isDangerous: risk.level !== 'safe' && risk.level !== 'low',
      risk,
      matchedPatterns,
      contextAnalysis,
    };
  }

  /**
   * HI-01 ~ HI-04: Check danger keywords
   */
  private checkKeywords(action: PendingAction): MatchedPattern[] {
    const patterns: MatchedPattern[] = [];
    
    // Combine all text to check
    const textsToCheck = [
      action.thought,
      action.reasoning,
      JSON.stringify(action.args),
      action.targetElement?.text || '',
    ].join(' ').toLowerCase();
    
    // Check each category
    for (const [category, keywords] of Object.entries(DANGER_KEYWORDS)) {
      const allKeywords = [...keywords.zh, ...keywords.en];
      
      for (const keyword of allKeywords) {
        if (textsToCheck.includes(keyword.toLowerCase())) {
          patterns.push({
            type: 'keyword',
            pattern: keyword,
            matched: keyword,
            confidence: 0.8,
          });
        }
      }
    }
    
    return patterns;
  }

  /**
   * HI-05: Check button text patterns
   */
  private checkButtonText(text: string): MatchedPattern[] {
    const patterns: MatchedPattern[] = [];
    
    for (const pattern of DANGEROUS_BUTTON_PATTERNS) {
      if (pattern.test(text)) {
        patterns.push({
          type: 'button_text',
          pattern: pattern.source,
          matched: text,
          confidence: 0.9,
        });
      }
    }
    
    return patterns;
  }

  /**
   * HI-06: Analyze page context
   */
  private analyzeContext(context: {
    url?: string;
    title?: string;
    html?: string;
    visibleElements?: Array<{
      selector: string;
      tag: string;
      text?: string;
      attributes?: Record<string, string>;
    }>;
  }): ContextAnalysis {
    const url = context.url?.toLowerCase() || '';
    const title = context.title?.toLowerCase() || '';
    const html = context.html?.toLowerCase() || '';
    
    // Detect page type
    let pageType: PageType = 'unknown';
    if (url.includes('checkout') || url.includes('pay') || url.includes('cart')) {
      pageType = 'checkout';
    } else if (url.includes('settings') || url.includes('preferences')) {
      pageType = 'settings';
    } else if (url.includes('profile') || url.includes('account')) {
      pageType = 'profile';
    } else if (url.includes('admin') || url.includes('dashboard')) {
      pageType = 'admin';
    } else if (url.includes('login') || url.includes('signin')) {
      pageType = 'login';
    } else if (url.includes('signup') || url.includes('register')) {
      pageType = 'signup';
    }
    
    // Detect form type
    let formType: FormType | undefined;
    if (html.includes('payment') || html.includes('credit card') || html.includes('信用卡')) {
      formType = 'payment';
    } else if (html.includes('contact') || html.includes('联系')) {
      formType = 'contact';
    }
    
    // Detect indicators
    const hasPaymentIndicators = 
      html.includes('payment') || html.includes('credit') || 
      html.includes('支付') || html.includes('付款') ||
      html.includes('checkout') || html.includes('结账');
      
    const hasDeleteIndicators =
      html.includes('delete') || html.includes('remove') ||
      html.includes('删除') || html.includes('移除') ||
      html.includes('permanently') || html.includes('永久');
      
    const hasAccountIndicators =
      html.includes('account') || html.includes('password') ||
      html.includes('账号') || html.includes('密码') ||
      html.includes('logout') || html.includes('退出');
    
    // Find related warning elements
    const relatedElements = (context.visibleElements || [])
      .filter(el => {
        const text = el.text?.toLowerCase() || '';
        return text.includes('warning') || text.includes('danger') ||
               text.includes('caution') || text.includes('注意') ||
               text.includes('警告') || text.includes('危险');
      })
      .map(el => ({
        selector: el.selector,
        text: el.text || '',
        role: el.attributes?.role,
        isWarning: true,
      }));
    
    return {
      pageType,
      formType,
      hasPaymentIndicators,
      hasDeleteIndicators,
      hasAccountIndicators,
      relatedElements,
    };
  }

  /**
   * Get patterns from context analysis
   */
  private getContextPatterns(analysis: ContextAnalysis): MatchedPattern[] {
    const patterns: MatchedPattern[] = [];
    
    if (analysis.hasPaymentIndicators) {
      patterns.push({
        type: 'context',
        pattern: 'payment_context',
        matched: 'Payment indicators on page',
        confidence: 0.7,
      });
    }
    
    if (analysis.hasDeleteIndicators) {
      patterns.push({
        type: 'context',
        pattern: 'delete_context',
        matched: 'Delete indicators on page',
        confidence: 0.7,
      });
    }
    
    if (analysis.hasAccountIndicators && analysis.pageType === 'settings') {
      patterns.push({
        type: 'context',
        pattern: 'account_settings',
        matched: 'Account settings page',
        confidence: 0.6,
      });
    }
    
    for (const el of analysis.relatedElements) {
      patterns.push({
        type: 'context',
        pattern: 'warning_element',
        matched: el.text,
        confidence: 0.8,
      });
    }
    
    return patterns;
  }

  /**
   * HI-08: Check semantic variants
   */
  private checkSemanticVariants(action: PendingAction): MatchedPattern[] {
    const patterns: MatchedPattern[] = [];
    const text = [action.thought, action.reasoning, action.targetElement?.text || ''].join(' ').toLowerCase();
    
    // Semantic variants for dangerous operations
    const semanticVariants: Record<string, string[]> = {
      delete: [
        '干掉', '搞掉', '弄没', '去掉', '拿走', '消掉', 'get rid of', 'throw away', 'trash', 'nuke',
      ],
      payment: [
        '掏钱', '花钱', '买单', '结账', '刷卡', 'swipe', 'charge', 'bill',
      ],
      submit: [
        '发出去', '提上去', '报上去', 'fire off', 'shoot',
      ],
      account: [
        '退出', '下线', '断开', 'sign off', 'kick out',
      ],
    };
    
    for (const [category, variants] of Object.entries(semanticVariants)) {
      for (const variant of variants) {
        if (text.includes(variant.toLowerCase())) {
          patterns.push({
            type: 'keyword',
            pattern: `semantic_${category}`,
            matched: variant,
            confidence: 0.6,
          });
        }
      }
    }
    
    return patterns;
  }

  /**
   * Calculate risk level from matched patterns
   */
  private calculateRisk(
    patterns: MatchedPattern[],
    context?: ContextAnalysis
  ): RiskAssessment {
    if (patterns.length === 0) {
      return {
        level: 'safe',
        score: 0,
        category: 'none',
        reasons: [],
        recommendation: 'proceed',
      };
    }
    
    // Calculate score
    let score = 0;
    const categories: DangerCategory[] = [];
    const reasons: string[] = [];
    
    for (const pattern of patterns) {
      score += pattern.confidence * 20;
      
      // Determine category
      if (pattern.pattern.includes('delete') || DANGER_KEYWORDS.delete.zh.some(k => pattern.matched.includes(k)) || DANGER_KEYWORDS.delete.en.some(k => pattern.matched.includes(k))) {
        categories.push('delete');
        reasons.push(`Detected delete-related keyword: ${pattern.matched}`);
      } else if (pattern.pattern.includes('payment') || DANGER_KEYWORDS.payment.zh.some(k => pattern.matched.includes(k)) || DANGER_KEYWORDS.payment.en.some(k => pattern.matched.includes(k))) {
        categories.push('payment');
        reasons.push(`Detected payment-related keyword: ${pattern.matched}`);
      } else if (pattern.pattern.includes('account') || DANGER_KEYWORDS.account.zh.some(k => pattern.matched.includes(k)) || DANGER_KEYWORDS.account.en.some(k => pattern.matched.includes(k))) {
        categories.push('account');
        reasons.push(`Detected account-related keyword: ${pattern.matched}`);
      } else if (pattern.pattern.includes('submit') || DANGER_KEYWORDS.submit.zh.some(k => pattern.matched.includes(k)) || DANGER_KEYWORDS.submit.en.some(k => pattern.matched.includes(k))) {
        categories.push('submit');
        reasons.push(`Detected submit-related keyword: ${pattern.matched}`);
      }
    }
    
    // Context boost
    if (context) {
      if (context.pageType === 'checkout') score += 20;
      if (context.hasPaymentIndicators) score += 15;
      if (context.hasDeleteIndicators) score += 15;
      if (context.relatedElements.length > 0) score += 10;
    }
    
    // Normalize score
    score = Math.min(100, score);
    
    // Determine level
    let level: RiskLevel;
    if (score >= 80) level = 'critical';
    else if (score >= 60) level = 'high';
    else if (score >= 40) level = 'medium';
    else if (score >= 20) level = 'low';
    else level = 'safe';
    
    // Determine primary category
    const categoryCount = categories.reduce((acc, cat) => {
      acc[cat] = (acc[cat] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    let primaryCategory: DangerCategory = 'unknown';
    let maxCount = 0;
    for (const [cat, count] of Object.entries(categoryCount)) {
      if (count > maxCount) {
        maxCount = count;
        primaryCategory = cat as DangerCategory;
      }
    }
    
    // Determine recommendation
    let recommendation: 'proceed' | 'confirm' | 'block';
    if (level === 'critical') recommendation = 'block';
    else if (level === 'high' || level === 'medium') recommendation = 'confirm';
    else recommendation = 'proceed';
    
    // Force confirmation for always-confirm categories
    if (this.config.alwaysConfirm.includes(primaryCategory) && recommendation === 'proceed') {
      recommendation = 'confirm';
    }
    
    return {
      level,
      score,
      category: primaryCategory,
      reasons,
      recommendation,
    };
  }

  /**
   * HI-09: Infer consequences
   */
  private inferConsequences(action: PendingAction, category: DangerCategory): string[] {
    const consequences: string[] = [];
    
    switch (category) {
      case 'delete':
        consequences.push('Data may be permanently lost');
        consequences.push('This action may not be reversible');
        break;
        
      case 'payment':
        consequences.push('Money may be charged to your account');
        consequences.push('A transaction will be initiated');
        break;
        
      case 'account':
        consequences.push('Account settings may be changed');
        consequences.push('You may be logged out or lose access');
        break;
        
      case 'submit':
        consequences.push('Information will be sent');
        consequences.push('The action may trigger a workflow');
        break;
        
      case 'privacy':
        consequences.push('Privacy settings may be affected');
        consequences.push('Data visibility may change');
        break;
    }
    
    return consequences;
  }

  /**
   * Create safe result
   */
  private createSafeResult(): DangerDetectionResult {
    return {
      isDangerous: false,
      risk: {
        level: 'safe',
        score: 0,
        category: 'none',
        reasons: [],
        recommendation: 'proceed',
      },
      matchedPatterns: [],
    };
  }

  /**
   * Quick check methods
   */
  isDeleteOperation(text: string): boolean {
    const lower = text.toLowerCase();
    return [...DANGER_KEYWORDS.delete.zh, ...DANGER_KEYWORDS.delete.en]
      .some(k => lower.includes(k.toLowerCase()));
  }

  isPaymentOperation(text: string): boolean {
    const lower = text.toLowerCase();
    return [...DANGER_KEYWORDS.payment.zh, ...DANGER_KEYWORDS.payment.en]
      .some(k => lower.includes(k.toLowerCase()));
  }

  isAccountOperation(text: string): boolean {
    const lower = text.toLowerCase();
    return [...DANGER_KEYWORDS.account.zh, ...DANGER_KEYWORDS.account.en]
      .some(k => lower.includes(k.toLowerCase()));
  }

  isSubmitOperation(text: string): boolean {
    const lower = text.toLowerCase();
    return [...DANGER_KEYWORDS.submit.zh, ...DANGER_KEYWORDS.submit.en]
      .some(k => lower.includes(k.toLowerCase()));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<SafetyConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): SafetyConfig {
    return { ...this.config };
  }
}

// Export singleton
export const dangerDetector = new DangerDetector();

// Export factory
export function createDangerDetector(config?: Partial<SafetyConfig>): DangerDetector {
  return new DangerDetector(config);
}

