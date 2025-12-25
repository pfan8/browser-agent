/**
 * Planner Prompts
 * 
 * Prompts for the Main Agent (Planner) which does NOT know Playwright API.
 * The Planner only describes what to do in natural language.
 */

/**
 * System prompt for the Planner
 * 
 * Simple architecture: Planner ↔ CodeAct loop
 * - Planner gives instructions in natural language
 * - CodeAct executes and returns results
 * - Planner decides next step based on results
 */
export const PLANNER_SYSTEM_PROMPT = `You plan browser automation tasks. Describe actions in natural language - an Executor will run them and return results.

## Terminology
"页面" (pages) = browser tabs, NOT website navigation pages.

## Available Actions
Navigate, Click, Type, Press key, Wait, Scroll, Screenshot, Switch tab, List tabs, Get page info

## Response (JSON)
Continue: {"thought": "analysis of last result and reasoning", "nextStep": "action description", "isComplete": false}
Complete: {"thought": "task completed because...", "isComplete": true, "completionMessage": "summary of what was done"}
Clarify: {"thought": "need more info because...", "needsMoreInfo": true, "question": "specific question"}

## Rules
1. Check last action result before deciding next step
2. If action failed, try alternative approach
3. Mark complete when goal is fully achieved
4. Be specific in action descriptions (include selectors, text, URLs when known)

## Page Analysis (IMPORTANT)
- ALWAYS use DOM to analyze page content and extract information
- DO NOT use screenshot/snapshot to analyze pages - use DOM APIs like getPageInfo, querySelector, getText, etc.
- Screenshot should ONLY be taken when user explicitly requests to save or capture a screenshot
- For understanding page structure, finding elements, or extracting data, rely on DOM inspection, NOT visual screenshots`;

/**
 * Memory context for prompt injection
 */
export interface PlannerMemoryContext {
  contextSummary?: string;
  relevantFacts?: string[];
  recentTasks?: string[];
}

/**
 * Build user message for the Planner (Simplified)
 * 
 * Only includes essential information:
 * - Task (goal)
 * - Last action result (success/error)
 * 
 * Other context (memory, history, page info) is handled by ContextManager
 * and placed in separate system messages (L1) or conversation history (L3).
 */
export function buildPlannerUserMessage(params: {
  goal: string;
  lastActionResult?: {
    step: string;
    success: boolean;
    error?: string;
  };
}): string {
  const { goal, lastActionResult } = params;

  let message = `## Task\n${goal}`;

  if (lastActionResult) {
    const icon = lastActionResult.success ? '✓' : '✗';
    message += `\n\n## Last Action\n${icon} ${lastActionResult.step}`;
    
    if (!lastActionResult.success && lastActionResult.error) {
      message += `\nError: ${lastActionResult.error}`;
    }
  }

  message += '\n\nRespond with JSON.';

  return message;
}

/**
 * Build user message for the Planner (Legacy - with full context)
 * 
 * @deprecated Use buildPlannerUserMessage with ContextManager instead
 */
export function buildPlannerUserMessageLegacy(params: {
  goal: string;
  observation: {
    url: string;
    title: string;
    summary?: string;
  };
  lastActionResult?: {
    step: string;
    success: boolean;
    data?: unknown;
    error?: string;
  };
  history: Array<{
    step: string;
    success: boolean;
  }>;
  iterationCount: number;
  memoryContext?: PlannerMemoryContext;
}): string {
  const { goal, observation, lastActionResult, history, iterationCount, memoryContext } = params;

  let message = `## Task
${goal}

## Current Page
- URL: ${observation.url}
- Title: ${observation.title}
`;

  if (memoryContext && iterationCount === 0) {
    if (memoryContext.contextSummary) {
      message += `
## Memory Context
${memoryContext.contextSummary}
`;
    } else if (memoryContext.relevantFacts && memoryContext.relevantFacts.length > 0) {
      message += `
## Relevant Memory
${memoryContext.relevantFacts.slice(0, 3).map(f => `- ${f}`).join('\n')}
`;
    }
  }

  message += `
## Last Result
`;

  if (lastActionResult) {
    const icon = lastActionResult.success ? '✓' : '✗';
    message += `[${icon}] ${lastActionResult.step}
`;
    
    if (lastActionResult.success && lastActionResult.data !== undefined) {
      const dataJson = formatDataForPlanner(lastActionResult.data);
      message += `Data: ${dataJson}
`;
    } else if (!lastActionResult.success && lastActionResult.error) {
      message += `Error: ${lastActionResult.error}
`;
    }
  } else {
    message += `(First action)
`;
  }

  if (history.length > 0) {
    message += `
## History (${history.length} steps)
`;
    const recentHistory = history.slice(-3);
    recentHistory.forEach((h, i) => {
      const icon = h.success ? '✓' : '✗';
      message += `${history.length - recentHistory.length + i + 1}. [${icon}] ${h.step}
`;
    });
  }

  message += `
Iteration: ${iterationCount}. Respond with JSON.`;

  return message;
}

/**
 * Format data for Planner context
 * Returns compact JSON, truncated if too long
 */
function formatDataForPlanner(data: unknown, maxLength = 1500): string {
  if (data === null || data === undefined) {
    return 'null';
  }
  
  try {
    // Handle nested { success: true, data: {...} } structure from CodeAct
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      // If data has nested 'data' field, extract it
      if ('data' in obj && typeof obj.data === 'object' && obj.data !== null) {
        data = obj.data;
      }
    }
    
    const json = JSON.stringify(data);
    if (json.length <= maxLength) {
      return json;
    }
    // Truncate with indicator
    return json.slice(0, maxLength - 20) + '... (truncated)';
  } catch {
    return String(data).slice(0, maxLength);
  }
}

/**
 * Greeting responses for chat messages
 */
export const CHAT_RESPONSES: Record<string, string> = {
  greeting: '你好！我是浏览器自动化助手。请告诉我你想要执行的浏览器操作，例如：\n- "打开 https://google.com"\n- "点击搜索按钮"\n- "在输入框输入 hello"',
  morning: '早上好！有什么我可以帮你的浏览器操作吗？',
  afternoon: '下午好！需要我帮你执行什么浏览器操作？',
  evening: '晚上好！请告诉我你想要执行的操作。',
  whoAreYou: '我是浏览器自动化助手，可以帮你控制浏览器执行各种操作，如导航、点击、输入文字等。',
  help: '我可以帮你：\n- 导航到网址 (例如: "打开 google.com")\n- 点击元素 (例如: "点击登录按钮")\n- 输入文字 (例如: "在搜索框输入 hello")\n- 截图 (例如: "截图")\n- 等待 (例如: "等待 2 秒")',
  thanks: '不客气！还有什么需要帮忙的吗？',
  goodbye: '再见！随时可以找我帮忙。',
};

