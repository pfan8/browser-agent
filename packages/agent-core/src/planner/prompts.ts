/**
 * Planner Prompts
 *
 * Prompts for the Main Agent (Planner) which does NOT know Playwright API.
 * The Planner only describes what to do in natural language.
 *
 * Two modes:
 * 1. Initial Planning: Generate complete task list (todos)
 * 2. Progress Tracking: Update based on execution results (legacy mode)
 */

import type { BeadsPlannerOutput, BeadsPlannerTask } from '../beads/types';

/**
 * System prompt for initial task planning (Beads mode)
 *
 * Generates a complete list of todos upfront.
 * Tasks can be marked as mergeable for batch execution.
 */
export const PLANNER_INITIAL_SYSTEM_PROMPT = `You are a task planner for browser automation. Your job is to break down user goals into a list of specific, actionable tasks.

## Output Format (JSON)
{
  "epic": "Brief description of the overall goal",
  "tasks": [
    { "title": "Task 1 description", "mergeable": true, "type": "browser_action" },
    { "title": "Task 2 description", "mergeable": true, "blockedBy": [0], "type": "browser_action" },
    { "title": "Task 3 description", "mergeable": false, "blockedBy": [1], "type": "browser_action" }
  ],
  "mergeHint": "Tasks 0-1 can be merged into one script"
}

## Task Types
- browser_action: Navigate, click, type, scroll, screenshot, etc.
- query: Extract data or information from page
- translate: (future) Language translation
- export: (future) Generate automation script

## Merge Rules
Mark tasks as "mergeable": true when:
1. They are consecutive browser actions (navigate → click → type)
2. They don't require intermediate observation/verification
3. They can be executed in a single script

Mark as "mergeable": false when:
1. Task needs to verify previous step's result
2. Task depends on dynamic content (e.g., wait for element)
3. Task extracts data that might be needed later

## blockedBy Field
- Array of task indices (0-based) that must complete first
- Creates dependency chain: task 2 blocked by task 1 → task 1 runs first
- Only use when there's a real dependency

## Rules
1. Be specific: Include URLs, selectors, text when known
2. One action per task (unless merging makes sense)
3. Order tasks logically (dependencies flow downward)
4. Keep task titles concise but descriptive
5. Merge consecutive browser actions when possible for efficiency

## Example
Goal: "Search for 'weather' on Google and click the first result"

Response:
{
  "epic": "Search Google for weather",
  "tasks": [
    { "title": "Navigate to google.com", "mergeable": true, "type": "browser_action" },
    { "title": "Type 'weather' in search box", "mergeable": true, "blockedBy": [0], "type": "browser_action" },
    { "title": "Press Enter to search", "mergeable": false, "blockedBy": [1], "type": "browser_action" },
    { "title": "Click the first search result", "mergeable": false, "blockedBy": [2], "type": "browser_action" }
  ],
  "mergeHint": "Tasks 0-1 can be merged"
}`;

/**
 * System prompt for the Planner (legacy step-by-step mode)
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

## Completion Message Format
When completing a task that returns structured data (lists, arrays, tables):
- Give a BRIEF summary with COUNT only, e.g., "当前浏览器共打开了28个标签页"
- DO NOT list individual items - full data will be displayed separately in a table
- Only mention total count and notable patterns (e.g., "其中3个是Zoom相关页面")

When completing a simple action (no structured data):
- Describe what was done concisely

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
    const {
        goal,
        observation,
        lastActionResult,
        history,
        iterationCount,
        memoryContext,
    } = params;

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
        } else if (
            memoryContext.relevantFacts &&
            memoryContext.relevantFacts.length > 0
        ) {
            message += `
## Relevant Memory
${memoryContext.relevantFacts
    .slice(0, 3)
    .map((f) => `- ${f}`)
    .join('\n')}
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
            message += `${
                history.length - recentHistory.length + i + 1
            }. [${icon}] ${h.step}
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
            if (
                'data' in obj &&
                typeof obj.data === 'object' &&
                obj.data !== null
            ) {
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
    greeting:
        '你好！我是浏览器自动化助手。请告诉我你想要执行的浏览器操作，例如：\n- "打开 https://google.com"\n- "点击搜索按钮"\n- "在输入框输入 hello"',
    morning: '早上好！有什么我可以帮你的浏览器操作吗？',
    afternoon: '下午好！需要我帮你执行什么浏览器操作？',
    evening: '晚上好！请告诉我你想要执行的操作。',
    whoAreYou:
        '我是浏览器自动化助手，可以帮你控制浏览器执行各种操作，如导航、点击、输入文字等。',
    help: '我可以帮你：\n- 导航到网址 (例如: "打开 google.com")\n- 点击元素 (例如: "点击登录按钮")\n- 输入文字 (例如: "在搜索框输入 hello")\n- 截图 (例如: "截图")\n- 等待 (例如: "等待 2 秒")',
    thanks: '不客气！还有什么需要帮忙的吗？',
    goodbye: '再见！随时可以找我帮忙。',
};

// ============================================
// Beads Planning Functions
// ============================================

/**
 * Build user message for initial planning (Beads mode)
 */
