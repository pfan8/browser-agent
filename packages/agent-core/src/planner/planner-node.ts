/**
 * Planner Node
 * 
 * LangGraph node that handles high-level task planning.
 * The Planner does NOT know Playwright API - it only describes what to do.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import type { AgentState } from '../state';
import { loadLLMConfig } from '../config';
import { createAgentLogger, startTimer } from '../tracing';
import { PLANNER_SYSTEM_PROMPT, buildPlannerUserMessage, CHAT_RESPONSES } from './prompts';
import type { PlannerDecision, PlannerHistoryEntry } from './types';
import { summarizeActionResult, summarizeHistoryResult, formatFullDataAsMarkdown } from './summarize';

const log = createAgentLogger('PlannerNode');

/**
 * Configuration for the planner node
 */
export interface PlannerNodeConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Check if goal is a chat message (greeting, etc.)
 */
function isChatMessage(goal: string): boolean {
  const patterns = [
    /^(你好|您好|hi|hello|hey|嗨|哈喽|早上好|下午好|晚上好|good\s*(morning|afternoon|evening))[\s!！。.?？]*$/i,
    /^(你是谁|who are you|what are you|你能做什么|what can you do|help|帮助)[\s!！。.?？]*$/i,
    /^(谢谢|thanks|thank you|thx|感谢)[\s!！。.?？]*$/i,
    /^(再见|拜拜|bye|goodbye|see you)[\s!！。.?？]*$/i,
    /^.{1,5}$/,
  ];
  return patterns.some(p => p.test(goal.trim()));
}

/**
 * Get chat response for greeting/chat messages
 */
function getChatResponse(goal: string): string {
  const normalized = goal.trim().toLowerCase();
  
  if (/^(你好|您好|hi|hello|hey|嗨|哈喽)/i.test(normalized)) {
    return CHAT_RESPONSES.greeting;
  }
  if (/^(早上好|good\s*morning)/i.test(normalized)) {
    return CHAT_RESPONSES.morning;
  }
  if (/^(下午好|good\s*afternoon)/i.test(normalized)) {
    return CHAT_RESPONSES.afternoon;
  }
  if (/^(晚上好|good\s*evening)/i.test(normalized)) {
    return CHAT_RESPONSES.evening;
  }
  if (/^(你是谁|who are you|what are you)/i.test(normalized)) {
    return CHAT_RESPONSES.whoAreYou;
  }
  if (/^(你能做什么|what can you do|help|帮助)/i.test(normalized)) {
    return CHAT_RESPONSES.help;
  }
  if (/^(谢谢|thanks|thank you)/i.test(normalized)) {
    return CHAT_RESPONSES.thanks;
  }
  if (/^(再见|拜拜|bye|goodbye)/i.test(normalized)) {
    return CHAT_RESPONSES.goodbye;
  }
  
  return `收到消息: "${goal}"。如果你想执行浏览器操作，请告诉我具体的任务。`;
}

/**
 * Parse LLM response to PlannerDecision
 */
function parsePlannerResponse(response: string): PlannerDecision | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Check if it's a completion message
      if (response.includes('complete') || response.includes('完成')) {
        return {
          thought: response,
          nextStep: null,
          isComplete: true,
          completionMessage: response.slice(0, 500),
        };
      }
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      thought: parsed.thought || '',
      nextStep: parsed.nextStep || null,
      isComplete: parsed.isComplete === true,
      completionMessage: parsed.completionMessage,
      needsMoreInfo: parsed.needsMoreInfo,
      question: parsed.question,
    };
  } catch {
    return null;
  }
}

/**
 * Create the Planner Node
 */
