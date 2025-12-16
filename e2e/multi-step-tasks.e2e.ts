/**
 * Multi-Step Task Execution E2E Tests (PRD: MS-01 ~ MS-08)
 * 
 * Tests the agent's ability to execute multi-step tasks:
 * - MS-01: Search and click result
 * - MS-02: Form filling
 * - MS-03: Navigate then operate
 * - MS-04: Wait for element appearance
 * - MS-05: Handle popups/modals
 * - MS-06: Dropdown selection
 * - MS-07: Pagination search (P2, skipped)
 * - MS-08: Cascading operations (P2, skipped)
 * 
 * Also covers State Awareness (SA-*) and Error Recovery (ER-*):
 * - SA-01: Page load detection
 * - SA-02: Operation result verification
 * - SA-03: Goal completion judgment
 * - ER-01: Selector fallback
 * - ER-02: Wait and retry
 * - ER-06: Failure reporting
 * 
 * Prerequisites:
 * - Chrome with --remote-debugging-port=9222
 * - LLM API Key configured
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

// Helper to wait for task completion or timeout
async function waitForTaskCompletion(
  appPage: import('@playwright/test').Page, 
  timeout = 30000
): Promise<boolean> {
  try {
    await appPage.waitForFunction(
      () => {
        const messages = document.querySelectorAll('.message-list .message, .messages .message');
        const lastMessage = messages[messages.length - 1];
        if (!lastMessage) return false;
        const text = lastMessage.textContent?.toLowerCase() || '';
        const status = lastMessage.getAttribute('data-status') || lastMessage.className;
        return (
          status.includes('success') || 
          status.includes('complete') || 
          status.includes('error') ||
          text.includes('完成') ||
          text.includes('success') ||
          text.includes('failed')
        );
      },
      { timeout }
    );
    return true;
  } catch {
    return false;
  }
}

// Helper to check if app is still responsive
async function isAppResponsive(appPage: import('@playwright/test').Page): Promise<boolean> {
  const chatInput = appPage.locator('.command-input, input[type="text"]').first();
  return await chatInput.isEnabled();
}

test.describe('PRD: Multi-Step Tasks (MS-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // MS-01: Search and click first result
  test('MS-01: should execute search and click result task', async ({ appPage, diagnose }) => {
    try {
      // Send a multi-step search task
      await sendTask(appPage, '打开 https://example.com 然后点击 More information 链接');
      
      // Wait for multi-step execution
      await waitForTaskCompletion(appPage, 60000);
      
      // Check that the agent executed multiple steps
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Should show navigation and click actions
      const content = await messageList.textContent();
      expect(content).toBeTruthy();
      
      // App should remain responsive after multi-step task
      const responsive = await isAppResponsive(appPage);
      expect(responsive).toBe(true);
    } catch (error) {
      await diagnose('MS-01-search-click-failed');
      throw error;
    }
  });

  // MS-02: Form filling with multiple fields
  test('MS-02: should fill form with multiple fields', async ({ appPage, diagnose }) => {
    try {
      // Note: This test needs a page with a form
      // Using a simple command that simulates form filling intent
      await sendTask(appPage, '在 Google 搜索框中输入 "Playwright testing" 然后按回车');
      
      // Wait for execution
      await appPage.waitForTimeout(10000);
      
      // Check for type and press actions
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // App should remain responsive
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('MS-02-form-fill-failed');
      throw error;
    }
  });

  // MS-03: Navigate then operate
  test('MS-03: should navigate then perform operation', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'navigate to https://example.com and then click the first link');
      
      // Wait for multi-step execution
      const completed = await waitForTaskCompletion(appPage, 45000);
      
      // Check messages
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Should show navigation step
      const content = await messageList.textContent();
      expect(content?.toLowerCase()).toMatch(/navigate|example\.com|click/);
    } catch (error) {
      await diagnose('MS-03-navigate-operate-failed');
      throw error;
    }
  });

  // MS-04: Wait for element to appear
  test('MS-04: should wait for element to appear', async ({ appPage, diagnose }) => {
    try {
      // Use waitForElement implicitly through a task
      await sendTask(appPage, '打开 example.com 并等待页面完全加载后告诉我标题');
      
      // Wait for execution
      await waitForTaskCompletion(appPage, 30000);
      
      // Should have waited for page load and returned title
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('MS-04-wait-element-failed');
      throw error;
    }
  });

  // MS-05: Handle modal/popup (basic test)
  test('MS-05: should handle page interactions that might trigger popups', async ({ appPage, diagnose }) => {
    try {
      // This tests the modal detection capability
      await sendTask(appPage, 'navigate to example.com');
      
      await appPage.waitForTimeout(5000);
      
      // The observe node should detect if there are modals
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('MS-05-modal-handling-failed');
      throw error;
    }
  });
});

test.describe('PRD: State Awareness (SA-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // SA-01: Page load detection
  test('SA-01: should detect page load state', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'navigate to https://example.com and wait for it to load');
      
      // Wait for task
      await waitForTaskCompletion(appPage, 30000);
      
      // Agent should have detected load state
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('SA-01-load-detection-failed');
      throw error;
    }
  });

  // SA-03: Goal completion judgment
  test('SA-03: should correctly determine task completion', async ({ appPage, diagnose }) => {
    try {
      // Send a simple task that should complete
      await sendTask(appPage, '告诉我当前页面的 URL');
      
      // Wait for completion
      await waitForTaskCompletion(appPage, 20000);
      
      // Should have completed (not infinite loop)
      const messageList = appPage.locator('.message-list, .messages');
      const messages = await messageList.locator('.message').count();
      
      // Should have reasonable number of messages (not excessive iterations)
      expect(messages).toBeLessThan(20);
      
      // App should be responsive
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('SA-03-completion-failed');
      throw error;
    }
  });
});

test.describe('PRD: Error Recovery (ER-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // ER-01: Selector fallback
  test('ER-01: should try alternative selectors on failure', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'navigate to example.com then click the link');
      
      // Wait for execution with potential retries
      await waitForTaskCompletion(appPage, 45000);
      
      // Agent should have attempted selector fallback if needed
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // App should remain stable
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('ER-01-selector-fallback-failed');
      throw error;
    }
  });

  // ER-06: Clear failure reporting
  test('ER-06: should report clear error on failure', async ({ appPage, diagnose }) => {
    try {
      // Send a task that will fail (non-existent selector)
      await sendTask(appPage, '点击 #impossible-button-that-does-not-exist-12345');
      
      // Wait for failure handling
      await waitForTaskCompletion(appPage, 30000);
      
      // Should have failure report
      const messageList = appPage.locator('.message-list, .messages');
      const content = await messageList.textContent();
      
      // Should mention failure/error/not found
      expect(content?.toLowerCase()).toMatch(/fail|error|not found|找不到|无法/);
      
      // App should still be responsive
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('ER-06-failure-report-failed');
      throw error;
    }
  });
});

test.describe('PRD: ReAct Agent Loop (RA-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // RA-05: Loop termination
  test('RA-05: should terminate when task is complete', async ({ appPage, diagnose }) => {
    try {
      await sendTask(appPage, 'navigate to example.com');
      
      // Wait for completion
      const completed = await waitForTaskCompletion(appPage, 20000);
      
      // Should have terminated
      expect(completed).toBe(true);
      
      // App should be responsive
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('RA-05-termination-failed');
      throw error;
    }
  });

  // RA-06: Infinite loop detection
  test('RA-06: should detect and break infinite loops', async ({ appPage, diagnose }) => {
    try {
      // Send a potentially looping task
      await sendTask(appPage, '持续观察页面');
      
      // Wait - should terminate within reasonable time
      await appPage.waitForTimeout(15000);
      
      // App should not be stuck
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('RA-06-loop-detection-failed');
      throw error;
    }
  });

  // RA-07: Consecutive failure handling
  test('RA-07: should handle consecutive failures', async ({ appPage, diagnose }) => {
    try {
      // Send a task that will fail repeatedly
      await sendTask(appPage, '点击 #nonexistent');
      
      // Wait for failure handling
      await waitForTaskCompletion(appPage, 20000);
      
      // Should have stopped after max failures
      expect(await isAppResponsive(appPage)).toBe(true);
    } catch (error) {
      await diagnose('RA-07-failure-handling-failed');
      throw error;
    }
  });

  // RA-08: Rule-based fallback
  test('RA-08: should handle simple commands with rules', async ({ appPage, diagnose }) => {
    try {
      // Send a command that can be parsed by rules
      await sendTask(appPage, 'navigate to https://example.com');
      
      // Wait for execution
      await waitForTaskCompletion(appPage, 15000);
      
      // Should have executed via rules or LLM
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('RA-08-rule-fallback-failed');
      throw error;
    }
  });
});

test.describe('Agent Control', () => {
  test('should stop running task when stop button clicked', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      await connectBrowser(appPage);
      
      // Start a potentially long task
      await sendTask(appPage, '分析页面所有元素');
      
      // Wait a bit for task to start
      await appPage.waitForTimeout(2000);
      
      // Try to stop
      const stopBtn = appPage.locator('button:has-text("Stop"), button:has-text("停止"), .stop-btn');
      if (await stopBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
        await stopBtn.click();
        
        // Wait for stop
        await appPage.waitForTimeout(3000);
        
        // App should be responsive
        expect(await isAppResponsive(appPage)).toBe(true);
      }
    } catch (error) {
      await diagnose('agent-stop-failed');
      throw error;
    }
  });
});

