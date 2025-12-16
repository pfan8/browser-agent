/**
 * Think Node
 * 
 * Uses LLM to reason about the current observation and decide on the next action.
 * Implements:
 * - RA-02: LLM-based thinking
 * - RA-06: Loop detection via action signature tracking
 * - RA-08: Rule-based fallback when LLM unavailable
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { AgentState, AgentAction } from '../state';
import { generateId, isRepeatedAction, updateActionSignature } from '../state';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { loadLLMConfig, type LLMConfig } from '../config';

/**
 * Configuration for the think node
 * Can be partial - missing values will be loaded from config file or defaults
 */
export interface ThinkNodeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  // Additional LLM parameters (optional)
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
}

/**
 * Parsed action from LLM response
 */
interface ParsedAction {
  tool: string;
  args: Record<string, unknown>;
  thought: string;
  reasoning: string;
  isComplete: boolean;
  completionMessage?: string;
}

/**
 * Rule patterns for RA-08 fallback
 */
interface RulePattern {
  patterns: RegExp[];
  tool: string;
  extractArgs: (goal: string, match: RegExpMatchArray) => Record<string, unknown>;
}

/**
 * Rule-based patterns for common commands (RA-08)
 */
const RULE_PATTERNS: RulePattern[] = [
  // Navigation rules
  {
    patterns: [
      /(?:navigate|go|open|打开|访问|导航)\s*(?:to)?\s*(?:the\s*)?(?:url\s*)?[:\s]*["']?([^\s"']+)["']?/i,
      /(?:navigate|go|open)\s+([^\s]+)/i,
    ],
    tool: 'navigate',
    extractArgs: (_, match) => ({ url: match[1] }),
  },
  // Click rules
  {
    patterns: [
      /(?:click|点击|按)\s*(?:on|the)?\s*["']?([^"']+)["']?/i,
      /click\s+(.+)/i,
    ],
    tool: 'click',
    extractArgs: (_, match) => ({ selector: match[1].trim() }),
  },
  // Type rules - Pattern 1: "type X in Y" (text first, then selector)
  {
    patterns: [
      /(?:type|input|输入|填写)\s*["']?([^"']+)["']?\s*(?:in|into|to|到)\s*["']?([^"']+)["']?/i,
    ],
    tool: 'type',
    extractArgs: (_, match) => {
      // Pattern: "type TEXT in SELECTOR" → match[1]=text, match[2]=selector
      const text = match[1];
      const selector = match[2];
      return { selector: selector.trim(), text: text.trim() };
    },
  },
  // Type rules - Pattern 2: "在Y输入X" (selector first, then text)
  {
    patterns: [
      /(?:在|在.*中|into)\s*["']?([^"']+)["']?\s*(?:输入|type)\s*["']?([^"']+)["']?/i,
    ],
    tool: 'type',
    extractArgs: (_, match) => {
      // Pattern: "在SELECTOR输入TEXT" → match[1]=selector, match[2]=text
      const selector = match[1];
      const text = match[2];
      return { selector: selector.trim(), text: text.trim() };
    },
  },
  // Press key rules
  {
    patterns: [
      /(?:press|按下|按键)\s*(?:the\s*)?["']?(\w+)["']?(?:\s*key)?/i,
    ],
    tool: 'press',
    extractArgs: (_, match) => ({ key: match[1] }),
  },
  // Wait rules - milliseconds (default)
  {
    patterns: [
      /(?:wait|等待)\s*(?:for)?\s*(\d+)\s*(?:ms|milliseconds|毫秒)/i,
    ],
    tool: 'wait',
    extractArgs: (_, match) => {
      const ms = parseInt(match[1], 10);
      return { ms };
    },
  },
  // Wait rules - seconds (explicit conversion)
  {
    patterns: [
      /(?:wait|等待)\s*(?:for)?\s*(\d+)\s*(?:s|seconds|秒)/i,
    ],
    tool: 'wait',
    extractArgs: (_, match) => {
      // Convert seconds to milliseconds
      const ms = parseInt(match[1], 10) * 1000;
      return { ms };
    },
  },
  // Wait rules - bare number defaults to milliseconds
  {
    patterns: [
      /(?:wait|等待)\s*(?:for)?\s*(\d+)$/i,
    ],
    tool: 'wait',
    extractArgs: (_, match) => {
      const ms = parseInt(match[1], 10);
      return { ms };
    },
  },
  // Screenshot rules
  {
    patterns: [
      /(?:screenshot|截图|capture|截屏)/i,
    ],
    tool: 'screenshot',
    extractArgs: () => ({}),
  },
];

/**
 * Patterns that indicate a chat/greeting message, not a browser task
 */
const CHAT_PATTERNS: RegExp[] = [
  // Greetings
  /^(你好|您好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好|good\s*(morning|afternoon|evening))[\s!！。.?？]*$/i,
  // Questions about the agent
  /^(你是谁|who are you|what are you|你能做什么|what can you do|help|帮助)[\s!！。.?？]*$/i,
  // Thanks
  /^(谢谢|thanks|thank you|thx|感谢)[\s!！。.?？]*$/i,
  // Goodbye
  /^(再见|拜拜|bye|goodbye|see you)[\s!！。.?？]*$/i,
  // Simple acknowledgments
  /^(好的|ok|okay|好|嗯|是的|yes|no|不|对|没问题)[\s!！。.?？]*$/i,
  // Very short messages (likely not browser commands)
  /^.{1,5}$/,
];

/**
 * Check if the goal is a chat message rather than a browser task
 */
function isChatMessage(goal: string): boolean {
  const normalized = goal.trim();
  return CHAT_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Generate a friendly chat response based on the message type
 */
function getChatResponse(goal: string): string {
  const normalized = goal.trim().toLowerCase();
  
  if (/^(你好|您好|hi|hello|hey|嗨|哈喽)/i.test(normalized)) {
    return '你好！我是浏览器自动化助手。请告诉我你想要执行的浏览器操作，例如：\n- "打开 https://google.com"\n- "点击搜索按钮"\n- "在输入框输入 hello"';
  }
  if (/^(早上好|good\s*morning)/i.test(normalized)) {
    return '早上好！有什么我可以帮你的浏览器操作吗？';
  }
  if (/^(下午好|good\s*afternoon)/i.test(normalized)) {
    return '下午好！需要我帮你执行什么浏览器操作？';
  }
  if (/^(晚上好|good\s*evening)/i.test(normalized)) {
    return '晚上好！请告诉我你想要执行的操作。';
  }
  if (/^(你是谁|who are you|what are you)/i.test(normalized)) {
    return '我是浏览器自动化助手，可以帮你控制浏览器执行各种操作，如导航、点击、输入文字等。';
  }
  if (/^(你能做什么|what can you do|help|帮助)/i.test(normalized)) {
    return '我可以帮你：\n- 导航到网址 (例如: "打开 google.com")\n- 点击元素 (例如: "点击登录按钮")\n- 输入文字 (例如: "在搜索框输入 hello")\n- 截图 (例如: "截图")\n- 等待 (例如: "等待 2 秒")';
  }
  if (/^(谢谢|thanks|thank you)/i.test(normalized)) {
    return '不客气！还有什么需要帮忙的吗？';
  }
  if (/^(再见|拜拜|bye|goodbye)/i.test(normalized)) {
    return '再见！随时可以找我帮忙。';
  }
  
  return `收到消息: "${goal}"。如果你想执行浏览器操作，请告诉我具体的任务。`;
}

/**
 * Apply rule-based thinking as fallback (RA-08)
 */
function applyRuleBasedThinking(goal: string): ParsedAction | null {
  const normalizedGoal = goal.trim().toLowerCase();
  
  // First, check if this is a chat/greeting message (not a browser task)
  if (isChatMessage(goal)) {
    const response = getChatResponse(goal);
    return {
      tool: '',
      args: {},
      thought: 'This is a chat message, not a browser operation request',
      reasoning: 'Detected greeting or chat pattern',
      isComplete: true,
      completionMessage: response,
    };
  }
  
  // Check browser operation patterns
  for (const rule of RULE_PATTERNS) {
    for (const pattern of rule.patterns) {
      const match = goal.match(pattern);
      if (match) {
        const args = rule.extractArgs(goal, match);
        return {
          tool: rule.tool,
          args,
          thought: `[Rule-based] Matched pattern for ${rule.tool}`,
          reasoning: `Applied rule pattern: ${pattern.source}`,
          isComplete: false,
        };
      }
    }
  }
  
  // Check for completion keywords
  if (/(?:done|complete|finished|完成|结束)/i.test(normalizedGoal)) {
    return {
      tool: '',
      args: {},
      thought: 'Task appears to be complete',
      reasoning: 'Detected completion keyword',
      isComplete: true,
      completionMessage: 'Task completed based on user input',
    };
  }
  
  return null;
}

/**
 * Creates a think node that uses LLM to decide actions (RA-02, RA-06, RA-08)
 */
export function createThinkNode(config: ThinkNodeConfig, tools: StructuredToolInterface[]) {
  // Load full config from file, env, and runtime overrides
  const llmConfig = loadLLMConfig({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
    maxTokens: config.maxTokens,
  });
  
  // Check if LLM is configured (apiKey from config file, env, or runtime)
  const hasLlm = !!llmConfig.apiKey;
  
  let llm: ChatAnthropic | null = null;
  if (hasLlm) {
    console.log(`[ThinkNode] Initializing LLM: model=${llmConfig.model}, baseUrl=${llmConfig.baseUrl || 'default'}`);
    
    // Build LLM options, only including defined values
    const llmOptions: Record<string, unknown> = {
      anthropicApiKey: llmConfig.apiKey,
      modelName: llmConfig.model,
    };

    // Optional parameters
    if (llmConfig.temperature !== undefined) {
      llmOptions.temperature = llmConfig.temperature;
    }
    if (llmConfig.topP !== undefined) {
      llmOptions.topP = llmConfig.topP;
    }
    if (llmConfig.baseUrl) {
      llmOptions.anthropicApiUrl = llmConfig.baseUrl;
    }
    if (llmConfig.topK !== undefined) {
      llmOptions.topK = llmConfig.topK;
    }
    if (llmConfig.maxTokens !== undefined) {
      llmOptions.maxOutputTokens = llmConfig.maxTokens;
    }

    console.log('[ThinkNode] LLM options:', llmOptions);
    
    llm = new ChatAnthropic(llmOptions);
  }

  // Build tool descriptions for the system prompt
  const toolDescriptions = tools.map(tool => {
    return `- ${tool.name}: ${tool.description}`;
  }).join('\n');

  const systemPrompt = `You are a browser automation agent. Your task is to help users accomplish tasks in a web browser.

You have access to the following tools:
${toolDescriptions}

Based on the current observation (page URL, title, and content), decide what action to take next.

IMPORTANT RULES:
1. Always respond with a valid JSON object
2. Think step by step about what needs to be done
3. If the task is complete, set "isComplete" to true and provide a "completionMessage"
4. Use the most appropriate tool for each action
5. Be precise with selectors - prefer data-testid, id, or aria-label over text content
6. **CRITICAL**: If the user's message is a greeting (e.g., "你好", "hi", "hello") or a chat message 
   that does NOT require browser operations, respond with isComplete=true and a friendly reply.
   Do NOT try to navigate or perform browser actions for simple greetings/chat.
7. Only perform browser operations when the user explicitly requests actions like:
   - Navigation: "打开", "open", "go to", "navigate"
   - Clicking: "点击", "click"
   - Typing: "输入", "type", "fill"
   - etc.

Response format for BROWSER OPERATIONS:
{
  "thought": "Your reasoning about the current state",
  "tool": "tool_name",
  "args": { "arg1": "value1" },
  "reasoning": "Why you chose this action",
  "isComplete": false
}

Response format for COMPLETED TASKS or CHAT MESSAGES:
{
  "thought": "The task has been completed / This is a greeting",
  "isComplete": true,
  "completionMessage": "Summary or friendly reply"
}`;

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log('[ThinkNode] Reasoning about next action...');
    
    try {
      // Build context from observation
      const observation = state.observation;
      if (!observation) {
        return {
          status: 'error',
          error: 'No observation available',
        };
      }

      let parsed: ParsedAction;
      let responseText = '';

      // RA-08: Try rule-based fallback first if LLM not available or flagged
      if (!hasLlm || state.useFallbackRules) {
        console.log('[ThinkNode] Using rule-based fallback (RA-08)');
        const ruleParsed = applyRuleBasedThinking(state.goal);
        
        if (ruleParsed) {
          parsed = ruleParsed;
          responseText = JSON.stringify(ruleParsed);
        } else {
          // No matching rule, cannot proceed
          return {
            status: 'error',
            error: 'No matching rule found and LLM not available',
            useFallbackRules: true,
          };
        }
      } else {
        // RA-02: Use LLM for thinking
        try {
      // Build the user message with current context
      const userMessage = `
Goal: ${state.goal}
${state.originalGoal !== state.goal ? `Original Goal: ${state.originalGoal}` : ''}

Current Page:
- URL: ${observation.url}
- Title: ${observation.title}
- Load State: ${observation.loadState || 'unknown'}
${observation.hasModalOverlay ? '- WARNING: Modal overlay detected' : ''}
${observation.hasLoadingIndicator ? '- WARNING: Page is still loading' : ''}

Page Content (truncated):
${observation.content?.slice(0, 5000) || 'No content available'}

Previous Actions (last 5):
${state.actionHistory.slice(-5).map(a => `- ${a.tool}(${JSON.stringify(a.args)}) -> ${a.result?.success ? 'success' : 'failed: ' + a.result?.error}`).join('\n') || 'None'}

Completed Steps: ${state.completedSteps.length}
Iteration: ${state.iterationCount}

What should be the next action? Respond with a valid JSON object.`;

      // Call LLM
      const messages = [
        new SystemMessage(systemPrompt),
        ...state.messages,
        new HumanMessage(userMessage),
      ];

          const response = await llm!.invoke(messages);
          responseText = typeof response.content === 'string' 
        ? response.content 
        : JSON.stringify(response.content);

      console.log('[ThinkNode] LLM response:', responseText.slice(0, 200));

      // Parse the response
          const parseResult = parseThinkResponse(responseText);
          
          // Handle parsing failure
          if (!parseResult.parsed) {
            console.error('[ThinkNode] Parse error:', parseResult.error);
            
            // Count consecutive parse failures
            const parseFailures = (state.consecutiveFailures || 0) + 1;
            
            // If we've failed to parse multiple times, give up with a friendly error
            if (parseFailures >= 2) {
              return {
                status: 'error',
                error: parseResult.error,
                isComplete: true,
                result: `❌ 任务执行失败\n\n📋 失败原因: AI 响应格式解析多次失败\n\n💡 建议: 请尝试用更简单明确的语言描述任务，例如:\n  - "打开 google.com"\n  - "点击登录按钮"\n  - "在搜索框输入 hello"\n\n📝 AI 部分响应: ${parseResult.partialContent || 'N/A'}`,
                consecutiveFailures: parseFailures,
              };
            }
            
            // Try rule-based fallback
            const ruleParsed = applyRuleBasedThinking(state.goal);
            if (ruleParsed) {
              parsed = ruleParsed;
            } else {
              return {
                status: 'observing', // Go back to observe and try again
                consecutiveFailures: parseFailures,
              };
            }
          } else {
            parsed = parseResult.parsed;
          }
        } catch (llmError) {
          // RA-08: Fall back to rules on LLM error
          console.warn('[ThinkNode] LLM error, falling back to rules:', llmError);
          const ruleParsed = applyRuleBasedThinking(state.goal);
          
          if (ruleParsed) {
            parsed = ruleParsed;
            responseText = JSON.stringify(ruleParsed);
          } else {
            return {
              status: 'error',
              error: `LLM failed: ${llmError instanceof Error ? llmError.message : llmError}`,
              isComplete: true,
              result: `❌ 任务执行失败\n\n📋 失败原因: AI 服务调用失败\n\n💡 建议: 请检查网络连接和 API 配置，或稍后重试`,
              useFallbackRules: true,
              consecutiveFailures: state.consecutiveFailures + 1,
            };
          }
        }
      }

      if (parsed.isComplete) {
        console.log('[ThinkNode] Task complete:', parsed.completionMessage);
        return {
          status: 'complete',
          isComplete: true,
          result: parsed.completionMessage || '✅ 任务完成',
          messages: hasLlm ? [...state.messages, new AIMessage(responseText)] : state.messages,
        };
      }

      // RA-06: Check for repeated action (loop detection)
      if (isRepeatedAction(state.actionSignatures, parsed.tool, parsed.args, 3)) {
        console.warn('[ThinkNode] RA-06: Repeated action detected, possible loop');
        return {
          status: 'error',
          error: 'Detected repeated action loop - same action attempted 3+ times',
          loopDetected: true,
          isComplete: true,
          result: 'Task terminated due to detected infinite loop',
        };
      }

      // Update action signatures for loop tracking
      const newSignatures = updateActionSignature(
        state.actionSignatures,
        parsed.tool,
        parsed.args
      );

      // Create action record
      const action: AgentAction = {
        id: generateId('action'),
        tool: parsed.tool,
        args: parsed.args,
        thought: parsed.thought,
        reasoning: parsed.reasoning,
        timestamp: new Date().toISOString(),
        retryCount: 0,
        maxRetries: 3,
      };

      console.log(`[ThinkNode] Decided action: ${action.tool}(${JSON.stringify(action.args)})`);

      return {
        status: 'thinking',
        actionHistory: [action],
        actionSignatures: newSignatures,
        messages: hasLlm ? [...state.messages, new AIMessage(responseText)] : state.messages,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ThinkNode] Error:', errorMessage);
      
      return {
        status: 'error',
        error: `Think failed: ${errorMessage}`,
        consecutiveFailures: state.consecutiveFailures + 1,
      };
    }
  };
}

/**
 * Result type for parsing - includes error info
 */
interface ParseResult {
  parsed: ParsedAction | null;
  error: string | null;
  partialContent: string | null;
}

/**
 * Parse the LLM response into a structured action
 * Returns error info if parsing fails
 */
function parseThinkResponse(response: string): ParseResult {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Maybe the LLM responded with natural language instead of JSON
      // Try to detect if it's a completion message
      if (response.includes('complete') || response.includes('完成') || 
          response.includes('done') || response.includes('finished')) {
        return {
          parsed: {
            tool: '',
            args: {},
            thought: response,
            reasoning: 'LLM indicated task completion',
            isComplete: true,
            completionMessage: response.slice(0, 500),
          },
          error: null,
          partialContent: null,
        };
      }
      
      return {
        parsed: null,
        error: 'No JSON found in response',
        partialContent: response.slice(0, 200),
      };
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      parsed: {
      tool: parsed.tool || '',
      args: parsed.args || {},
      thought: parsed.thought || '',
      reasoning: parsed.reasoning || '',
      isComplete: parsed.isComplete === true,
      completionMessage: parsed.completionMessage,
      },
      error: null,
      partialContent: null,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown parse error';
    console.error('[ThinkNode] Failed to parse response:', error);
    
    // Try to extract partial info from truncated response
    const thoughtMatch = response.match(/"thought"\s*:\s*"([^"]+)/);
    const partialThought = thoughtMatch ? thoughtMatch[1] : null;
    
    return {
      parsed: null,
      error: `JSON parsing error: ${errorMsg}`,
      partialContent: partialThought || response.slice(0, 200),
    };
  }
}