export function buildInitialPlanningMessage(goal: string): string {
    return `## Goal
${goal}

Please break this down into specific, actionable tasks. Output JSON with the task list.`;
}

/**
 * Build user message for progress update (Beads mode)
 */
export function buildProgressUpdateMessage(params: {
    goal: string;
    completedTasks: Array<{ title: string; result?: string }>;
    failedTasks: Array<{ title: string; error?: string }>;
    remainingTasks: Array<{ title: string }>;
    currentTaskResult?: { success: boolean; result?: string; error?: string };
}): string {
    const {
        goal,
        completedTasks,
        failedTasks,
        remainingTasks,
        currentTaskResult,
    } = params;

    let message = `## Goal\n${goal}\n\n`;

    if (completedTasks.length > 0) {
        message += `## Completed (${completedTasks.length})\n`;
        completedTasks.forEach((t, i) => {
            message += `${i + 1}. ✓ ${t.title}\n`;
        });
        message += '\n';
    }

    if (failedTasks.length > 0) {
        message += `## Failed (${failedTasks.length})\n`;
        failedTasks.forEach((t, i) => {
            message += `${i + 1}. ✗ ${t.title}${
                t.error ? `: ${t.error}` : ''
            }\n`;
        });
        message += '\n';
    }

    if (remainingTasks.length > 0) {
        message += `## Remaining (${remainingTasks.length})\n`;
        remainingTasks.forEach((t, i) => {
            message += `${i + 1}. ○ ${t.title}\n`;
        });
        message += '\n';
    }

    if (currentTaskResult) {
        message += `## Last Task Result\n`;
        message += currentTaskResult.success
            ? `✓ Success${
                  currentTaskResult.result
                      ? `: ${currentTaskResult.result}`
                      : ''
              }\n`
            : `✗ Failed${
                  currentTaskResult.error ? `: ${currentTaskResult.error}` : ''
              }\n`;
    }

    return message;
}

/**
 * Extract balanced JSON object from text
 * Handles nested braces correctly by counting open/close pairs
 */
function extractBalancedJson(text: string): string | null {
    const startIndex = text.indexOf('{');
    if (startIndex === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = startIndex; i < text.length; i++) {
        const char = text[i];

        if (escape) {
            escape = false;
            continue;
        }

        if (char === '\\' && inString) {
            escape = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
            if (depth === 0) {
                return text.slice(startIndex, i + 1);
            }
        }
    }

    return null; // Unbalanced braces
}

/**
 * Parse initial planning response from LLM
 */
export function parseInitialPlanningResponse(
    response: string
): BeadsPlannerOutput | null {
    try {
        // Extract first balanced JSON object from response
        const jsonString = extractBalancedJson(response);
        if (!jsonString) {
            return null;
        }

        const parsed = JSON.parse(jsonString);

        // Validate required fields
        if (!parsed.epic || !Array.isArray(parsed.tasks)) {
            return null;
        }

        // Normalize tasks
        const tasks: BeadsPlannerTask[] = parsed.tasks.map(
            (t: Record<string, unknown>) => ({
                title: String(t.title || ''),
                mergeable: t.mergeable === true,
                blockedBy: Array.isArray(t.blockedBy)
                    ? (t.blockedBy as number[])
                    : undefined,
                type: (t.type as BeadsPlannerTask['type']) || 'browser_action',
            })
        );

        return {
            epic: String(parsed.epic),
            tasks,
            mergeHint: parsed.mergeHint ? String(parsed.mergeHint) : undefined,
        };
    } catch {
        return null;
    }
}

/**
 * Find mergeable task groups from a list of tasks
 * Returns array of task index ranges that can be merged
 */
export function findMergeableGroups(
    tasks: BeadsPlannerTask[]
): Array<[number, number]> {
    const groups: Array<[number, number]> = [];
    let groupStart: number | null = null;

    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];

        if (task.mergeable) {
            if (groupStart === null) {
                groupStart = i;
            }
        } else {
            if (groupStart !== null && i - groupStart > 1) {
                // Group has at least 2 tasks
                groups.push([groupStart, i - 1]);
            }
            groupStart = null;
        }
    }

    // Handle group at end
    if (groupStart !== null && tasks.length - groupStart > 1) {
        groups.push([groupStart, tasks.length - 1]);
    }

    return groups;
}

/**
 * Merge task titles into a single instruction
 */
export function mergeTaskTitles(tasks: BeadsPlannerTask[]): string {
    if (tasks.length === 0) return '';
    if (tasks.length === 1) return tasks[0].title;

    return tasks.map((t) => t.title).join(', then ');
}
