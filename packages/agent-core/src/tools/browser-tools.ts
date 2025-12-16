/**
 * Browser Tools for LangGraph
 * 
 * Defines LangGraph-compatible tools that wrap IBrowserAdapter operations.
 * These tools can be used by the agent to interact with the browser.
 * 
 * Implements:
 * - BO-*: Basic browser operations
 * - MS-04: Wait for element tools
 * - ER-03: Scroll search capability
 */

import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';

/**
 * Creates browser tools that wrap the browser adapter
 */
export function createBrowserTools(browserAdapter: IBrowserAdapter) {
  /**
   * Navigate to a URL
   */
  const navigateTool = tool(
    async ({ url }) => {
      const result = await browserAdapter.navigate(url);
      return JSON.stringify(result);
    },
    {
      name: 'navigate',
      description: 'Navigate to a URL in the browser. Use this to go to a specific webpage.',
      schema: z.object({
        url: z.string().describe('The URL to navigate to (e.g., "https://example.com" or "example.com")'),
      }),
    }
  );

  /**
   * Click on an element
   */
  const clickTool = tool(
    async ({ selector }) => {
      const result = await browserAdapter.click(selector);
      return JSON.stringify(result);
    },
    {
      name: 'click',
      description: 'Click on an element in the page. The selector can be a CSS selector, text content, data-testid, or aria-label.',
      schema: z.object({
        selector: z.string().describe('The selector for the element to click (CSS selector, text, or data-testid)'),
      }),
    }
  );

  /**
   * Type text into an element
   */
  const typeTool = tool(
    async ({ selector, text, clear }) => {
      const result = await browserAdapter.type(selector, text, clear ?? true);
      return JSON.stringify(result);
    },
    {
      name: 'type',
      description: 'Type text into an input field or editable element. By default, clears existing content first.',
      schema: z.object({
        selector: z.string().describe('The selector for the input element'),
        text: z.string().describe('The text to type'),
        clear: z.boolean().optional().describe('Whether to clear existing content first (default: true)'),
      }),
    }
  );

  /**
   * Press a keyboard key
   */
  const pressTool = tool(
    async ({ key }) => {
      const result = await browserAdapter.press(key);
      return JSON.stringify(result);
    },
    {
      name: 'press',
      description: 'Press a keyboard key. Common keys: Enter, Tab, Escape, ArrowUp, ArrowDown, Backspace',
      schema: z.object({
        key: z.string().describe('The key to press (e.g., "Enter", "Tab", "Escape")'),
      }),
    }
  );

  /**
   * Hover over an element
   */
  const hoverTool = tool(
    async ({ selector }) => {
      const result = await browserAdapter.hover(selector);
      return JSON.stringify(result);
    },
    {
      name: 'hover',
      description: 'Hover over an element to trigger hover effects or reveal hidden content.',
      schema: z.object({
        selector: z.string().describe('The selector for the element to hover over'),
      }),
    }
  );

  /**
   * Select an option from a dropdown
   */
  const selectTool = tool(
    async ({ selector, value }) => {
      const result = await browserAdapter.select(selector, value);
      return JSON.stringify(result);
    },
    {
      name: 'select',
      description: 'Select an option from a dropdown/select element.',
      schema: z.object({
        selector: z.string().describe('The selector for the select element'),
        value: z.string().describe('The value to select'),
      }),
    }
  );

  /**
   * Wait for a duration
   */
  const waitTool = tool(
    async ({ ms }) => {
      const result = await browserAdapter.wait(ms);
      return JSON.stringify(result);
    },
    {
      name: 'wait',
      description: 'Wait for a specified duration in milliseconds.',
      schema: z.object({
        ms: z.number().describe('The number of milliseconds to wait'),
      }),
    }
  );

  /**
   * Wait for an element
   */
  const waitForSelectorTool = tool(
    async ({ selector, state }) => {
      const result = await browserAdapter.waitForSelector(selector, state);
      return JSON.stringify(result);
    },
    {
      name: 'waitForSelector',
      description: 'Wait for an element to appear, become visible, or be hidden.',
      schema: z.object({
        selector: z.string().describe('The selector for the element to wait for'),
        state: z.enum(['attached', 'visible', 'hidden']).optional().describe('The state to wait for (default: visible)'),
      }),
    }
  );

  /**
   * Take a screenshot
   */
  const screenshotTool = tool(
    async ({ name, fullPage }) => {
      const result = await browserAdapter.screenshot(name, fullPage ?? true);
      return JSON.stringify(result);
    },
    {
      name: 'screenshot',
      description: 'Take a screenshot of the current page.',
      schema: z.object({
        name: z.string().optional().describe('Optional name for the screenshot file'),
        fullPage: z.boolean().optional().describe('Whether to capture the full page (default: true)'),
      }),
    }
  );

  /**
   * Get page info
   */
  const getPageInfoTool = tool(
    async () => {
      const result = await browserAdapter.getPageInfo();
      return JSON.stringify(result);
    },
    {
      name: 'getPageInfo',
      description: 'Get the current page URL and title.',
      schema: z.object({}),
    }
  );

  /**
   * List open tabs
   */
  const listPagesTool = tool(
    async () => {
      const result = await browserAdapter.listPages();
      return JSON.stringify(result);
    },
    {
      name: 'listPages',
      description: 'List all open browser tabs/pages.',
      schema: z.object({}),
    }
  );

  /**
   * Switch to a different tab
   */
  const switchToPageTool = tool(
    async ({ index }) => {
      const result = await browserAdapter.switchToPage(index);
      return JSON.stringify(result);
    },
    {
      name: 'switchToPage',
      description: 'Switch to a different browser tab by index.',
      schema: z.object({
        index: z.number().describe('The index of the tab to switch to (0-based)'),
      }),
    }
  );

  /**
   * Run custom code
   */
  const runCodeTool = tool(
    async ({ code }) => {
      const result = await browserAdapter.runCode(code);
      return JSON.stringify(result);
    },
    {
      name: 'runCode',
      description: `Execute custom Playwright code. Use for complex operations not covered by other tools.

IMPORTANT: This code runs in Node.js context with Playwright, NOT in browser context.
- You have access to: page, context, browser (Playwright objects)
- To access browser BOM objects (window, document, localStorage, etc.), you MUST use page.evaluate():
  - WRONG: document.querySelector('.btn') // Error: document is not defined
  - CORRECT: await page.evaluate(() => document.querySelector('.btn')?.textContent)
  - CORRECT: await page.evaluate(() => window.scrollTo(0, 100))
  - CORRECT: await page.evaluate(() => localStorage.getItem('key'))
- For simple DOM operations, prefer using page.locator() or page.$() instead of page.evaluate()`,
      schema: z.object({
        code: z.string().describe('Playwright code to execute. Has access to page, context, browser objects. Use page.evaluate() for browser BOM access.'),
      }),
    }
  );

  /**
   * Wait for element and poll (MS-04)
   */
  const waitForElementTool = tool(
    async ({ selector, timeout, pollInterval }) => {
      const maxAttempts = Math.ceil((timeout || 10000) / (pollInterval || 500));
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        try {
          const result = await browserAdapter.waitForSelector(selector, 'visible');
          if (result.success) {
            return JSON.stringify({ 
              success: true, 
              message: `Element found after ${attempts + 1} attempts`,
              attempts: attempts + 1,
            });
          }
        } catch {
          // Continue polling
        }
        
        await new Promise(resolve => setTimeout(resolve, pollInterval || 500));
        attempts++;
      }
      
      return JSON.stringify({ 
        success: false, 
        error: `Element not found after ${timeout || 10000}ms`,
        attempts,
      });
    },
    {
      name: 'waitForElement',
      description: 'Wait for an element to appear by polling. Use this for dynamic content that loads asynchronously (MS-04).',
      schema: z.object({
        selector: z.string().describe('The selector for the element to wait for'),
        timeout: z.number().optional().describe('Maximum time to wait in ms (default: 10000)'),
        pollInterval: z.number().optional().describe('Polling interval in ms (default: 500)'),
      }),
    }
  );

  /**
   * Scroll to find element (ER-03)
   */
  const scrollToFindTool = tool(
    async ({ selector, maxScrolls, direction }) => {
      const scrollDir = direction || 'down';
      const maxAttempts = maxScrolls || 5;
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        // Check if element is visible
        try {
          const result = await browserAdapter.waitForSelector(selector, 'visible');
          if (result.success) {
            return JSON.stringify({ 
              success: true, 
              message: `Element found after ${attempts} scrolls`,
              scrolls: attempts,
            });
          }
        } catch {
          // Element not found yet
        }
        
        // Scroll the page
        const scrollCode = scrollDir === 'up'
          ? 'window.scrollBy(0, -window.innerHeight * 0.8)'
          : 'window.scrollBy(0, window.innerHeight * 0.8)';
        
        await browserAdapter.runCode(scrollCode);
        await new Promise(resolve => setTimeout(resolve, 300)); // Wait for render
        attempts++;
      }
      
      return JSON.stringify({ 
        success: false, 
        error: `Element not found after ${maxAttempts} scrolls`,
        scrolls: maxAttempts,
      });
    },
    {
      name: 'scrollToFind',
      description: 'Scroll the page to find an element that may be off-screen (ER-03). Useful when element is not visible in viewport.',
      schema: z.object({
        selector: z.string().describe('The selector for the element to find'),
        maxScrolls: z.number().optional().describe('Maximum number of scroll attempts (default: 5)'),
        direction: z.enum(['up', 'down']).optional().describe('Scroll direction (default: down)'),
      }),
    }
  );

  /**
   * Scroll page
   */
  const scrollTool = tool(
    async ({ direction, amount }) => {
      const scrollAmount = amount || 500;
      const scrollCode = direction === 'up'
        ? `window.scrollBy(0, -${scrollAmount})`
        : `window.scrollBy(0, ${scrollAmount})`;
      
      const result = await browserAdapter.runCode(scrollCode);
      return JSON.stringify({ ...result, scrolled: scrollAmount, direction });
    },
    {
      name: 'scroll',
      description: 'Scroll the page up or down by a specified amount.',
      schema: z.object({
        direction: z.enum(['up', 'down']).describe('Direction to scroll'),
        amount: z.number().optional().describe('Pixels to scroll (default: 500)'),
      }),
    }
  );

  /**
   * Check if element exists
   */
  const elementExistsTool = tool(
    async ({ selector }) => {
      try {
        const result = await browserAdapter.waitForSelector(selector, 'attached');
        return JSON.stringify({ 
          exists: result.success,
          selector,
        });
      } catch {
        return JSON.stringify({ exists: false, selector });
      }
    },
    {
      name: 'elementExists',
      description: 'Check if an element exists in the DOM. Does not require visibility.',
      schema: z.object({
        selector: z.string().describe('The selector for the element to check'),
      }),
    }
  );

  /**
   * Get element text
   */
  const getElementTextTool = tool(
    async ({ selector }) => {
      const code = `
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el) {
          return { success: true, text: el.textContent?.trim() || '' };
        }
        return { success: false, error: 'Element not found' };
      `;
      const result = await browserAdapter.runCode(code);
      return JSON.stringify(result);
    },
    {
      name: 'getElementText',
      description: 'Get the text content of an element. Useful for verifying action results (SA-02).',
      schema: z.object({
        selector: z.string().describe('The selector for the element'),
      }),
    }
  );

  /**
   * Get input value for SA-02 verification
   */
  const getInputValueTool = tool(
    async ({ selector }) => {
      const code = `
        const el = document.querySelector('${selector.replace(/'/g, "\\'")}');
        if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          return { success: true, value: el.value };
        }
        return { success: false, error: 'Input element not found' };
      `;
      const result = await browserAdapter.runCode(code);
      return JSON.stringify(result);
    },
    {
      name: 'getInputValue',
      description: 'Get the value of an input field. Use to verify that typing was successful (SA-02).',
      schema: z.object({
        selector: z.string().describe('The selector for the input element'),
      }),
    }
  );

  return [
    navigateTool,
    clickTool,
    typeTool,
    pressTool,
    hoverTool,
    selectTool,
    waitTool,
    waitForSelectorTool,
    screenshotTool,
    getPageInfoTool,
    listPagesTool,
    switchToPageTool,
    runCodeTool,
    // New tools for MS and ER
    waitForElementTool,
    scrollToFindTool,
    scrollTool,
    elementExistsTool,
    getElementTextTool,
    getInputValueTool,
  ];
}