export function createPlannerNode(config: PlannerNodeConfig) {
  const llmConfig = loadLLMConfig({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
  });

  const hasLlm = !!llmConfig.apiKey;
  let llm: ChatAnthropic | null = null;

  if (hasLlm) {
    log.info('Initializing Planner LLM', { model: llmConfig.model });
    
    const llmOptions: Record<string, unknown> = {
      anthropicApiKey: llmConfig.apiKey,
      modelName: llmConfig.model,
    };

    if (llmConfig.temperature !== undefined) {
      llmOptions.temperature = llmConfig.temperature;
    }
    if (llmConfig.baseUrl) {
      llmOptions.anthropicApiUrl = llmConfig.baseUrl;
    }
    if (llmConfig.maxTokens !== undefined) {
      llmOptions.maxOutputTokens = llmConfig.maxTokens;
    }

    llm = new ChatAnthropic(llmOptions);
  }

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const traceContext = state.traceContext;
    const timer = startTimer(log, 'planner', traceContext ?? undefined);

    log.debugWithTrace(traceContext!, 'Planning next step', {
      goal: state.goal.substring(0, 50),
      iteration: state.iterationCount,
    });

    try {
      // Handle chat messages without LLM
      if (isChatMessage(state.goal)) {
        const response = getChatResponse(state.goal);
        timer.end('Chat response');
        return {
          status: 'complete',
          isComplete: true,
          result: response,
        };
      }

      if (!hasLlm) {
        return {
          status: 'error',
          error: 'LLM not configured',
          isComplete: true,
          result: '❌ AI 未配置，请在设置中配置 API Key',
        };
      }

      // Build history from action history with smart summarization
      const history: PlannerHistoryEntry[] = state.actionHistory.map(a => ({
        step: a.thought || a.tool,
        result: a.result?.success 
          ? (a.result.data ? summarizeHistoryResult(a.result.data) : '成功')
          : (a.result?.error || '未知错误'),
        success: a.result?.success ?? false,
      }));

      // Get last action result with smart summarization
      const lastAction = state.actionHistory[state.actionHistory.length - 1];
      const lastActionResult = lastAction?.result ? {
        step: lastAction.thought || lastAction.tool,
        success: lastAction.result.success,
        message: lastAction.result.success 
          ? (lastAction.result.data ? summarizeActionResult(lastAction.result.data) : '操作成功')
          : (lastAction.result.error || '操作失败'),
      } : undefined;

      // Build user message
      const userMessage = buildPlannerUserMessage({
        goal: state.goal,
        observation: {
          url: state.observation?.url || 'unknown',
          title: state.observation?.title || 'unknown',
          summary: state.observation?.content?.slice(0, 500),
        },
        lastActionResult,
        history,
        iterationCount: state.iterationCount,
      });

      // Log detailed planner context for tracing
      log.infoWithTrace(traceContext!, '[PLANNER] Input context', {
        goal: state.goal,
        iteration: state.iterationCount,
        observationUrl: state.observation?.url || 'unknown',
        observationTitle: state.observation?.title || 'unknown',
        historyCount: history.length,
        lastActionSuccess: lastActionResult?.success,
        lastActionStep: lastActionResult?.step,
        messageLength: userMessage.length,
      });
      
      // Log full user message at debug level
      log.debugWithTrace(traceContext!, '[PLANNER] Full user message', {
        userMessage,
      });

      // Call LLM
      const messages = [
        new SystemMessage(PLANNER_SYSTEM_PROMPT),
        ...state.messages,
        new HumanMessage(userMessage),
      ];

      const llmStartTime = Date.now();
      const response = await llm!.invoke(messages);
      const llmDuration = Date.now() - llmStartTime;
      
      const responseText = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      // Log planner response for tracing
      log.infoWithTrace(traceContext!, '[PLANNER] LLM response', {
        responseLength: responseText.length,
        duration: llmDuration,
        responsePreview: responseText.slice(0, 300) + (responseText.length > 300 ? '...' : ''),
      });

      // Parse response
      const decision = parsePlannerResponse(responseText);

      if (!decision) {
        log.errorWithTrace(traceContext!, '[PLANNER] Failed to parse response', {
          responseText: responseText.slice(0, 500),
        });
        return {
          status: 'error',
          error: 'Failed to parse planner response',
          consecutiveFailures: state.consecutiveFailures + 1,
        };
      }

      // Log parsed decision
      log.infoWithTrace(traceContext!, '[PLANNER] Decision parsed', {
        isComplete: decision.isComplete,
        needsMoreInfo: decision.needsMoreInfo,
        nextStep: decision.nextStep?.slice(0, 100),
        thought: decision.thought?.slice(0, 100),
      });

      // Handle completion
      if (decision.isComplete) {
        // Get last action's full data for complete result
        const lastAction = state.actionHistory[state.actionHistory.length - 1];
        const fullData = lastAction?.result?.data;
        const fullDataMarkdown = formatFullDataAsMarkdown(fullData);
        
        // Combine completion message with full data if available
        let finalResult = decision.completionMessage || '✅ 任务完成';
        if (fullDataMarkdown) {
          finalResult += fullDataMarkdown;
        }

        log.infoWithTrace(traceContext!, '[PLANNER] Task marked complete', {
          completionMessage: decision.completionMessage?.slice(0, 200),
          hasFullData: !!fullDataMarkdown,
        });
        timer.end('Task complete');
        return {
          status: 'complete',
          isComplete: true,
          result: finalResult,
          messages: [...state.messages, new AIMessage(responseText)],
        };
      }

      // Handle needs more info
      if (decision.needsMoreInfo) {
        log.infoWithTrace(traceContext!, '[PLANNER] Needs more info', {
          question: decision.question,
        });
        timer.end('Needs clarification');
        return {
          status: 'complete',
          isComplete: true,
          result: `❓ ${decision.question || '请提供更多信息'}`,
          messages: [...state.messages, new AIMessage(responseText)],
        };
      }

      // Return next step for CodeAct to execute
      log.infoWithTrace(traceContext!, '[PLANNER] Output to CodeAct', {
        nextInstruction: decision.nextStep,
        thought: decision.thought?.slice(0, 150),
      });
      timer.end('Next step decided');
      return {
        status: 'planning',
        // Store the next step instruction for CodeAct
        currentInstruction: decision.nextStep,
        plannerThought: decision.thought,
        messages: [...state.messages, new AIMessage(responseText)],
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log.errorWithTrace(traceContext!, 'Planner failed', { error: errorMessage });
      
      return {
        status: 'error',
        error: `Planner failed: ${errorMessage}`,
        consecutiveFailures: state.consecutiveFailures + 1,
      };
    }
  };
}

