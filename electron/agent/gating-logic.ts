/**
 * Gating Logic Module
 * 
 * Determines when to trigger CodeAct based on predefined rules.
 * This is the decision layer between ReAct and CodeAct.
 * 
 * Rules trigger CodeAct when:
 * 1. DOM structure is too large (>10000 characters)
 * 2. LLM selector generation fails 2+ times consecutively
 * 3. Complex logic is required (sorting, filtering, similarity)
 * 4. User instruction contains specific keywords (extract all, click all, etc.)
 */

import type {
  GatingRule,
  GatingRuleType,
  GatingContext,
  GatingDecision,
  Observation,
  ReActAction,
} from './types';

// ============================================
// Gating Rules Configuration
// ============================================

const DOM_SIZE_THRESHOLD = 10000; // characters
const CONSECUTIVE_SELECTOR_FAILURES = 2;

/**
 * Keywords that suggest complex data extraction
 */
const DATA_EXTRACTION_KEYWORDS = [
  '提取所有', '获取所有', '列出所有', '找到所有',
  'extract all', 'get all', 'list all', 'find all',
  '所有链接', '所有按钮', '所有输入框', '所有元素',
  'all links', 'all buttons', 'all inputs', 'all elements',
  '导出', 'export', '下载', 'download',
];

/**
 * Keywords that suggest batch operations
 */
const BATCH_OPERATION_KEYWORDS = [
  '点击所有', '填写所有', '选择所有',
  'click all', 'fill all', 'select all',
  '批量', 'batch', '循环', 'loop',
  '每一个', 'each', '全部', 'every',
];

/**
 * Keywords that suggest complex logic
 */
const COMPLEX_LOGIC_KEYWORDS = [
  '最便宜', '最贵', '最高', '最低', '排序',
  'cheapest', 'most expensive', 'highest', 'lowest', 'sort',
  '价格', '评分', '评价', '日期',
  'price', 'rating', 'review', 'date',
  '比较', '筛选', '过滤',
  'compare', 'filter', 'search',
  '相似', '匹配', '最接近',
  'similar', 'match', 'closest',
];

/**
 * Keywords that suggest script generation
 */
const SCRIPT_GENERATION_KEYWORDS = [
  '生成脚本', '生成代码', '自动化脚本',
  'generate script', 'generate code', 'automation script',
  '写代码', '编写脚本',
  'write code', 'write script',
];

// ============================================
// Gating Rules Implementation
// ============================================

/**
 * Rule: DOM size is too large for LLM to process effectively
 */
const domSizeRule: GatingRule = {
  type: 'dom_size',
  description: 'DOM structure is too large (>10000 chars)',
  priority: 1,
  condition: (ctx: GatingContext): boolean => {
    return ctx.domSize > DOM_SIZE_THRESHOLD;
  },
};

/**
 * Rule: Multiple consecutive selector failures indicate need for smarter matching
 */
const selectorFailuresRule: GatingRule = {
  type: 'selector_failures',
  description: 'Consecutive selector failures detected',
  priority: 2,
  condition: (ctx: GatingContext): boolean => {
    return ctx.consecutiveSelectorFailures >= CONSECUTIVE_SELECTOR_FAILURES;
  },
};

/**
 * Rule: User instruction contains complex logic requirements
 */
const complexLogicRule: GatingRule = {
  type: 'complex_logic',
  description: 'Complex logic required (sorting, filtering, comparison)',
  priority: 3,
  condition: (ctx: GatingContext): boolean => {
    const instruction = ctx.userInstruction.toLowerCase();
    return COMPLEX_LOGIC_KEYWORDS.some(kw => instruction.includes(kw));
  },
};

/**
 * Rule: User instruction indicates data extraction task
 */
const dataExtractionRule: GatingRule = {
  type: 'data_extraction',
  description: 'Data extraction task detected',
  priority: 4,
  condition: (ctx: GatingContext): boolean => {
    const instruction = ctx.userInstruction.toLowerCase();
    return DATA_EXTRACTION_KEYWORDS.some(kw => instruction.includes(kw));
  },
};

/**
 * Rule: User instruction indicates batch operation
 */
const batchOperationRule: GatingRule = {
  type: 'user_instruction',
  description: 'Batch operation detected',
  priority: 5,
  condition: (ctx: GatingContext): boolean => {
    const instruction = ctx.userInstruction.toLowerCase();
    return BATCH_OPERATION_KEYWORDS.some(kw => instruction.includes(kw));
  },
};

/**
 * Rule: User wants to generate automation script
 */
const scriptGenerationRule: GatingRule = {
  type: 'user_instruction',
  description: 'Script generation requested',
  priority: 6,
  condition: (ctx: GatingContext): boolean => {
    const instruction = ctx.userInstruction.toLowerCase();
    return SCRIPT_GENERATION_KEYWORDS.some(kw => instruction.includes(kw));
  },
};

// All rules sorted by priority
const ALL_RULES: GatingRule[] = [
  domSizeRule,
  selectorFailuresRule,
  complexLogicRule,
  dataExtractionRule,
  batchOperationRule,
  scriptGenerationRule,
].sort((a, b) => a.priority - b.priority);

// ============================================
// Gating Logic Class
// ============================================

export class GatingLogic {
  private rules: GatingRule[];
  private enabled: boolean = true;
  
  constructor(customRules?: GatingRule[]) {
    this.rules = customRules || ALL_RULES;
  }
  
