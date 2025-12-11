/**
 * Browser Tools
 * 
 * Wraps the existing browser-controller as agent tools.
 * Provides observation capabilities for the ReAct loop.
 * Includes CodeAct tools for complex data processing.
 */

import type { ToolDefinition, Observation, ElementInfo, DOMQueryResult, CodeActResult } from '../types';
import { browserController } from '../../browser-controller';
import { codeExecutor } from './code-executor';

// ============================================
// Tool Definitions
// ============================================

export const BROWSER_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'navigate',
    description: 'Navigate to a URL in the browser',
    category: 'browser',
    parameters: [
      { name: 'url', type: 'string', description: 'The URL to navigate to', required: true },
      { name: 'waitUntil', type: 'string', description: 'Wait until: load, domcontentloaded, networkidle, commit', required: false, default: 'networkidle' },
    ],
    returns: 'Navigation result with final URL',
    examples: [
      'navigate({ url: "https://google.com" })',
      'navigate({ url: "https://example.com", waitUntil: "domcontentloaded" })',
    ],
  },
  {
    name: 'click',
    description: 'Click on an element identified by selector or text',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector, text content, or element description', required: true },
    ],
    returns: 'Click result indicating success or failure',
    examples: [
      'click({ selector: "#submit-button" })',
      'click({ selector: "Login" })',
    ],
  },
  {
    name: 'type',
    description: 'Type text into an input field',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector or element description', required: true },
      { name: 'text', type: 'string', description: 'Text to type', required: true },
      { name: 'clear', type: 'boolean', description: 'Clear existing text before typing', required: false, default: true },
    ],
    returns: 'Type result indicating success or failure',
    examples: [
      'type({ selector: "#email", text: "user@example.com" })',
      'type({ selector: "input[name=search]", text: "query", clear: false })',
    ],
  },
  {
    name: 'press',
    description: 'Press a keyboard key',
    category: 'browser',
    parameters: [
      { name: 'key', type: 'string', description: 'Key to press (e.g., Enter, Tab, Escape, ArrowDown)', required: true },
    ],
    returns: 'Press result indicating success or failure',
    examples: [
      'press({ key: "Enter" })',
      'press({ key: "Tab" })',
    ],
  },
  {
    name: 'hover',
    description: 'Hover over an element',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector or element description', required: true },
    ],
    returns: 'Hover result indicating success or failure',
  },
  {
    name: 'select',
    description: 'Select an option from a dropdown',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector of the dropdown', required: true },
      { name: 'value', type: 'string', description: 'Value or label of option to select', required: true },
    ],
    returns: 'Select result indicating success or failure',
  },
  {
    name: 'wait',
    description: 'Wait for a specified duration',
    category: 'browser',
    parameters: [
      { name: 'ms', type: 'number', description: 'Milliseconds to wait', required: true },
    ],
    returns: 'Wait completion status',
  },
  {
    name: 'waitForSelector',
    description: 'Wait for an element to appear on the page',
    category: 'browser',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector to wait for', required: true },
      { name: 'state', type: 'string', description: 'State to wait for: attached, visible, hidden', required: false, default: 'visible' },
    ],
    returns: 'Wait result indicating if element was found',
  },
  {
    name: 'screenshot',
    description: 'Take a screenshot of the current page',
    category: 'observation',
    parameters: [
      { name: 'name', type: 'string', description: 'Screenshot filename (optional)', required: false },
      { name: 'fullPage', type: 'boolean', description: 'Capture full page', required: false, default: true },
    ],
    returns: 'Screenshot path',
  },
  {
    name: 'getPageInfo',
    description: 'Get current page URL and title',
    category: 'observation',
    parameters: [],
    returns: 'Object with url and title',
  },
  {
    name: 'observe',
    description: 'Get a comprehensive observation of the current page state',
    category: 'observation',
    parameters: [
      { name: 'includeScreenshot', type: 'boolean', description: 'Include base64 screenshot', required: false, default: false },
      { name: 'includeElements', type: 'boolean', description: 'Include visible interactive elements', required: false, default: true },
    ],
    returns: 'Observation object with page state',
  },
  {
    name: 'runCode',
    description: 'Execute arbitrary Playwright code',
    category: 'browser',
    parameters: [
      { name: 'code', type: 'string', description: 'Playwright code to execute', required: true },
    ],
    returns: 'Execution result',
    examples: [
      'runCode({ code: "await page.locator(\'.item\').first().click();" })',
    ],
  },
  {
    name: 'listPages',
    description: 'List all open browser tabs/pages',
    category: 'observation',
    parameters: [],
    returns: 'Array of page info objects',
  },
  {
    name: 'switchToPage',
    description: 'Switch to a different browser tab by index',
    category: 'browser',
    parameters: [
      { name: 'index', type: 'number', description: 'Tab index to switch to', required: true },
    ],
    returns: 'Switch result with new page info',
  },
  // ============================================
  // CodeAct Tools
  // ============================================
  {
    name: 'queryDOM',
    description: 'Query DOM structure for processing. Returns HTML and element info for CodeAct.',
    category: 'observation',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector to query (default: body)', required: false, default: 'body' },
      { name: 'maxElements', type: 'number', description: 'Max number of elements to return', required: false, default: 100 },
      { name: 'includeHtml', type: 'boolean', description: 'Include raw HTML in response', required: false, default: true },
    ],
    returns: 'DOMQueryResult with HTML and element info',
    examples: [
      'queryDOM({ selector: "table", maxElements: 50 })',
      'queryDOM({ selector: ".product-list", includeHtml: true })',
    ],
  },
  {
    name: 'call_code_solver',
    description: 'Execute code in a sandboxed environment for complex data processing, DOM parsing, sorting, filtering, or finding best element matches.',
    category: 'code',
    parameters: [
      { name: 'code', type: 'string', description: 'JavaScript code to execute in sandbox', required: false },
      { name: 'task', type: 'string', description: 'Natural language description of the task (used if code not provided)', required: false },
      { name: 'context', type: 'object', description: 'Context data to pass to the code', required: false },
    ],
    returns: 'CodeActResult with execution result',
    examples: [
      'call_code_solver({ task: "Find all buttons", context: { html: "..." } })',
      'call_code_solver({ code: "return sortBy(context.items, \'price\')", context: { items: [...] } })',
      'call_code_solver({ task: "Find element matching: login button", context: { elements: [...] } })',
    ],
  },
  {
    name: 'findBestElement',
    description: 'Find the best matching element for a description using fuzzy matching. Uses CodeAct internally.',
    category: 'code',
    parameters: [
      { name: 'description', type: 'string', description: 'Description of the element to find', required: true },
      { name: 'elementType', type: 'string', description: 'Type of element: button, link, input, any', required: false, default: 'any' },
    ],
    returns: 'Best matching element with selector',
    examples: [
      'findBestElement({ description: "login button" })',
      'findBestElement({ description: "search input", elementType: "input" })',
    ],
  },
  {
    name: 'extractPageData',
    description: 'Extract structured data from the page using CSS selectors. Uses CodeAct for processing.',
    category: 'code',
    parameters: [
      { name: 'selector', type: 'string', description: 'CSS selector for elements to extract', required: true },
      { name: 'fields', type: 'object', description: 'Field mapping { fieldName: cssSelector }', required: false },
    ],
    returns: 'Array of extracted data objects',
    examples: [
      'extractPageData({ selector: ".product", fields: { name: ".title", price: ".price" } })',
      'extractPageData({ selector: "table tr" })',
    ],
  },
];

