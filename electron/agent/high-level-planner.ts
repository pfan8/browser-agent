/**
 * High-Level Planner
 * 
 * Responsible for task decomposition and replanning:
 * - Breaks down complex tasks into actionable steps
 * - Tracks progress through the plan
 * - Replans when steps fail
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';
import type {
  TaskPlan,
  TaskStep,
  TaskStepStatus,
  PlanningResult,
  Observation,
  AgentConfig,
  ExecutionResult,
} from './types';
import { generateId, DEFAULT_AGENT_CONFIG } from './types';
import { MemoryManager } from './memory/memory-manager';
import { toolRegistry } from './tools/tool-registry';

export interface PlannerConfig {
  llmModel: string;
  maxStepsPerPlan: number;
  maxReplanAttempts: number;
}

export interface PlannerLLMAdapter {
  generatePlan(
    task: string,
    observation: Observation,
    context: Record<string, unknown>,
    availableTools: string
  ): Promise<PlanningResult>;

  replan(
    currentPlan: TaskPlan,
    failedStep: TaskStep,
    error: string,
    observation: Observation
  ): Promise<PlanningResult>;
}

export class HighLevelPlanner extends EventEmitter {
  private config: PlannerConfig;
  private memoryManager: MemoryManager;
  private llmAdapter: PlannerLLMAdapter | null = null;
  private anthropicClient: Anthropic | null = null;
  private replanCount: number = 0;
  private anthropicBaseUrl: string | undefined = undefined;

  constructor(
    memoryManager: MemoryManager,
    config?: Partial<PlannerConfig>,
    anthropicApiKey?: string,
    anthropicBaseUrl?: string
  ) {
    super();
    this.memoryManager = memoryManager;
    this.config = {
      llmModel: config?.llmModel ?? DEFAULT_AGENT_CONFIG.llmModel,
      maxStepsPerPlan: config?.maxStepsPerPlan ?? 10,
      maxReplanAttempts: config?.maxReplanAttempts ?? 3,
    };
    this.anthropicBaseUrl = anthropicBaseUrl;

    if (anthropicApiKey) {
      this.createAnthropicClient(anthropicApiKey, anthropicBaseUrl);
    }
  }

  /**
   * Create Anthropic client with optional custom base URL
   */
  private createAnthropicClient(apiKey: string, baseUrl?: string): void {
    const options: { apiKey: string; baseURL?: string } = { apiKey };
    if (baseUrl) {
      options.baseURL = baseUrl;
    }
    this.anthropicClient = new Anthropic(options);
    
    const keyPreview = apiKey 
      ? `${apiKey.substring(0, 10)}...${apiKey.slice(-4)}`
      : 'none';
    console.log(`[DEBUG] HighLevelPlanner: Anthropic client created with keyPreview=${keyPreview}, baseURL=${baseUrl || 'default'}`);
  }

  /**
   * Set custom LLM adapter (for testing or alternative LLMs)
   */
  setLLMAdapter(adapter: PlannerLLMAdapter): void {
    this.llmAdapter = adapter;
  }

  /**
   * Set Anthropic API key (legacy method, uses stored baseUrl)
   */
  setApiKey(apiKey: string): void {
    this.createAnthropicClient(apiKey, this.anthropicBaseUrl);
  }

  /**
   * Set Anthropic configuration (API key and optional base URL)
   */
  setLLMConfig(config: { apiKey: string; baseUrl?: string }): void {
    this.anthropicBaseUrl = config.baseUrl;
    this.createAnthropicClient(config.apiKey, config.baseUrl);
  }

  /**
   * Create a new plan for a task
   */
  async createPlan(
    task: string,
    observation: Observation,
    context: Record<string, unknown> = {}
  ): Promise<PlanningResult> {
    this.replanCount = 0;
    const availableTools = toolRegistry.getToolDescriptionsForPrompt();

    // Use custom adapter if available
    if (this.llmAdapter) {
      return this.llmAdapter.generatePlan(task, observation, context, availableTools);
    }

    // Use built-in Anthropic implementation
    if (!this.anthropicClient) {
      console.log(`[DEBUG] createPlan: No Anthropic client, using rule-based planning`);
      // Fallback: generate simple rule-based plan
      return this.generateRuleBasedPlan(task, observation, context);
    }

    try {
      console.log(`[DEBUG] createPlan: Using Anthropic API for task: ${task.substring(0, 50)}...`);
      const prompt = this.buildPlanningPrompt(task, observation, context, availableTools);
      
      const response = await this.anthropicClient.messages.create({
        model: this.config.llmModel,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        system: this.getPlanningSystemPrompt(),
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      return this.parsePlanResponse(content.text, task, context);
    } catch (error) {
      console.error('LLM planning failed:', error);
      // Fallback to rule-based
      return this.generateRuleBasedPlan(task, observation, context);
    }
  }

  /**
   * Replan after a step failure
   */
  async replan(
    currentPlan: TaskPlan,
    failedStep: TaskStep,
    error: string,
    observation: Observation
  ): Promise<PlanningResult> {
    this.replanCount++;

    if (this.replanCount > this.config.maxReplanAttempts) {
      return {
        success: false,
        error: `Max replan attempts (${this.config.maxReplanAttempts}) exceeded`,
        reasoning: 'Too many failed attempts to replan',
      };
    }

    // Use custom adapter if available
    if (this.llmAdapter) {
      return this.llmAdapter.replan(currentPlan, failedStep, error, observation);
    }

    // Use built-in implementation
    if (!this.anthropicClient) {
      console.log(`[DEBUG] replan: No Anthropic client, using fallback replan`);
      return this.generateFallbackReplan(currentPlan, failedStep, error);
    }

    try {
      console.log(`[DEBUG] replan: Using Anthropic API for replan, attempt ${this.replanCount}`);
      const prompt = this.buildReplanPrompt(currentPlan, failedStep, error, observation);
      
      const response = await this.anthropicClient.messages.create({
        model: this.config.llmModel,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
        system: this.getReplanSystemPrompt(),
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type');
      }

      const result = this.parsePlanResponse(content.text, currentPlan.goal, {
        ...currentPlan.context,
        previousError: error,
        replanCount: this.replanCount,
      });

      if (result.success && result.plan) {
        this.emit('replanned', { originalPlan: currentPlan, newPlan: result.plan, error });
      }

      return result;
    } catch (error) {
      console.error('LLM replanning failed:', error);
      return this.generateFallbackReplan(currentPlan, failedStep, error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Update plan after step completion
   */
  updatePlanProgress(plan: TaskPlan, stepResult: ExecutionResult): TaskPlan {
    const updatedPlan = { ...plan };
    const currentStep = updatedPlan.steps[updatedPlan.currentStepIndex];

    if (currentStep && currentStep.id === stepResult.stepId) {
      currentStep.status = stepResult.success ? 'completed' : 'failed';
      currentStep.result = stepResult.results[stepResult.results.length - 1];
    }

    // Move to next step if current succeeded
    if (stepResult.success && updatedPlan.currentStepIndex < updatedPlan.steps.length - 1) {
      updatedPlan.currentStepIndex++;
    }

    // Check if plan is complete
    const allCompleted = updatedPlan.steps.every(s => s.status === 'completed');
    const anyFailed = updatedPlan.steps.some(s => s.status === 'failed');

    if (allCompleted) {
      updatedPlan.status = 'completed';
    } else if (anyFailed) {
      updatedPlan.status = 'failed';
    }

    updatedPlan.updatedAt = new Date().toISOString();

    return updatedPlan;
  }

  /**
   * Get the current step to execute
   */
  getCurrentStep(plan: TaskPlan): TaskStep | null {
    if (plan.status !== 'active') {
      return null;
    }

    const step = plan.steps[plan.currentStepIndex];
    if (!step || step.status === 'completed' || step.status === 'skipped') {
      return null;
    }

    return step;
  }

  /**
   * Check if plan is complete
   */
  isPlanComplete(plan: TaskPlan): boolean {
    return plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled';
  }

  /**
   * Cancel a plan
   */
  cancelPlan(plan: TaskPlan): TaskPlan {
    return {
      ...plan,
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get plan progress info
   */
  getPlanProgress(plan: TaskPlan): {
    total: number;
    completed: number;
    failed: number;
    pending: number;
    percentage: number;
  } {
    const total = plan.steps.length;
    const completed = plan.steps.filter(s => s.status === 'completed').length;
    const failed = plan.steps.filter(s => s.status === 'failed').length;
    const pending = plan.steps.filter(s => s.status === 'pending' || s.status === 'in_progress').length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { total, completed, failed, pending, percentage };
  }

  /**
   * Skip remaining steps (useful after replan)
   */
  skipRemainingSteps(plan: TaskPlan, fromIndex: number): TaskPlan {
    const updatedSteps = plan.steps.map((step, idx) => {
      if (idx >= fromIndex && step.status === 'pending') {
        return { ...step, status: 'skipped' as TaskStepStatus };
      }
      return step;
    });

    return {
      ...plan,
      steps: updatedSteps,
      updatedAt: new Date().toISOString(),
    };
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  private getPlanningSystemPrompt(): string {
    return `你是一个浏览器自动化规划助手。你的任务是将用户的高级目标分解为具体的、可执行的步骤。

规则:
1. 每个步骤必须使用一个可用的工具
2. 步骤应该是原子性的（一个步骤只做一件事）
3. 步骤顺序应该合理
4. 最多生成 ${this.config.maxStepsPerPlan} 个步骤
5. 考虑错误恢复和等待

输出格式（JSON）:
{
  "reasoning": "你的规划思路",
  "steps": [
    {
      "description": "步骤描述",
      "tool": "工具名称",
      "args": { "参数名": "参数值" }
    }
  ]
}

只输出 JSON，不要包含其他内容。`;
  }

  private getReplanSystemPrompt(): string {
    return `你是一个浏览器自动化规划助手。当前计划的某个步骤失败了，你需要创建一个新的计划来完成原始目标。

规则:
1. 分析失败原因，调整策略
2. 可能需要添加等待步骤
3. 可能需要使用不同的选择器
4. 可能需要添加额外的观察步骤
5. 最多生成 ${this.config.maxStepsPerPlan} 个步骤

输出格式（JSON）:
{
  "reasoning": "重新规划的思路，包括失败原因分析",
  "steps": [
    {
      "description": "步骤描述",
      "tool": "工具名称",
      "args": { "参数名": "参数值" }
    }
  ]
}

只输出 JSON，不要包含其他内容。`;
  }

  private buildPlanningPrompt(
    task: string,
    observation: Observation,
    context: Record<string, unknown>,
    availableTools: string
  ): string {
    let prompt = `任务: ${task}\n\n`;
    
    prompt += `当前页面状态:\n`;
    prompt += `- URL: ${observation.url}\n`;
    prompt += `- 标题: ${observation.title}\n`;
    
    if (observation.visibleElements && observation.visibleElements.length > 0) {
      prompt += `- 可见元素 (${observation.visibleElements.length}个):\n`;
      observation.visibleElements.slice(0, 10).forEach(el => {
        prompt += `  - ${el.tag}${el.text ? `: "${el.text.slice(0, 30)}"` : ''} [${el.selector}]\n`;
      });
    }

    prompt += `\n可用工具:\n${availableTools}\n`;

    if (Object.keys(context).length > 0) {
      prompt += `\n上下文信息: ${JSON.stringify(context)}\n`;
    }

    prompt += `\n请为这个任务创建一个执行计划。`;

    return prompt;
  }

  private buildReplanPrompt(
    currentPlan: TaskPlan,
    failedStep: TaskStep,
    error: string,
    observation: Observation
  ): string {
    let prompt = `原始目标: ${currentPlan.goal}\n\n`;
    
    prompt += `失败的步骤:\n`;
    prompt += `- 描述: ${failedStep.description}\n`;
    prompt += `- 工具: ${failedStep.tool}\n`;
    prompt += `- 参数: ${JSON.stringify(failedStep.args)}\n`;
    prompt += `- 错误: ${error}\n\n`;

    prompt += `当前页面状态:\n`;
    prompt += `- URL: ${observation.url}\n`;
    prompt += `- 标题: ${observation.title}\n`;
    
    if (observation.visibleElements && observation.visibleElements.length > 0) {
      prompt += `- 可见元素 (${observation.visibleElements.length}个):\n`;
      observation.visibleElements.slice(0, 10).forEach(el => {
        prompt += `  - ${el.tag}${el.text ? `: "${el.text.slice(0, 30)}"` : ''} [${el.selector}]\n`;
      });
    }

    prompt += `\n已完成的步骤:\n`;
    currentPlan.steps.filter(s => s.status === 'completed').forEach((s, i) => {
      prompt += `${i + 1}. ${s.description} ✓\n`;
    });

    prompt += `\n请创建一个新的计划来完成原始目标。`;

    return prompt;
  }

  private parsePlanResponse(
    response: string,
    goal: string,
    context: Record<string, unknown>
  ): PlanningResult {
    try {
      // Try to extract JSON from response
      let jsonStr = response.trim();
      
      // Handle markdown code blocks
      const codeBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (codeBlockMatch) {
        jsonStr = codeBlockMatch[1].trim();
      }

      // Try to find JSON object
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }

      const parsed = JSON.parse(jsonStr);

      if (!parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error('Invalid plan format: missing steps array');
      }

      const steps: TaskStep[] = parsed.steps.map((s: { description: string; tool: string; args?: Record<string, unknown> }, index: number) => ({
        id: generateId('step'),
        description: s.description || `Step ${index + 1}`,
        tool: s.tool,
        args: s.args || {},
        status: 'pending' as TaskStepStatus,
        retryCount: 0,
        maxRetries: 3,
      }));

      const plan: TaskPlan = {
        id: generateId('plan'),
        goal,
        steps,
        currentStepIndex: 0,
        context,
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        success: true,
        plan,
        reasoning: parsed.reasoning || 'Plan generated successfully',
      };
    } catch (parseError) {
      console.error('Failed to parse plan response:', parseError);
      return {
        success: false,
        error: `Failed to parse LLM response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
      };
    }
  }

  private generateRuleBasedPlan(
    task: string,
    observation: Observation,
    context: Record<string, unknown>
  ): PlanningResult {
    const steps: TaskStep[] = [];
    const lowerTask = task.toLowerCase();

    // Analysis/Help request detection - these need page observation first
    const isAnalysisRequest = 
      lowerTask.includes('分析') || 
      lowerTask.includes('帮我') || 
      lowerTask.includes('怎么') || 
      lowerTask.includes('如何') ||
      lowerTask.includes('查看') ||
      lowerTask.includes('找到') ||
      lowerTask.includes('help') ||
      lowerTask.includes('analyze') ||
      lowerTask.includes('how to');
    
    if (isAnalysisRequest) {
      // First, take a screenshot to observe the current page
      steps.push(this.createStep('Capture current page state', 'screenshot', { name: 'analysis' }));
      steps.push(this.createStep('Observe page elements', 'observe', { includeElements: true }));
    }

    // Create/New operation detection
    if (lowerTask.includes('新建') || lowerTask.includes('创建') || lowerTask.includes('添加') ||
        lowerTask.includes('create') || lowerTask.includes('new') || lowerTask.includes('add')) {
      // Look for create/new/add buttons
      const createSelectors = [
        'button:has-text("新建")', 'button:has-text("创建")', 'button:has-text("添加")',
        'button:has-text("New")', 'button:has-text("Create")', 'button:has-text("Add")',
        '[data-testid*="create"]', '[data-testid*="new"]', '[data-testid*="add"]',
        '.btn-create', '.btn-new', '.btn-add', '.create-btn', '.new-btn', '.add-btn',
        'a:has-text("新建")', 'a:has-text("创建")', 'a:has-text("New")', 'a:has-text("Create")',
      ].join(', ');
      
      if (!isAnalysisRequest) {
        steps.push(this.createStep('Take screenshot before action', 'screenshot', {}));
      }
      steps.push(this.createStep('Click create/new button', 'click', { selector: createSelectors }));
      steps.push(this.createStep('Wait for dialog/page', 'wait', { ms: 1000 }));
      steps.push(this.createStep('Capture result', 'screenshot', { name: 'after-create' }));
    }

    // URL detection
    const urlMatch = task.match(/https?:\/\/[^\s]+/);
    if (urlMatch || lowerTask.includes('go to') || lowerTask.includes('navigate') || lowerTask.includes('open') || lowerTask.includes('打开')) {
      const url = urlMatch ? urlMatch[0] : this.extractUrlFromTask(task);
      if (url) {
        steps.push(this.createStep('Navigate to page', 'navigate', { url }));
      }
    }

    // Login flow detection
    if (lowerTask.includes('login') || lowerTask.includes('sign in') || lowerTask.includes('登录')) {
      if (lowerTask.includes('username') || lowerTask.includes('用户名')) {
        const username = this.extractValueAfter(task, ['username', '用户名']);
        steps.push(this.createStep('Enter username', 'type', { 
          selector: '#username, input[name="username"], input[type="text"]', 
          text: username || 'user' 
        }));
      }
      if (lowerTask.includes('password') || lowerTask.includes('密码')) {
        const password = this.extractValueAfter(task, ['password', '密码']);
        steps.push(this.createStep('Enter password', 'type', { 
          selector: '#password, input[name="password"], input[type="password"]', 
          text: password || 'pass' 
        }));
      }
      steps.push(this.createStep('Click login button', 'click', { 
        selector: 'button[type="submit"], #login, .login-btn, button:has-text("Login"), button:has-text("登录")' 
      }));
    }

    // Click detection
    if (lowerTask.includes('click') || lowerTask.includes('点击')) {
      const target = this.extractClickTarget(task);
      steps.push(this.createStep(`Click on ${target}`, 'click', { selector: target }));
    }

    // Type detection
    if ((lowerTask.includes('type') || lowerTask.includes('enter') || lowerTask.includes('input') || lowerTask.includes('输入')) 
        && !lowerTask.includes('login')) {
      const textMatch = task.match(/["']([^"']+)["']/);
      const text = textMatch ? textMatch[1] : 'text';
      steps.push(this.createStep('Type text', 'type', { selector: 'input, textarea', text }));
    }

    // Wait detection
    if (lowerTask.includes('wait') || lowerTask.includes('等待')) {
      const msMatch = task.match(/(\d+)\s*(ms|millisecond|秒|s|second)/i);
      let ms = 1000;
      if (msMatch) {
        ms = parseInt(msMatch[1]);
        if (msMatch[2].toLowerCase().includes('s') || msMatch[2].includes('秒')) {
          ms *= 1000;
        }
      }
      steps.push(this.createStep('Wait', 'wait', { ms }));
    }

    // Screenshot detection
    if (lowerTask.includes('screenshot') || lowerTask.includes('截图') || lowerTask.includes('capture')) {
      steps.push(this.createStep('Take screenshot', 'screenshot', {}));
    }

    // Default: observe if no steps generated
    if (steps.length === 0) {
      steps.push(this.createStep('Take screenshot of current page', 'screenshot', {}));
      steps.push(this.createStep('Observe page state', 'observe', { includeElements: true }));
    }

    const plan: TaskPlan = {
      id: generateId('plan'),
      goal: task,
      steps,
      currentStepIndex: 0,
      context,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      plan,
      reasoning: 'Rule-based plan generated',
    };
  }

  private generateFallbackReplan(
    currentPlan: TaskPlan,
    failedStep: TaskStep,
    error: string
  ): PlanningResult {
    const steps: TaskStep[] = [];

    // Add wait step first
    steps.push(this.createStep('Wait for page to stabilize', 'wait', { ms: 1000 }));

    // Add observe step
    steps.push(this.createStep('Observe current page state', 'observe', {}));

    // Retry the failed step with alternative approach
    const modifiedArgs = { ...failedStep.args };
    
    // If click failed, try adding wait for selector
    if (failedStep.tool === 'click' && modifiedArgs.selector) {
      steps.push(this.createStep('Wait for element', 'waitForSelector', { 
        selector: modifiedArgs.selector, 
        state: 'visible' 
      }));
    }

    // Retry original step
    steps.push(this.createStep(`Retry: ${failedStep.description}`, failedStep.tool, modifiedArgs));

    // Add remaining steps from original plan
    const failedIndex = currentPlan.steps.findIndex(s => s.id === failedStep.id);
    for (let i = failedIndex + 1; i < currentPlan.steps.length; i++) {
      const step = currentPlan.steps[i];
      if (step.status === 'pending') {
        steps.push(this.createStep(step.description, step.tool, step.args));
      }
    }

    const plan: TaskPlan = {
      id: generateId('plan'),
      goal: currentPlan.goal,
      steps,
      currentStepIndex: 0,
      context: {
        ...currentPlan.context,
        previousError: error,
        replanCount: this.replanCount,
      },
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return {
      success: true,
      plan,
      reasoning: `Fallback replan after error: ${error}`,
    };
  }

  private createStep(description: string, tool: string, args: Record<string, unknown>): TaskStep {
    return {
      id: generateId('step'),
      description,
      tool,
      args,
      status: 'pending',
      retryCount: 0,
      maxRetries: 3,
    };
  }

  private extractUrlFromTask(task: string): string | null {
    // Try to extract domain-like patterns
    const domainMatch = task.match(/(?:go to|navigate to|open|visit)\s+([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (domainMatch) {
      return `https://${domainMatch[1]}`;
    }
    return null;
  }

  private extractValueAfter(task: string, keywords: string[]): string | null {
    for (const keyword of keywords) {
      const regex = new RegExp(`${keyword}[:\\s]+["']?([^"'\\s]+)["']?`, 'i');
      const match = task.match(regex);
      if (match) {
        return match[1];
      }
    }
    return null;
  }

  private extractClickTarget(task: string): string {
    const patterns = [
      /click (?:on )?["']([^"']+)["']/i,
      /click (?:on )?the\s+([^\s.!?]+)/i,
      /点击["']?([^"']+)["']?/,
      /click\s+([^\s.!?]+)/i,
    ];

    for (const pattern of patterns) {
      const match = task.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'button';
  }

  /**
   * Get replan count
   */
  getReplanCount(): number {
    return this.replanCount;
  }

  /**
   * Reset replan count
   */
  resetReplanCount(): void {
    this.replanCount = 0;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<PlannerConfig>): void {
    Object.assign(this.config, config);
  }

  /**
   * Get current configuration
   */
  getConfig(): PlannerConfig {
    return { ...this.config };
  }
}

