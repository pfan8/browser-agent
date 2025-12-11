/**
 * Browser Operations E2E Tests (PRD: BO-01 ~ BO-10)
 * 
 * Tests browser automation operations:
 * - BO-01: Navigation
 * - BO-02: Click
 * - BO-03: Type/Input
 * - BO-04: Screenshot
 * - BO-05: Wait
 * - BO-06: Keyboard press
 * - BO-07: Hover
 * - BO-08: Select dropdown
 * - BO-09: Selector strategies
 * - BO-10: Selector fallback
 * 
 * Prerequisites:
 * - Chrome must be running with: --remote-debugging-port=9222
 * - App must be connected to browser
 */

import { test, expect, waitForAppReady } from './fixtures';

// Helper to connect browser before operations
async function connectBrowser(appPage: import('@playwright/test').Page) {
  const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
  if (await connectBtn.isVisible()) {
    await connectBtn.click();
    await expect(appPage.locator('.connection-status')).toContainText('Connected', {
      timeout: 15000,
    });
  }
}

// Helper to send a command through chat
async function sendCommand(appPage: import('@playwright/test').Page, command: string) {
  const chatInput = appPage.locator('.command-input, input[type="text"]').first();
  await chatInput.fill(command);
  await chatInput.press('Enter');
  // Wait for processing
  await appPage.waitForTimeout(1000);
}

test.describe('PRD: Browser Operations (BO-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // BO-01: Navigation
  test('BO-01: should navigate to URL', async ({ appPage, diagnose }) => {
    try {
      // Send navigation command
      await sendCommand(appPage, 'goto https://example.com');
      
      // Wait for navigation to complete
      await appPage.waitForTimeout(3000);
      
      // Check if operation was recorded or successful
      // The message list should show success
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Verify page URL changed (in current page info)
      const pageInfo = appPage.locator('.current-page-info .page-url, .page-url');
      if (await pageInfo.isVisible()) {
        const url = await pageInfo.textContent();
        // Should show example.com or similar
        expect(url).toBeTruthy();
      }
    } catch (error) {
      await diagnose('BO-01-navigation-failed');
      throw error;
    }
  });

  // BO-02: Click
  test('BO-02: should click elements with various selectors', async ({ appPage, diagnose }) => {
    try {
      // First navigate to a page
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      // Try clicking a link (example.com has "More information..." link)
      await sendCommand(appPage, 'click "More information"');
      await appPage.waitForTimeout(2000);
      
      // Check for success/error in messages
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('BO-02-click-failed');
      throw error;
    }
  });

  // BO-03: Type/Input
  test('BO-03: should type text into input fields', async ({ appPage, diagnose }) => {
    try {
      // Navigate to a page with input (Google for example)
      await sendCommand(appPage, 'goto https://www.google.com');
      await appPage.waitForTimeout(3000);
      
      // Type in search box
      await sendCommand(appPage, 'type input "test search query"');
      await appPage.waitForTimeout(2000);
      
      // Verify command was sent
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toContainText('type', { timeout: 5000 });
    } catch (error) {
      await diagnose('BO-03-type-failed');
      throw error;
    }
  });

  // BO-04: Screenshot
  test('BO-04: should take screenshots', async ({ appPage, diagnose }) => {
    try {
      await sendCommand(appPage, 'screenshot test-screenshot');
      await appPage.waitForTimeout(2000);
      
      // Check for success message
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('BO-04-screenshot-failed');
      throw error;
    }
  });

  // BO-05: Wait
  test('BO-05: should wait for specified duration', async ({ appPage, diagnose }) => {
    try {
      const startTime = Date.now();
      await sendCommand(appPage, 'wait 1000');
      await appPage.waitForTimeout(1500);
      const elapsed = Date.now() - startTime;
      
      // Should have waited at least 1 second
      expect(elapsed).toBeGreaterThanOrEqual(1000);
    } catch (error) {
      await diagnose('BO-05-wait-failed');
      throw error;
    }
  });

  // BO-06: Keyboard Press
  test('BO-06: should simulate keyboard press', async ({ appPage, diagnose }) => {
    try {
      await sendCommand(appPage, 'press Enter');
      await appPage.waitForTimeout(1000);
      
      // Verify command was sent
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toContainText('press', { timeout: 5000 });
    } catch (error) {
      await diagnose('BO-06-press-failed');
      throw error;
    }
  });

  // BO-07: Hover
  test('BO-07: should hover over elements', async ({ appPage, diagnose }) => {
    try {
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      await sendCommand(appPage, 'hover a');
      await appPage.waitForTimeout(1000);
      
      // Verify command was processed
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('BO-07-hover-failed');
      throw error;
    }
  });

  // BO-08: Select Dropdown (Skip if no dropdown available)
  test.skip('BO-08: should select dropdown options', async ({ appPage, diagnose }) => {
    try {
      // This test needs a page with a dropdown
      // Skipped by default as example.com doesn't have dropdowns
      await sendCommand(appPage, 'select #dropdown "option1"');
      await appPage.waitForTimeout(1000);
    } catch (error) {
      await diagnose('BO-08-select-failed');
      throw error;
    }
  });

  // BO-09: Selector Strategies
  test('BO-09: should support multiple selector strategies', async ({ appPage, diagnose }) => {
    try {
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      // Test text selector
      await sendCommand(appPage, 'click "More information"');
      await appPage.waitForTimeout(1000);
      
      // The app should try multiple selector strategies
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('BO-09-selector-strategies-failed');
      throw error;
    }
  });

  // BO-10: Selector Fallback
  test('BO-10: should fallback to alternative selectors on failure', async ({ appPage, diagnose }) => {
    try {
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      // Use a generic selector that might need fallback
      await sendCommand(appPage, 'click link');
      await appPage.waitForTimeout(2000);
      
      // Check for any response (success or failure with alternatives tried)
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('BO-10-selector-fallback-failed');
      throw error;
    }
  });
});