// ============================================
// Tool Executors
// ============================================

export async function executeNavigate(args: Record<string, unknown>) {
  const url = args.url as string;
  const waitUntil = (args.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | 'commit') || 'networkidle';
  return browserController.navigate(url, waitUntil);
}

export async function executeClick(args: Record<string, unknown>) {
  const selector = args.selector as string;
  
  // First try the standard browser controller click
  const result = await browserController.click(selector);
  
  // If standard click fails, try CodeAct intelligent matching (BO-10)
  if (!result.success && !selector.startsWith('#') && !selector.startsWith('[')) {
    console.log(`[executeClick] Standard click failed, trying CodeAct for: ${selector}`);
    
    try {
      // Use CodeAct to find best matching element
      const findResult = await executeFindBestElement({ 
        description: selector,
        elementType: 'button'
      });
      
      if (findResult.success && findResult.data) {
        const matchData = findResult.data as { found?: boolean; selector?: string; element?: ElementInfo };
        
        if (matchData.found && matchData.selector) {
          console.log(`[executeClick] CodeAct found match: ${matchData.selector}`);
          // Try clicking the found element
          const codeActResult = await browserController.click(matchData.selector);
          if (codeActResult.success) {
            return { 
              ...codeActResult, 
              data: { 
                ...codeActResult.data as object,
                usedCodeAct: true,
                originalSelector: selector,
                matchedSelector: matchData.selector
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('[executeClick] CodeAct fallback failed:', e);
    }
  }
  
  return result;
}

export async function executeType(args: Record<string, unknown>) {
  const selector = args.selector as string;
  const text = args.text as string;
  const clear = args.clear !== false;
  
  // First try the standard browser controller type
  const result = await browserController.type(selector, text, clear);
  
  // If standard type fails, try CodeAct intelligent matching (BO-10)
  if (!result.success && !selector.startsWith('#') && !selector.startsWith('[')) {
    console.log(`[executeType] Standard type failed, trying CodeAct for: ${selector}`);
    
    try {
      // Use CodeAct to find best matching input element
      const findResult = await executeFindBestElement({ 
        description: selector,
        elementType: 'input'
      });
      
      if (findResult.success && findResult.data) {
        const matchData = findResult.data as { found?: boolean; selector?: string; element?: ElementInfo };
        
        if (matchData.found && matchData.selector) {
          console.log(`[executeType] CodeAct found match: ${matchData.selector}`);
          // Try typing in the found element
          const codeActResult = await browserController.type(matchData.selector, text, clear);
          if (codeActResult.success) {
            return { 
              ...codeActResult, 
              data: { 
                ...codeActResult.data as object,
                usedCodeAct: true,
                originalSelector: selector,
                matchedSelector: matchData.selector
              }
            };
          }
        }
      }
    } catch (e) {
      console.warn('[executeType] CodeAct fallback failed:', e);
    }
  }
  
  return result;
}

export async function executePress(args: Record<string, unknown>) {
  const key = args.key as string;
  return browserController.press(key);
}

export async function executeHover(args: Record<string, unknown>) {
  const selector = args.selector as string;
  return browserController.hover(selector);
}

export async function executeSelect(args: Record<string, unknown>) {
  const selector = args.selector as string;
  const value = args.value as string;
  return browserController.select(selector, value);
}

export async function executeWait(args: Record<string, unknown>) {
  const ms = args.ms as number;
  return browserController.wait(ms);
}

export async function executeWaitForSelector(args: Record<string, unknown>) {
  const selector = args.selector as string;
  const state = (args.state as 'attached' | 'visible' | 'hidden') || 'visible';
  return browserController.waitForSelector(selector, state);
}

export async function executeScreenshot(args: Record<string, unknown>) {
  const name = args.name as string | undefined;
  const fullPage = args.fullPage !== false;
  return browserController.screenshot(name, fullPage);
}

export async function executeGetPageInfo() {
  return { success: true, data: await browserController.getPageInfo() };
}

export async function executeObserve(args: Record<string, unknown>): Promise<{ success: boolean; data?: Observation; error?: string }> {
  const includeScreenshot = args.includeScreenshot === true;
  const includeElements = args.includeElements !== false;

  try {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, error: 'Browser not connected' };
    }

    const pageInfo = await browserController.getPageInfo();
    
    const observation: Observation = {
      timestamp: new Date().toISOString(),
      url: pageInfo.url,
      title: pageInfo.title,
    };

    // Get screenshot if requested
    if (includeScreenshot) {
      try {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 50 });
        observation.screenshot = buffer.toString('base64');
      } catch (e) {
        console.warn('Failed to capture screenshot:', e);
      }
    }

    // Get interactive elements if requested
    if (includeElements) {
      try {
        observation.visibleElements = await getVisibleElements(page);
      } catch (e) {
        console.warn('Failed to get visible elements:', e);
      }
    }

    return { success: true, data: observation };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Observation failed' 
    };
  }
}

