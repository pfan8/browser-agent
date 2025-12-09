/**
 * ReAct Agent
 * 
 * Main agent implementation using the ReAct (Reasoning + Acting) pattern.
 * This is the core loop that:
 * 1. Observes the browser state
 * 2. Thinks about what to do next
 * 3. Acts (executes a tool)
 * 4. Verifies the result
 * 5. Repeats until goal is achieved or max iterations reached
 * 
 * CodeAct is integrated as a sub-tool for complex tasks.
 */

import { EventEmitter } from 'events';
import Anthropic from '@anthropic-ai/sdk';
import type {
  ReActState,
  ReActAction,
  ReActThinkResult,
  ReActConfig,
  Observation,
  AgentEvent,
  AgentEventType,
  ToolExecutionResult,
  CodeActResult,
  GatingContext,
} from './types';
import { generateId, DEFAULT_REACT_CONFIG } from './types';
import { toolRegistry } from './tools/tool-registry';
import { codeExecutor } from './tools/code-executor';
import { GatingLogic } from './gating-logic';
import { MemoryManager } from './memory/memory-manager';

// ============================================
// ReAct Agent Configuration
// ============================================

export interface ReactAgentConfig extends Partial<ReActConfig> {
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  llmModel?: string;
  enableScreenshots?: boolean;
  enableDomSnapshots?: boolean;
}

// ============================================
// ReAct Agent Implementation
// ============================================

export class ReactAgent extends EventEmitter {
  private config: ReActConfig;
  private anthropicClient: Anthropic | null = null;
  private llmModel: string = 'claude-3-haiku-20240307';
  private memoryManager: MemoryManager;
  private gatingLogic: GatingLogic;
  private state: ReActState | null = null;
  private shouldStop: boolean = false;
  private isRunning: boolean = false;

  constructor(
    memoryManager: MemoryManager,
    config?: ReactAgentConfig
  ) {
    super();
    this.memoryManager = memoryManager;
    this.config = { ...DEFAULT_REACT_CONFIG, ...config };
    this.gatingLogic = new GatingLogic();
    
    if (config?.anthropicApiKey) {
      this.createAnthropicClient(config.anthropicApiKey, config.anthropicBaseUrl);
    }
    
    if (config?.llmModel) {
      this.llmModel = config.llmModel;
    }
  }

  // ============================================
  // Configuration
  // ============================================

  /**
   * Create Anthropic client
   */
  private createAnthropicClient(apiKey: string, baseUrl?: string): void {
    const options: { apiKey: string; baseURL?: string } = { apiKey };
    if (baseUrl) {
      options.baseURL = baseUrl;
    }
    this.anthropicClient = new Anthropic(options);
    console.log(`[ReactAgent] Anthropic client created`);
  }

  /**
   * Set LLM configuration
   */
  setLLMConfig(config: { apiKey: string; baseUrl?: string }): void {
    this.createAnthropicClient(config.apiKey, config.baseUrl);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ReActConfig>): void {
    Object.assign(this.config, config);
  }

  // ============================================
  // Main ReAct Loop
  // ============================================

