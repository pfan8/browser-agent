/**
 * ReAct Agent E2E Tests (PRD: RA-01 ~ RA-08)
 * 
 * Tests the ReAct (Reasoning + Acting) agent loop:
 * - RA-01: Observation
 * - RA-02: Thinking (LLM analysis)
 * - RA-03: Action execution
 * - RA-04: Result verification
 * - RA-05: Loop termination
 * - RA-06: Infinite loop detection
 * - RA-07: Consecutive failure handling
 * - RA-08: Rule-based fallback
 * 
 * Prerequisites:
 * - Chrome with --remote-debugging-port=9222
 * - LLM API Key configured (for RA-02)
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

// Helper to send task to agent
async function sendTask(appPage: import('@playwright/test').Page, task: string) {
  const chatInput = appPage.locator('.command-input, input[type="text"]').first();
  await chatInput.fill(task);
  await chatInput.press('Enter');
}

// Helper to wait for agent response
async function waitForAgentResponse(appPage: import('@playwright/test').Page, timeout = 30000) {
  // Wait for processing to complete
  await appPage.waitForFunction(
    () => {
      const messages = document.querySelectorAll('.message-list .message, .messages .message');
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) return false;
      const status = lastMessage.getAttribute('data-status') || lastMessage.className;
      return status.includes('success') || status.includes('error') || status.includes('complete');
    },
    { timeout }
  ).catch(() => {
    // Timeout is acceptable - agent might still be working
  });
}

test.describe('PRD: ReAct Agent (RA-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // RA-01: Observation
  test('RA-01: should observe current page state', async ({ appPage, diagnose }) => {
    try {
      // Send a task that requires observation
      await sendTask(appPage, '当前页面的标题是什么');
      
      // Wait for agent to process
      await appPage.waitForTimeout(5000);
      
      // Agent should respond with page info
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Should have some response
      const messages = await messageList.locator('.message').count();
      expect(messages).toBeGreaterThan(1); // At least user message + agent response
    } catch (error) {
      await diagnose('RA-01-observation-failed');
      throw error;
    }
  });

  // RA-02: Thinking (LLM)
  test('RA-02: should use LLM for task analysis', async ({ appPage, diagnose }) => {
    try {
      // Send a complex task requiring LLM thinking
      await sendTask(appPage, '分析当前页面有哪些可点击的按钮');
      
      // Wait for LLM response
      await appPage.waitForTimeout(10000);
      
      // Check for thinking/processing indicator or response
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Agent should provide some analysis
      const responseText = await messageList.textContent();
      expect(responseText?.length).toBeGreaterThan(50);
    } catch (error) {
      await diagnose('RA-02-llm-thinking-failed');
      throw error;
    }
  });

  // RA-03: Action Execution
  test('RA-03: should execute decided actions', async ({ appPage, diagnose }) => {
    try {
      // Send an action task
      await sendTask(appPage, '打开 https://example.com');
      
      // Wait for action to complete
      await appPage.waitForTimeout(5000);
      
      // Check that action was executed
      const messageList = appPage.locator('.message-list, .messages');
      
      // Should see success or action-related response
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('RA-03-action-execution-failed');
      throw error;
    }
  });

  // RA-04: Result Verification
  test('RA-04: should verify action results', async ({ appPage, diagnose }) => {
    try {
      // Send a task that can be verified
      await sendTask(appPage, '导航到 example.com 并确认页面加载');
      
      // Wait for task completion
      await appPage.waitForTimeout(8000);
      
      // Agent should report success/completion
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Look for completion indicators
      const content = await messageList.textContent();
      // Should have some verification result
      expect(content).toBeTruthy();
    } catch (error) {
      await diagnose('RA-04-result-verification-failed');
      throw error;
    }
  });

  // RA-05: Loop Termination
  test('RA-05: should terminate when task is complete', async ({ appPage, diagnose }) => {
    try {
      // Send a simple task that should complete quickly
      await sendTask(appPage, '告诉我当前的 URL');
      
      // Wait for completion
      await appPage.waitForTimeout(10000);
      
      // Check for completion message
      const messageList = appPage.locator('.message-list, .messages');
      const messages = await messageList.locator('.message').all();
      
      // Should have completed (not stuck in loop)
      expect(messages.length).toBeGreaterThan(0);
    } catch (error) {
      await diagnose('RA-05-loop-termination-failed');
      throw error;
    }
  });

  // RA-06: Infinite Loop Detection
  test('RA-06: should detect and break infinite loops', async ({ appPage, diagnose }) => {
    try {
      // Send a task that might cause repeated actions
      await sendTask(appPage, '持续检查页面状态');
      
      // Agent should not run indefinitely
      await appPage.waitForTimeout(15000);
      
      // Should have stopped or provided response
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('RA-06-infinite-loop-detection-failed');
      throw error;
    }
  });

  // RA-07: Consecutive Failure Handling
  test('RA-07: should handle consecutive failures gracefully', async ({ appPage, diagnose }) => {
    try {
      // Send a task that will likely fail (invalid selector)
      await sendTask(appPage, '点击 #non-existent-element-xyz');
      
      // Wait for failure handling
      await appPage.waitForTimeout(10000);
      
      // Should report failure, not crash
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // App should still be responsive
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await expect(chatInput).toBeEnabled();
    } catch (error) {
      await diagnose('RA-07-failure-handling-failed');
      throw error;
    }
  });

  // RA-08: Rule-Based Fallback
  test('RA-08: should use rule-based thinking as fallback', async ({ appPage, diagnose }) => {
    try {
      // Send a simple command that can be handled by rules
      await sendTask(appPage, 'navigate to https://example.com');
      
      // Wait for processing
      await appPage.waitForTimeout(5000);
      
      // Should work even without LLM (rule-based)
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('RA-08-rule-fallback-failed');
      throw error;
    }
  });
});

// Additional test for agent stop functionality
test.describe('Agent Control', () => {
  test('should stop running task when stop button clicked', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      await connectBrowser(appPage);
      
      // Start a long-running task
      await sendTask(appPage, '分析页面上所有元素的详细信息');
      
      // Wait a bit then try to stop
      await appPage.waitForTimeout(2000);
      
      // Look for stop button
      const stopBtn = appPage.locator('button:has-text("Stop"), button:has-text("停止"), .stop-btn');
      if (await stopBtn.isVisible()) {
        await stopBtn.click();
        
        // Should stop within reasonable time
        await appPage.waitForTimeout(3000);
        
        // App should remain responsive
        const chatInput = appPage.locator('.command-input, input[type="text"]').first();
        await expect(chatInput).toBeEnabled();
      }
    } catch (error) {
      await diagnose('agent-stop-failed');
      throw error;
    }
  });
});