export async function executeRunCode(args: Record<string, unknown>) {
  const code = args.code as string;
  return browserController.runCode(code);
}

export async function executeListPages() {
  const pages = await browserController.listPages();
  return { success: true, data: pages };
}

export async function executeSwitchToPage(args: Record<string, unknown>) {
  const index = args.index as number;
  return browserController.switchToPage(index);
}

// ============================================
// CodeAct Tool Executors
// ============================================

/**
 * Query DOM structure for CodeAct processing
 */
export async function executeQueryDOM(args: Record<string, unknown>): Promise<{ success: boolean; data?: DOMQueryResult; error?: string }> {
  const selector = (args.selector as string) || 'body';
  const maxElements = (args.maxElements as number) || 100;
  const includeHtml = args.includeHtml !== false;

  try {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, error: 'Browser not connected' };
    }

    const result = await page.evaluate(({ selector, maxElements, includeHtml }) => {
      const container = document.querySelector(selector);
      if (!container) {
        return {
          success: false,
          error: `Selector "${selector}" not found`,
          totalSize: 0,
          truncated: false,
        };
      }

      // Get HTML if requested
      let html = '';
      if (includeHtml) {
        html = container.outerHTML;
        // Truncate if too large
        if (html.length > 50000) {
          html = html.slice(0, 50000) + '... [truncated]';
        }
      }

      // Get elements
      const elements: Array<{
        selector: string;
        tag: string;
        text?: string;
        attributes: Record<string, string>;
        isVisible: boolean;
        isInteractable: boolean;
      }> = [];

      const allElements = container.querySelectorAll('*');
      let count = 0;

      for (const el of allElements) {
        if (count >= maxElements) break;

        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0;
        if (!isVisible) continue;

        const htmlEl = el as HTMLElement;
        const isDisabled = htmlEl.hasAttribute('disabled');

        const attributes: Record<string, string> = {};
        for (const attr of el.attributes) {
          if (['id', 'class', 'name', 'type', 'placeholder', 'aria-label', 'data-testid', 'href', 'role', 'value'].includes(attr.name)) {
            attributes[attr.name] = attr.value;
          }
        }

        // Generate selector
        let elemSelector = el.tagName.toLowerCase();
        if (el.id) {
          elemSelector = `#${el.id}`;
        } else if (attributes['data-testid']) {
          elemSelector = `[data-testid="${attributes['data-testid']}"]`;
        } else if (attributes.name) {
          elemSelector = `${el.tagName.toLowerCase()}[name="${attributes.name}"]`;
        }

        elements.push({
          selector: elemSelector,
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 100) || undefined,
          attributes,
          isVisible: true,
          isInteractable: !isDisabled,
        });

        count++;
      }

      return {
        success: true,
        html,
        elements,
        totalSize: container.outerHTML.length,
        truncated: container.outerHTML.length > 50000,
      };
    }, { selector, maxElements, includeHtml });

    return { success: true, data: result as DOMQueryResult };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'DOM query failed',
    };
  }
}

