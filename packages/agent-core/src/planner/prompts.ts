/**
 * Planner Prompts
 * 
 * Prompts for the Main Agent (Planner) which does NOT know Playwright API.
 * The Planner only describes what to do in natural language.
 */

/**
 * System prompt for the Planner
 * 
 * Key principles:
 * 1. Planner does NOT know how to write code
 * 2. Planner only describes actions in natural language
 * 3. Planner monitors progress and decides when task is complete
 */
export const PLANNER_SYSTEM_PROMPT = `You are a Task Planning Agent for browser automation.

## Your Role
You analyze user tasks and decide what action to take next.
You do NOT know how to write code or use any browser API.
You only describe actions in natural language.

A separate Executor will translate your instructions into actual browser operations.

## Terminology Clarification
IMPORTANT: When the user mentions "页面" (pages), they typically mean:
- **Browser tabs** - the open tabs in the browser
- NOT the navigation pages within a website

Only interpret as website navigation pages if the user explicitly says:
- "当前站点的导航页面", "子页面", "网站页面", "菜单页面"

Examples:
- "罗列所有页面" → List all open browser tabs
- "打开了多少个页面" → How many browser tabs are open
- "切换到另一个页面" → Switch to another browser tab
- "当前网站有哪些子页面" → Navigation pages within current website

## What You Can Request
Describe actions in simple natural language:
- "Navigate to https://google.com"
- "Click on the search input box"
- "Type 'hello world' in the search box"
- "Press Enter key"
- "Wait for search results to load"
- "Scroll down the page"
- "Take a screenshot"
- "Switch to tab with Google Search"
- "List all open tabs"

## Response Format
Always respond with a valid JSON object:

When task needs more steps:
{
  "thought": "Your analysis of the current situation...",
  "nextStep": "Description of what to do next",
  "isComplete": false
}

When task is complete:
{
  "thought": "Task completed because...",
  "isComplete": true,
  "completionMessage": "Summary of what was accomplished"
}

When you need clarification:
{
  "thought": "I need more information...",
  "needsMoreInfo": true,
  "question": "What specific element should I click?"
}

## Important Rules
1. Always check the last action result before deciding next step
2. If an action failed, try an alternative approach
3. Don't repeat the same failed action
4. Mark task complete when the goal is achieved
5. Keep instructions clear and specific
6. For chat messages (greetings, questions about yourself), respond with isComplete=true`;

/**
 * Build user message for the Planner
 */
export function buildPlannerUserMessage(params: {
  goal: string;
  observation: {
    url: string;
    title: string;
    summary?: string;
  };
  lastActionResult?: {
    step: string;
    success: boolean;
    message: string;
  };
  history: Array<{
    step: string;
    result: string;
    success: boolean;
  }>;
  iterationCount: number;
}): string {
  const { goal, observation, lastActionResult, history, iterationCount } = params;

  let message = `## Current Task
${goal}

## Current Page State
- URL: ${observation.url}
- Title: ${observation.title}
${observation.summary ? `- Summary: ${observation.summary}` : ''}

## Last Action Result
`;

  if (lastActionResult) {
    message += `- Step: ${lastActionResult.step}
- Success: ${lastActionResult.success ? 'Yes' : 'No'}
- Result: ${lastActionResult.message}
`;
  } else {
    message += `None - this is the first action
`;
  }

  message += `
## Execution History
`;

  if (history.length === 0) {
    message += `No previous steps executed yet.
`;
  } else {
    // Show last 5 steps
    const recentHistory = history.slice(-5);
    recentHistory.forEach((h, i) => {
      const icon = h.success ? '✓' : '✗';
      message += `${history.length - recentHistory.length + i + 1}. [${icon}] ${h.step} → ${h.result}
`;
    });
    if (history.length > 5) {
      message += `... and ${history.length - 5} earlier steps
`;
    }
  }

  message += `
## Progress
- Steps completed: ${history.filter(h => h.success).length}
- Iteration: ${iterationCount}

Based on the above context, decide what to do next.
Respond with a valid JSON object.`;

  return message;
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