  /**
   * Execute task using ReAct loop
   */
  async execute(goal: string, context: Record<string, unknown> = {}): Promise<{
    success: boolean;
    result?: unknown;
    error?: string;
    actions: ReActAction[];
  }> {
    console.log('[ReactAgent] execute() called with goal:', goal);
    console.log('[ReactAgent] Anthropic client available:', !!this.anthropicClient);
    
    if (this.isRunning) {
      console.log('[ReactAgent] Agent is already running, rejecting');
      return {
        success: false,
        error: 'Agent is already running',
        actions: [],
      };
    }

    this.isRunning = true;
    this.shouldStop = false;

    // Initialize state
    this.state = {
      status: 'observing',
      goal,
      currentObservation: null,
      actionHistory: [],
      iterationCount: 0,
      maxIterations: this.config.maxIterations,
      consecutiveFailures: 0,
      startTime: new Date().toISOString(),
      context,
    };

    this.emitEvent('react_iteration_started', { goal, iteration: 0 });

    try {
      // Main ReAct loop
      while (
        this.state.iterationCount < this.state.maxIterations &&
        this.state.consecutiveFailures < this.config.maxConsecutiveFailures &&
        !this.shouldStop
      ) {
        this.state.iterationCount++;
        this.emitEvent('react_iteration_started', { 
          iteration: this.state.iterationCount,
          goal 
        });

        // 1. OBSERVE
        this.state.status = 'observing';
        const observation = await this.observe();
        this.state.currentObservation = observation;
        this.memoryManager.storeObservation(observation);

        // 2. THINK
        this.state.status = 'thinking';
        const thinkResult = await this.think(goal, observation);
        this.emitEvent('react_thinking', { thought: thinkResult.thought });

        // Check for repeated actions (prevent infinite loop)
        const recentActions = this.state.actionHistory.slice(-3);
        const repeatedAction = recentActions.length >= 2 && 
          recentActions.every(a => a.tool === thinkResult.action);
        
        if (repeatedAction) {
          console.log('[ReactAgent] Detected repeated action, forcing completion');
          // Force completion with current information
          this.state.status = 'complete';
          this.emitEvent('react_completed', {
            success: true,
            message: `基于当前页面信息的分析:\n\n页面: ${observation.title} (${observation.url})\n\n${thinkResult.thought}`,
            iterations: this.state.iterationCount,
          });
          
          return {
            success: true,
            result: thinkResult.thought,
            actions: this.state.actionHistory,
          };
        }

        // Check if task is complete
        if (thinkResult.isComplete) {
          this.state.status = 'complete';
          this.emitEvent('react_completed', {
            success: true,
            message: thinkResult.completionMessage,
            iterations: this.state.iterationCount,
          });
          
          return {
            success: true,
            result: thinkResult.completionMessage,
            actions: this.state.actionHistory,
          };
        }

        // 3. Check if CodeAct should be triggered
        let action: ReActAction;
        
        if (thinkResult.shouldCallCodeAct && this.config.enableCodeAct) {
          // Execute CodeAct
          action = await this.executeCodeAct(thinkResult);
        } else {
          // Check gating rules
          const gatingContext = this.createGatingContext(observation, goal);
          const gatingDecision = this.gatingLogic.shouldTriggerCodeAct(gatingContext);
          
          if (gatingDecision.shouldUseCodeAct && this.config.enableCodeAct) {
            // Gating triggered CodeAct
            this.emitEvent('codeact_triggered', { rules: gatingDecision.triggeredRules });
            action = await this.executeCodeActFromGating(gatingDecision, observation);
          } else {
            // 4. ACT (normal tool execution)
            action = await this.act(thinkResult, observation);
          }
        }

        // Record action
        this.state.actionHistory.push(action);

        // 5. VERIFY
        this.state.status = 'verifying';
        if (action.result?.success) {
          this.state.consecutiveFailures = 0;
          this.emitEvent('react_action_completed', { action });
        } else {
          this.state.consecutiveFailures++;
          this.emitEvent('react_action_failed', { action, error: action.result?.error });
        }
      }

      // Loop ended without completion
      const reason = this.shouldStop
        ? 'Stopped by user'
        : this.state.consecutiveFailures >= this.config.maxConsecutiveFailures
          ? 'Too many consecutive failures'
          : 'Max iterations reached';

      this.state.status = 'error';
      this.emitEvent('react_completed', {
        success: false,
        error: reason,
        iterations: this.state.iterationCount,
      });

      return {
        success: false,
        error: reason,
        actions: this.state.actionHistory,
      };
    } catch (error) {
      this.state!.status = 'error';
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      
      this.emitEvent('react_completed', {
        success: false,
        error: errorMsg,
        iterations: this.state?.iterationCount || 0,
      });

      return {
        success: false,
        error: errorMsg,
        actions: this.state?.actionHistory || [],
      };
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop the agent
   */
  stop(): void {
    this.shouldStop = true;
  }

  /**
   * Check if running
   */
  isExecuting(): boolean {
    return this.isRunning;
  }

  /**
   * Get current state
   */
  getState(): ReActState | null {
    return this.state;
  }

  // ============================================
  // ReAct Steps Implementation
  // ============================================

  /**
   * OBSERVE: Get current page state
   */
  private async observe(): Promise<Observation> {
    const result = await toolRegistry.execute('observe', {
      includeScreenshot: false, // TODO: maybe some scenarios need screenshots?
      includeElements: this.config.enableDomSnapshots,
    });

    if (result.success && result.data) {
      return result.data as Observation;
    }

    // Fallback
    const pageInfo = await toolRegistry.execute('getPageInfo', {});
    const info = pageInfo.data as Record<string, unknown> | undefined;
    
    return {
      timestamp: new Date().toISOString(),
      url: 'unknown',
      title: 'unknown',
      ...info,  // 展开所有 info 信息让 agent 自己分析
      error: result.error,
    };
  }

  /**
   * THINK: Decide what action to take
   */
  private async think(goal: string, observation: Observation): Promise<ReActThinkResult> {
    if (!this.anthropicClient) {
      console.log('[ReactAgent] No Anthropic client, using rule-based thinking');
      // Fallback to rule-based thinking
      return this.ruleBasedThink(goal, observation);
    }

    try {
      const prompt = this.buildThinkPrompt(goal, observation);
      console.log('[ReactAgent] Sending to LLM...');
      console.log('[ReactAgent] Prompt (first 500 chars):', prompt.substring(0, 500));
      
      const response = await this.anthropicClient.messages.create({
        model: this.llmModel,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
        system: this.getThinkSystemPrompt(),
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        console.error('[ReactAgent] Unexpected response type:', content.type);
        throw new Error('Unexpected response type');
      }

      console.log('[ReactAgent] LLM Response:', content.text);
      const result = this.parseThinkResponse(content.text);
      console.log('[ReactAgent] Parsed result:', JSON.stringify(result, null, 2));
      return result;
    } catch (error) {
      console.error('[ReactAgent] Think failed:', error);
      return this.ruleBasedThink(goal, observation);
    }
  }

  /**
   * ACT: Execute the decided action
   */
  private async act(
    thinkResult: ReActThinkResult,
    observation: Observation
  ): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();

    this.state!.status = 'acting';
    this.emitEvent('react_action_started', { 
      tool: thinkResult.action, 
      args: thinkResult.args 
    });

    const action: ReActAction = {
      id: actionId,
      thought: thinkResult.thought,
      tool: thinkResult.action,
      args: thinkResult.args,
      reasoning: thinkResult.reasoning,
      confidence: thinkResult.confidence,
      requiresCodeAct: false,
      timestamp: new Date().toISOString(),
    };

    try {
      const toolResult = await this.executeWithTimeout(
        thinkResult.action,
        thinkResult.args,
        this.config.actionTimeout
      );

      // Get new observation after action
      const newObservation = await this.observe();

      action.result = {
        success: toolResult.success,
        data: toolResult.data,
        error: toolResult.error,
        observation: newObservation,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      action.result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  /**
   * Execute CodeAct based on think result
   */
  private async executeCodeAct(thinkResult: ReActThinkResult): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();

    this.emitEvent('codeact_executing', { task: thinkResult.codeActTask });

    const action: ReActAction = {
      id: actionId,
      thought: thinkResult.thought,
      tool: 'call_code_solver',
      args: { task: thinkResult.codeActTask },
      reasoning: thinkResult.reasoning,
      confidence: thinkResult.confidence,
      requiresCodeAct: true,
      timestamp: new Date().toISOString(),
    };

    try {
      // Get DOM for CodeAct
      const domResult = await toolRegistry.execute('queryDOM', {});
      const html = domResult.success && domResult.data 
        ? (domResult.data as { html: string }).html || ''
        : '';

      // Execute CodeAct
      const codeResult = await codeExecutor.parseDOM(html, thinkResult.codeActTask || thinkResult.thought);

      const newObservation = await this.observe();

      if (codeResult.success) {
        this.emitEvent('codeact_completed', { result: codeResult.result });
        
        action.result = {
          success: true,
          data: codeResult.result,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      } else {
        this.emitEvent('codeact_failed', { error: codeResult.error });
        
        action.result = {
          success: false,
          error: codeResult.error,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      const observation = this.state!.currentObservation || {
        timestamp: new Date().toISOString(),
        url: 'unknown',
        title: 'unknown',
      };

      action.result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  /**
   * Execute CodeAct triggered by gating logic
   */
  private async executeCodeActFromGating(
    gatingDecision: { suggestedTask?: string; triggeredRules: string[] },
    observation: Observation
  ): Promise<ReActAction> {
    const actionId = generateId('action');
    const startTime = Date.now();
    const task = gatingDecision.suggestedTask || 'Process page data';

    this.emitEvent('codeact_executing', { task, triggeredBy: gatingDecision.triggeredRules });

    const action: ReActAction = {
      id: actionId,
      thought: `Gating triggered CodeAct: ${gatingDecision.triggeredRules.join(', ')}`,
      tool: 'call_code_solver',
      args: { task },
      reasoning: `Gating rules triggered: ${gatingDecision.triggeredRules.join(', ')}`,
      confidence: 0.8,
      requiresCodeAct: true,
      timestamp: new Date().toISOString(),
    };

    try {
      // Get DOM snapshot
      const domHtml = observation.domSnapshot || '';
      
      // Execute appropriate CodeAct based on triggered rules
      let codeResult: CodeActResult;
      
      if (gatingDecision.triggeredRules.includes('selector_failures')) {
        // Find element using fuzzy matching
        const elements = observation.visibleElements || [];
        codeResult = await codeExecutor.findElement(elements, this.state!.goal);
      } else {
        // General DOM parsing
        codeResult = await codeExecutor.parseDOM(domHtml, task);
      }

      const newObservation = await this.observe();

      if (codeResult.success) {
        this.emitEvent('codeact_completed', { result: codeResult.result });
        
        action.result = {
          success: true,
          data: codeResult.result,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      } else {
        this.emitEvent('codeact_failed', { error: codeResult.error });
        
        action.result = {
          success: false,
          error: codeResult.error,
          observation: newObservation,
          duration: Date.now() - startTime,
        };
      }
    } catch (error) {
      action.result = {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        observation,
        duration: Date.now() - startTime,
      };
    }

    return action;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Execute tool with timeout
   */
  private async executeWithTimeout(
    toolName: string,
    args: Record<string, unknown>,
    timeout: number
  ): Promise<ToolExecutionResult> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({
          success: false,
          error: `Tool execution timed out after ${timeout}ms`,
          duration: timeout,
        });
      }, timeout);

      toolRegistry.execute(toolName, args)
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: 0,
          });
        });
    });
  }

  /**
   * Create gating context
   */
  private createGatingContext(observation: Observation, goal: string): GatingContext {
    return GatingLogic.createContext(
      observation,
      goal,
      this.state?.goal || goal,
      this.state?.actionHistory || []
    );
  }

  /**
   * Emit agent event
   */
  private emitEvent(type: AgentEventType | string, data: unknown): void {
    const event: AgentEvent = {
      type: type as AgentEventType,
      timestamp: new Date().toISOString(),
      data,
    };
    this.emit('event', event);
    this.emit(type, data);
  }

  // ============================================
  // Prompt Building
  // ============================================

  /**
   * Get system prompt for thinking
   */
  private getThinkSystemPrompt(): string {
    const tools = toolRegistry.getToolDescriptionsForPrompt();
    
    return `你是一个浏览器自动化 ReAct Agent。你通过 观察(Observe) → 思考(Think) → 行动(Act) 的循环来完成用户任务。

## 可用工具

${tools}

## 特殊工具: call_code_solver

当你需要执行以下复杂任务时，可以调用 call_code_solver:
- 解析大量 DOM 结构
- 数据排序、过滤、比较
- 找到最匹配的元素
- 批量数据提取
- 复杂选择器生成

## 输出格式 (JSON)

{
  "thought": "你对当前状态的分析",
  "action": "工具名称 (如果 isComplete=true 则忽略)",
  "args": { "参数名": "参数值" },
  "reasoning": "为什么选择这个行动",
  "confidence": 0.0-1.0,
  "shouldCallCodeAct": false,
  "codeActTask": "如果 shouldCallCodeAct=true，描述要执行的代码任务",
  "isComplete": false,
  "completionMessage": "如果任务完成，说明完成情况"
}

## 重要规则

1. **任务完成判断**:
   - 如果用户是询问/查看类任务（如"页面布局"、"有哪些按钮"、"当前状态"），直接根据已有信息回答，设置 isComplete=true
   - 如果是操作类任务（如"点击"、"输入"、"导航"），执行完成后设置 isComplete=true
   - **不要重复调用 observe**，如果已经有页面信息，直接分析并回答

2. **避免无限循环**:
   - 如果连续2次调用同一个工具但没有进展，考虑换一种方法或报告问题
   - 对于信息查询任务，你已经有足够信息时必须设置 isComplete=true 并在 completionMessage 中回答

3. 每次只执行一个行动
4. 如果需要复杂数据处理，设置 shouldCallCodeAct=true
5. 选择器优先使用: id > data-testid > name > text > class

只输出 JSON，不要包含其他内容。`;
  }

  /**
   * Build think prompt
   */
  private buildThinkPrompt(goal: string, observation: Observation): string {
    let prompt = `## 任务目标
${goal}

## 当前页面状态
- URL: ${observation.url}
- 标题: ${observation.title}
`;

    if (observation.visibleElements && observation.visibleElements.length > 0) {
      prompt += `\n## 可见交互元素 (前20个)\n`;
      observation.visibleElements.slice(0, 20).forEach((el, i) => {
        const text = el.text ? `"${el.text.slice(0, 50)}"` : '';
        prompt += `${i + 1}. [${el.tag}] ${text} → ${el.selector}\n`;
      });
    }

    if (this.state && this.state.actionHistory.length > 0) {
      prompt += `\n## 已执行的行动\n`;
      this.state.actionHistory.slice(-5).forEach((action, i) => {
        const status = action.result?.success ? '✓' : '✗';
        prompt += `${i + 1}. ${status} ${action.tool}(${JSON.stringify(action.args)})`;
        if (action.result?.error) {
          prompt += ` - 错误: ${action.result.error}`;
        }
        prompt += '\n';
      });
    }

    prompt += `\n请决定下一步行动。`;

    return prompt;
  }

  /**
   * Parse think response
   */
  private parseThinkResponse(response: string): ReActThinkResult {
    try {
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

      return {
        thought: parsed.thought || '',
        action: parsed.action || 'observe',
        args: parsed.args || {},
        reasoning: parsed.reasoning || '',
        confidence: parsed.confidence || 0.5,
        shouldCallCodeAct: parsed.shouldCallCodeAct || false,
        codeActTask: parsed.codeActTask,
        isComplete: parsed.isComplete || false,
        completionMessage: parsed.completionMessage,
      };
    } catch (error) {
      console.error('[ReactAgent] Failed to parse think response:', error);
      
      // Fallback
      return {
        thought: 'Failed to parse LLM response',
        action: 'observe',
        args: {},
        reasoning: 'Fallback to observation',
        confidence: 0.3,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }
  }

  /**
   * Rule-based thinking fallback
   */
  private ruleBasedThink(goal: string, _observation: Observation): ReActThinkResult {
    const lowerGoal = goal.toLowerCase();
    
    // Check for navigation
    const urlMatch = goal.match(/https?:\/\/[^\s]+/);
    if (urlMatch || lowerGoal.includes('go to') || lowerGoal.includes('navigate') || lowerGoal.includes('打开')) {
      const url = urlMatch ? urlMatch[0] : this.extractUrlFromGoal(goal);
      if (url) {
        return {
          thought: `Need to navigate to ${url}`,
          action: 'navigate',
          args: { url },
          reasoning: 'Goal contains URL or navigation keywords',
          confidence: 0.9,
          shouldCallCodeAct: false,
          isComplete: false,
        };
      }
    }

    // Check for click
    if (lowerGoal.includes('click') || lowerGoal.includes('点击')) {
      const target = this.extractClickTarget(goal);
      return {
        thought: `Need to click on ${target}`,
        action: 'click',
        args: { selector: target },
        reasoning: 'Goal contains click keywords',
        confidence: 0.8,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }

    // Check for type/input
    if (lowerGoal.includes('type') || lowerGoal.includes('input') || lowerGoal.includes('输入')) {
      const textMatch = goal.match(/["']([^"']+)["']/);
      return {
        thought: `Need to type text`,
        action: 'type',
        args: { 
          selector: 'input, textarea',
          text: textMatch ? textMatch[1] : '',
        },
        reasoning: 'Goal contains typing keywords',
        confidence: 0.7,
        shouldCallCodeAct: false,
        isComplete: false,
      };
    }

    // Default: observe
    return {
      thought: 'Need more information about the page',
      action: 'observe',
      args: { includeElements: true },
      reasoning: 'Default to observation',
      confidence: 0.5,
      shouldCallCodeAct: false,
      isComplete: false,
    };
  }

  /**
   * Extract URL from goal
   */
  private extractUrlFromGoal(goal: string): string | null {
    const domainMatch = goal.match(/(?:go to|navigate to|open|visit|打开)\s+([a-zA-Z0-9][a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
    if (domainMatch) {
      return `https://${domainMatch[1]}`;
    }
    return null;
  }

  /**
   * Extract click target from goal
   */
  private extractClickTarget(goal: string): string {
    const patterns = [
      /click (?:on )?["']([^"']+)["']/i,
      /click (?:on )?the\s+([^\s.!?]+)/i,
      /点击["']?([^"']+)["']?/,
      /click\s+([^\s.!?]+)/i,
    ];

    for (const pattern of patterns) {
      const match = goal.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return 'button';
  }
}

// Export factory function
export function createReactAgent(
  memoryManager: MemoryManager,
  config?: ReactAgentConfig
): ReactAgent {
  return new ReactAgent(memoryManager, config);
}