/**
 * Execute CodeAct - the main code solver tool
 */
export async function executeCallCodeSolver(args: Record<string, unknown>): Promise<{ success: boolean; data?: CodeActResult; error?: string }> {
  const code = args.code as string | undefined;
  const task = args.task as string | undefined;
  const context = args.context as Record<string, unknown> | undefined;

  try {
    let result: CodeActResult;

    if (code) {
      // Execute provided code directly
      result = await codeExecutor.execute({
        code,
        language: 'javascript',
        context,
      });
    } else if (task) {
      // Get page context if not provided
      let execContext = context || {};
      
      if (!execContext.html && !execContext.elements) {
        // Fetch DOM for the task
        const page = browserController.getPage();
        if (page) {
          const domResult = await executeQueryDOM({ includeHtml: true, maxElements: 100 });
          if (domResult.success && domResult.data) {
            execContext = {
              ...execContext,
              html: domResult.data.html,
              elements: domResult.data.elements,
            };
          }
        }
      }

      // Check task type and execute appropriate method
      const taskLower = task.toLowerCase();
      
      if (taskLower.includes('find') && (taskLower.includes('element') || taskLower.includes('match'))) {
        // Find element task
        const elements = execContext.elements as ElementInfo[] || [];
        result = await codeExecutor.findElement(elements, task);
      } else if (taskLower.includes('extract') || taskLower.includes('get all') || taskLower.includes('提取')) {
        // Data extraction task
        const html = execContext.html as string || '';
        const selector = taskLower.includes('link') ? 'a' :
                        taskLower.includes('button') ? 'button' :
                        taskLower.includes('input') ? 'input' :
                        '*';
        result = await codeExecutor.extractData(html, selector);
      } else {
        // General DOM parsing task
        const html = execContext.html as string || '';
        result = await codeExecutor.parseDOM(html, task);
      }
    } else {
      return {
        success: false,
        error: 'Either code or task must be provided',
      };
    }

    return { success: result.success, data: result, error: result.error };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Code execution failed',
    };
  }
}

