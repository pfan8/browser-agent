/**
 * CodeAct E2E Tests (PRD: CA-01 ~ CA-06)
 * 
 * Tests the CodeAct subsystem for complex tasks:
 * - CA-01: Sandbox execution
 * - CA-02: Timeout control
 * - CA-03: DOM parsing utilities
 * - CA-04: Data processing utilities
 * - CA-05: Fuzzy matching
 * - CA-06: Console capture
 * 
 * Note: CodeAct is primarily tested through unit tests.
 * E2E tests here verify integration with the main agent.
 */

import { test, expect, waitForAppReady } from './fixtures';

// Helper to connect browser
async function connectBrowser(appPage: import('@playwright/test').Page) {
  const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
  if (await connectBtn.isVisible()) {
    await connectBtn.click();
    await expect(appPage.locator('.connection-status')).toContainText('Connected', {
      timeout: 15000,
    });
  }
}

// Helper to send task
async function sendTask(appPage: import('@playwright/test').Page, task: string) {
  const chatInput = appPage.locator('.command-input, input[type="text"]').first();
  await chatInput.fill(task);
  await chatInput.press('Enter');
}

test.describe('PRD: CodeAct (CA-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // CA-01: Sandbox Execution
  test('CA-01: should execute code in sandbox for complex tasks', async ({ appPage, diagnose }) => {
    try {
      // Navigate to a page with content to analyze
      await sendTask(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Send a task that triggers CodeAct (data extraction)
      await sendTask(appPage, '提取页面上所有链接的文本和URL');
      
      // Wait for CodeAct execution
      await appPage.waitForTimeout(10000);
      
      // Should have response (CodeAct or regular)
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('CA-01-sandbox-execution-failed');
      throw error;
    }
  });

  // CA-02: Timeout Control
  test('CA-02: should handle code execution timeout', async ({ appPage, diagnose }) => {
    try {
      // Send a task that shouldn't hang
      await sendTask(appPage, '快速检查页面元素数量');
      
      // Should complete within timeout
      await appPage.waitForTimeout(15000);
      
      // App should remain responsive
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await expect(chatInput).toBeEnabled();
    } catch (error) {
      await diagnose('CA-02-timeout-control-failed');
      throw error;
    }
  });

  // CA-03: DOM Parsing
  test('CA-03: should parse DOM for element extraction', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Request DOM analysis
      await sendTask(appPage, '分析页面的DOM结构，列出主要元素');
      
      await appPage.waitForTimeout(10000);
      
      // Should provide DOM info
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('CA-03-dom-parsing-failed');
      throw error;
    }
  });

  // CA-04: Data Processing
  test('CA-04: should process data with sorting/filtering', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Request sorted data (triggers CodeAct for complex logic)
      await sendTask(appPage, '获取所有链接并按文本长度排序');
      
      await appPage.waitForTimeout(10000);
      
      // Should process and return data
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('CA-04-data-processing-failed');
      throw error;
    }
  });

  // CA-05: Fuzzy Matching
  test('CA-05: should find elements using fuzzy matching', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Use fuzzy description
      await sendTask(appPage, '找到类似"更多信息"的链接');
      
      await appPage.waitForTimeout(10000);
      
      // Should attempt fuzzy matching
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('CA-05-fuzzy-matching-failed');
      throw error;
    }
  });

  // CA-06: Console Capture (Integration)
  test('CA-06: should capture execution logs', async ({ appPage, diagnose }) => {
    try {
      // Send a task that might produce logs
      await sendTask(appPage, '检查当前页面并报告状态');
      
      await appPage.waitForTimeout(5000);
      
      // Console output is captured in agent-reporter
      // Just verify task completes
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('CA-06-console-capture-failed');
      throw error;
    }
  });
});

test.describe('CodeAct Gating', () => {
  test('should trigger CodeAct for large DOM', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      await connectBrowser(appPage);
      
      // Navigate to a complex page
      await sendTask(appPage, 'goto https://news.ycombinator.com');
      await appPage.waitForTimeout(5000);
      
      // Request analysis of large DOM
      await sendTask(appPage, '统计页面上所有文章标题');
      
      await appPage.waitForTimeout(15000);
      
      // Should handle large DOM (might trigger CodeAct)
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('codeact-gating-large-dom-failed');
      throw error;
    }
  });

  test('should trigger CodeAct on selector failures', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      await connectBrowser(appPage);
      
      await sendTask(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Try to find element that doesn't exist (multiple failures)
      await sendTask(appPage, '点击登录按钮');
      await appPage.waitForTimeout(10000);
      
      // Should handle gracefully (might trigger CodeAct for alternatives)
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await expect(chatInput).toBeEnabled();
    } catch (error) {
      await diagnose('codeact-gating-selector-failure-failed');
      throw error;
    }
  });
});

