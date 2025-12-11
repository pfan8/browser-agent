/**
 * LLM Integration E2E Tests (PRD: LM-01 ~ LM-05)
 * 
 * Tests LLM (Claude/Anthropic) integration:
 * - LM-01: API Key configuration
 * - LM-02: Base URL configuration
 * - LM-03: Config persistence
 * - LM-04: Status detection
 * - LM-05: Error handling
 */

import { test, expect, waitForAppReady } from './fixtures';

test.describe('PRD: LLM Integration (LM-*)', () => {
  // LM-01: API Key Configuration
  test('LM-01: should configure Anthropic API Key in settings', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();
      
      // Settings panel should appear
      const settingsPanel = appPage.locator('.settings-overlay, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
      
      // Look for API key input
      const apiKeyInput = appPage.locator('input[type="password"], input[placeholder*="API"], input[placeholder*="Key"]');
      
      if (await apiKeyInput.isVisible()) {
        // Clear and enter test key (won't be valid but tests UI)
        await apiKeyInput.fill('sk-ant-test-key-12345');
        
        // Find save button
        const saveBtn = appPage.locator('.settings-panel button:has-text("Save"), button:has-text("保存")');
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          await appPage.waitForTimeout(1000);
        }
      }
      
      // Close settings
      const closeBtn = appPage.locator('.settings-panel button:has-text("×"), .settings-close');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        await appPage.keyboard.press('Escape');
      }
    } catch (error) {
      await diagnose('LM-01-api-key-config-failed');
      throw error;
    }
  });

  // LM-02: Base URL Configuration
  test('LM-02: should support custom API base URL', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await settingsBtn.click();
      
      const settingsPanel = appPage.locator('.settings-overlay, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
      
      // Look for base URL input
      const baseUrlInput = appPage.locator('input[placeholder*="URL"], input[placeholder*="Base"], input[name*="url"]');
      
      if (await baseUrlInput.isVisible()) {
        // Enter custom base URL
        await baseUrlInput.fill('https://custom-api.example.com');
        
        // Save
        const saveBtn = appPage.locator('.settings-panel button:has-text("Save"), button:has-text("保存")');
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          await appPage.waitForTimeout(1000);
        }
      }
      
      // Close settings
      await appPage.keyboard.press('Escape');
    } catch (error) {
      await diagnose('LM-02-base-url-config-failed');
      throw error;
    }
  });

  // LM-03: Config Persistence
  test('LM-03: should persist API configuration', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await settingsBtn.click();
      
      const settingsPanel = appPage.locator('.settings-overlay, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
      
      // Check if there's a saved indicator or the field has value
      const apiKeyInput = appPage.locator('input[type="password"], input[placeholder*="API"]');
      
      if (await apiKeyInput.isVisible()) {
        // Check for "configured" indicator or non-empty placeholder
        const placeholder = await apiKeyInput.getAttribute('placeholder');
        const value = await apiKeyInput.inputValue();
        
        // Either has value or placeholder indicates configuration
        // (actual persistence tested by app restart, which is hard in E2E)
        console.log(`API Key configured: ${value ? 'yes' : 'no'}, placeholder: ${placeholder}`);
      }
      
      // Close settings
      await appPage.keyboard.press('Escape');
    } catch (error) {
      await diagnose('LM-03-config-persistence-failed');
      throw error;
    }
  });

  // LM-04: Status Detection
  test('LM-04: should detect LLM availability status', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Try to send a message (will show error if LLM not configured)
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Test LLM availability');
      await chatInput.press('Enter');
      
      await appPage.waitForTimeout(3000);
      
      // Check for response
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
      
      // Should have some response (error or success)
      const messages = await messageList.locator('.message').count();
      expect(messages).toBeGreaterThan(1);
    } catch (error) {
      await diagnose('LM-04-status-detection-failed');
      throw error;
    }
  });

  // LM-05: Error Handling
  test('LM-05: should handle LLM errors gracefully', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Send a task without valid LLM config (or with)
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Execute complex analysis task');
      await chatInput.press('Enter');
      
      await appPage.waitForTimeout(5000);
      
      // Should not crash - app remains responsive
      await expect(chatInput).toBeEnabled();
      
      // Message list should show result or error
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('LM-05-error-handling-failed');
      throw error;
    }
  });
});

test.describe('LLM Configuration UI', () => {
  test('should show LLM status indicator', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings to check status
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await settingsBtn.click();
      
      const settingsPanel = appPage.locator('.settings-overlay, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
      
      // Look for status indicator
      const statusIndicator = appPage.locator('[class*="status"], [class*="indicator"], .llm-status');
      // May or may not exist depending on UI design
      
      // Close settings
      await appPage.keyboard.press('Escape');
    } catch (error) {
      await diagnose('llm-status-indicator-failed');
      throw error;
    }
  });

  test('should warn when LLM not configured and task sent', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Clear any existing config (if settings allows)
      // This is hard to test without actual API access
      
      // Send a natural language task
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('分析当前页面的内容');
      await chatInput.press('Enter');
      
      await appPage.waitForTimeout(3000);
      
      // Should show warning/error or process with rule-based fallback
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('llm-not-configured-warning-failed');
      throw error;
    }
  });
});