/**
 * Find best matching element using CodeAct
 */
export async function executeFindBestElement(args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const description = args.description as string;
  const elementType = (args.elementType as string) || 'any';

  try {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, error: 'Browser not connected' };
    }

    // Get visible elements
    const observation = await executeObserve({ includeElements: true });
    if (!observation.success || !observation.data?.visibleElements) {
      return { success: false, error: 'Failed to get page elements' };
    }

    let elements = observation.data.visibleElements;

    // Filter by element type if specified
    if (elementType !== 'any') {
      const typeMap: Record<string, string[]> = {
        button: ['button', 'input[type="button"]', 'input[type="submit"]', '[role="button"]'],
        link: ['a'],
        input: ['input', 'textarea'],
        select: ['select'],
      };
      
      const allowedTags = typeMap[elementType] || [];
      if (allowedTags.length > 0) {
        elements = elements.filter(el => {
          const tag = el.tag.toLowerCase();
          return allowedTags.some(allowed => {
            if (allowed.includes('[')) {
              // Has attribute selector
              return el.selector.includes(allowed.split('[')[1].replace(']', ''));
            }
            return tag === allowed || el.attributes.role === allowed.replace('[role="', '').replace('"]', '');
          });
        });
      }
    }

    // Use CodeAct to find best match
    const result = await codeExecutor.findElement(elements, description);

    if (result.success && result.result) {
      return { success: true, data: result.result };
    }

    return {
      success: false,
      error: 'No matching element found',
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Find element failed',
    };
  }
}

/**
 * Extract structured data from page using CodeAct
 */
export async function executeExtractPageData(args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const selector = args.selector as string;
  const fields = args.fields as Record<string, string> | undefined;

  try {
    const page = browserController.getPage();
    if (!page) {
      return { success: false, error: 'Browser not connected' };
    }

    // Get DOM for the selector
    const domResult = await executeQueryDOM({ selector, includeHtml: true, maxElements: 200 });
    if (!domResult.success || !domResult.data?.html) {
      return { success: false, error: 'Failed to query DOM' };
    }

    // Build extraction code
    let code: string;
    
    if (fields) {
      // Extract specific fields
      const fieldEntries = Object.entries(fields)
        .map(([name, sel]) => `"${name}": $el.find("${sel}").text().trim()`)
        .join(', ');
      
      code = `
        const $ = parseHTML(context.html);
        const results = [];
        $("${selector}").each((i, el) => {
          const $el = $(el);
          results.push({ ${fieldEntries} });
        });
        return results.slice(0, 100);
      `;
    } else {
      // Extract all text content
      code = `
        const $ = parseHTML(context.html);
        const results = [];
        $("${selector}").each((i, el) => {
          const $el = $(el);
          results.push({
            text: $el.text().trim().slice(0, 200),
            html: $.html(el).slice(0, 500),
          });
        });
        return results.slice(0, 100);
      `;
    }

    const result = await codeExecutor.execute({
      code,
      language: 'javascript',
      context: { html: domResult.data.html },
    });

    if (result.success) {
      return { success: true, data: result.result };
    }

    return { success: false, error: result.error };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Data extraction failed',
    };
  }
}