  /**
   * Enable or disable gating
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  /**
   * Check if CodeAct should be triggered
   */
  shouldTriggerCodeAct(context: GatingContext): GatingDecision {
    if (!this.enabled) {
      return {
        shouldUseCodeAct: false,
        triggeredRules: [],
        confidence: 0,
      };
    }
    
    const triggeredRules: GatingRuleType[] = [];
    let maxConfidence = 0;
    let suggestedTask: string | undefined;
    
    for (const rule of this.rules) {
      if (rule.condition(context)) {
        triggeredRules.push(rule.type);
        
        // Calculate confidence based on rule type
        const confidence = this.calculateRuleConfidence(rule, context);
        if (confidence > maxConfidence) {
          maxConfidence = confidence;
        }
        
        // Generate suggested task based on first triggered rule
        if (!suggestedTask) {
          suggestedTask = this.generateSuggestedTask(rule, context);
        }
      }
    }
    
    return {
      shouldUseCodeAct: triggeredRules.length > 0,
      triggeredRules,
      suggestedTask,
      confidence: maxConfidence,
    };
  }
  
  /**
   * Calculate confidence score for a rule
   */
  private calculateRuleConfidence(rule: GatingRule, context: GatingContext): number {
    switch (rule.type) {
      case 'dom_size':
        // Higher confidence for larger DOM
        const sizeRatio = context.domSize / DOM_SIZE_THRESHOLD;
        return Math.min(0.6 + (sizeRatio - 1) * 0.2, 0.95);
        
      case 'selector_failures':
        // Higher confidence for more failures
        const failureRatio = context.consecutiveSelectorFailures / CONSECUTIVE_SELECTOR_FAILURES;
        return Math.min(0.7 + (failureRatio - 1) * 0.1, 0.95);
        
      case 'complex_logic':
        return 0.85;
        
      case 'data_extraction':
        return 0.9;
        
      case 'user_instruction':
        return 0.8;
        
      default:
        return 0.7;
    }
  }
  
  /**
   * Generate suggested CodeAct task based on triggered rule
   */
  private generateSuggestedTask(rule: GatingRule, context: GatingContext): string {
    switch (rule.type) {
      case 'dom_size':
        return 'Parse the large DOM structure and extract relevant elements for the task';
        
      case 'selector_failures':
        return `Find the best matching element for: "${context.goal}" using fuzzy matching`;
        
      case 'complex_logic':
        return `Process data with complex logic: ${context.userInstruction}`;
        
      case 'data_extraction':
        return `Extract all requested data: ${context.userInstruction}`;
        
      case 'user_instruction':
        return `Execute batch operation: ${context.userInstruction}`;
        
      default:
        return context.userInstruction;
    }
  }
  
  /**
   * Create context from observation and action history
   */
  static createContext(
    observation: Observation,
    goal: string,
    userInstruction: string,
    actionHistory: ReActAction[] = []
  ): GatingContext {
    // Calculate DOM size from various sources
    let domSize = 0;
    if (observation.domSnapshot) {
      domSize = observation.domSnapshot.length;
    } else if (observation.visibleElements) {
      domSize = JSON.stringify(observation.visibleElements).length;
    }
    
    // Count consecutive selector failures
    let consecutiveSelectorFailures = 0;
    for (let i = actionHistory.length - 1; i >= 0; i--) {
      const action = actionHistory[i];
      if (action.result && !action.result.success) {
        if (action.tool === 'click' || action.tool === 'type' || action.tool === 'waitForSelector') {
          consecutiveSelectorFailures++;
        } else {
          break;
        }
      } else {
        break;
      }
    }
    
    return {
      observation,
      goal,
      actionHistory,
      consecutiveSelectorFailures,
      domSize,
      userInstruction,
    };
  }
  
  /**
   * Add a custom rule
   */
  addRule(rule: GatingRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => a.priority - b.priority);
  }
  
  /**
   * Remove a rule by type
   */
  removeRule(type: GatingRuleType): boolean {
    const index = this.rules.findIndex(r => r.type === type);
    if (index >= 0) {
      this.rules.splice(index, 1);
      return true;
    }
    return false;
  }
  
  /**
   * Get all rules
   */
  getRules(): GatingRule[] {
    return [...this.rules];
  }
  
  /**
   * Check if a specific rule would trigger
   */
  checkRule(type: GatingRuleType, context: GatingContext): boolean {
    const rule = this.rules.find(r => r.type === type);
    if (!rule) return false;
    return rule.condition(context);
  }
}

// ============================================
// Utility Functions
// ============================================

/**
 * Quick check for data extraction keywords
 */
export function isDataExtractionTask(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return DATA_EXTRACTION_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Quick check for complex logic keywords
 */
export function isComplexLogicTask(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return COMPLEX_LOGIC_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Quick check for batch operation keywords
 */
export function isBatchOperationTask(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return BATCH_OPERATION_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Quick check for script generation keywords
 */
export function isScriptGenerationTask(instruction: string): boolean {
  const lower = instruction.toLowerCase();
  return SCRIPT_GENERATION_KEYWORDS.some(kw => lower.includes(kw));
}

// Export singleton instance
export const gatingLogic = new GatingLogic();

// Export factory function
export function createGatingLogic(customRules?: GatingRule[]): GatingLogic {
  return new GatingLogic(customRules);
}