// ============================================
// Helper Functions
// ============================================

async function getVisibleElements(page: import('playwright').Page): Promise<ElementInfo[]> {
  return page.evaluate(() => {
    const interactiveSelectors = [
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[role="textbox"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[onclick]',
      '[data-testid]',
    ];

    const elements: ElementInfo[] = [];
    const seen = new Set<Element>();

    for (const selector of interactiveSelectors) {
      const found = document.querySelectorAll(selector);
      
      for (const el of found) {
        if (seen.has(el)) continue;
        seen.add(el);

        const rect = el.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && 
          rect.top < window.innerHeight && rect.bottom > 0 &&
          rect.left < window.innerWidth && rect.right > 0;

        if (!isVisible) continue;

        const htmlEl = el as HTMLElement;
        const isDisabled = htmlEl.hasAttribute('disabled') || 
          htmlEl.getAttribute('aria-disabled') === 'true';

        const attributes: Record<string, string> = {};
        for (const attr of el.attributes) {
          if (['id', 'class', 'name', 'type', 'placeholder', 'aria-label', 'data-testid', 'href', 'role'].includes(attr.name)) {
            attributes[attr.name] = attr.value;
          }
        }

        // Generate a reliable selector
        let selector = '';
        if (el.id) {
          selector = `#${el.id}`;
        } else if (attributes['data-testid']) {
          selector = `[data-testid="${attributes['data-testid']}"]`;
        } else if (attributes.name) {
          selector = `${el.tagName.toLowerCase()}[name="${attributes.name}"]`;
        } else {
          const text = el.textContent?.trim().slice(0, 30);
          if (text) {
            selector = `${el.tagName.toLowerCase()}:has-text("${text}")`;
          } else {
            selector = el.tagName.toLowerCase();
          }
        }

        elements.push({
          selector,
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim().slice(0, 100) || undefined,
          attributes,
          isVisible: true,
          isInteractable: !isDisabled,
          boundingBox: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });

        // Limit to 50 elements to avoid overwhelming the LLM
        if (elements.length >= 50) break;
      }

      if (elements.length >= 50) break;
    }

    return elements;
  });
}

// ============================================
// Registration Function
// ============================================

import { toolRegistry } from './tool-registry';

export function registerBrowserTools(): void {
  // Map of tool names to executors
  const executors: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    // Browser tools
    navigate: executeNavigate,
    click: executeClick,
    type: executeType,
    press: executePress,
    hover: executeHover,
    select: executeSelect,
    wait: executeWait,
    waitForSelector: executeWaitForSelector,
    screenshot: executeScreenshot,
    getPageInfo: executeGetPageInfo,
    observe: executeObserve,
    runCode: executeRunCode,
    listPages: executeListPages,
    switchToPage: executeSwitchToPage,
    // CodeAct tools
    queryDOM: executeQueryDOM,
    call_code_solver: executeCallCodeSolver,
    findBestElement: executeFindBestElement,
    extractPageData: executeExtractPageData,
  };

  // Register each tool
  for (const definition of BROWSER_TOOL_DEFINITIONS) {
    const executor = executors[definition.name];
    if (executor) {
      toolRegistry.register(definition, async (args) => {
        const startTime = Date.now();
        try {
          const result = await executor(args);
          
          // Normalize result to ToolExecutionResult format
          if (typeof result === 'object' && result !== null && 'success' in result) {
            return {
              ...(result as object),
              duration: Date.now() - startTime,
            } as { success: boolean; data?: unknown; error?: string; duration: number };
          }
          
          return {
            success: true,
            data: result,
            duration: Date.now() - startTime,
          };
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            duration: Date.now() - startTime,
          };
        }
      });
    }
  }

  console.log(`Registered ${BROWSER_TOOL_DEFINITIONS.length} browser tools`);
}

// Auto-register on import
// registerBrowserTools();  // Commented out - call explicitly from main.ts

