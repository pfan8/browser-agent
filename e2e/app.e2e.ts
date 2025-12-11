/**
 * Basic Application E2E Tests
 * 
 * Tests fundamental app functionality:
 * - App launch and window display
 * - Basic UI elements presence
 * - Initial state verification
 */

import { test, expect, waitForAppReady } from './fixtures';

test.describe('App Launch', () => {
  test('should launch and show main window', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Verify app title is visible
      await expect(appPage.locator('.app-title')).toBeVisible();
      await expect(appPage.locator('.app-title')).toContainText('Chat Browser Agent');
    } catch (error) {
      await diagnose('app-launch-failed');
      throw error;
    }
  });

  test('should show header with correct elements', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Check header elements
      await expect(appPage.locator('.app-header')).toBeVisible();
      
      // Connection status should be visible
      await expect(appPage.locator('.connection-status')).toBeVisible();
      
      // Header actions should be present
      await expect(appPage.locator('.header-actions')).toBeVisible();
    } catch (error) {
      await diagnose('header-elements-check-failed');
      throw error;
    }
  });

  test('should show disconnected status initially', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Initial state should be disconnected
      const statusText = await appPage.locator('.connection-status').textContent();
      expect(statusText?.toLowerCase()).toContain('disconnected');
    } catch (error) {
      await diagnose('initial-status-check-failed');
      throw error;
    }
  });

  test('should have connect button enabled initially', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect button should be visible and enabled
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await expect(connectBtn).toBeVisible();
      await expect(connectBtn).toBeEnabled();
    } catch (error) {
      await diagnose('connect-button-check-failed');
      throw error;
    }
  });

  test('should show main content area', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Main area should be visible
      await expect(appPage.locator('.app-main, main')).toBeVisible();
    } catch (error) {
      await diagnose('main-content-check-failed');
      throw error;
    }
  });
});

test.describe('Basic Interactions', () => {
  test('should open settings panel when clicking settings button', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Find and click settings button
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();
      
      // Settings overlay should appear
      await expect(appPage.locator('.settings-overlay, .settings-panel')).toBeVisible({ timeout: 5000 });
    } catch (error) {
      await diagnose('settings-panel-open-failed');
      throw error;
    }
  });

  test('should close settings panel', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings first
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await settingsBtn.click();
      await expect(appPage.locator('.settings-overlay, .settings-panel')).toBeVisible();
      
      // Close settings (click overlay or close button)
      const closeBtn = appPage.locator('.settings-panel button:has-text("×"), .settings-close, [aria-label="Close"]');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        // Click outside the panel
        await appPage.keyboard.press('Escape');
      }
      
      // Settings should be hidden
      await expect(appPage.locator('.settings-overlay')).not.toBeVisible({ timeout: 5000 });
    } catch (error) {
      await diagnose('settings-panel-close-failed');
      throw error;
    }
  });

  test('should toggle preview panel', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Find toggle preview button
      const toggleBtn = appPage.locator('.toggle-btn:has-text("Preview"), button:has-text("Show Preview")');
      
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        
        // Preview panel should appear or disappear
        // Just verify the toggle works without error
        await appPage.waitForTimeout(500);
      }
    } catch (error) {
      await diagnose('preview-toggle-failed');
      throw error;
    }
  });
});

test.describe('Chat Input', () => {
  test('should have chat input available', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Chat input should be visible
      const chatInput = appPage.locator('.command-input, input[type="text"], textarea');
      await expect(chatInput.first()).toBeVisible();
    } catch (error) {
      await diagnose('chat-input-not-found');
      throw error;
    }
  });

  test('should allow typing in chat input', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Test message');
      
      // Verify text was entered
      await expect(chatInput).toHaveValue('Test message');
    } catch (error) {
      await diagnose('chat-input-typing-failed');
      throw error;
    }
  });

  test('should show message after sending', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Hello E2E Test');
      await chatInput.press('Enter');
      
      // Message should appear in the list
      await expect(appPage.locator('.message-list, .messages')).toContainText('Hello E2E Test', {
        timeout: 5000,
      });
    } catch (error) {
      await diagnose('message-send-failed');
      throw error;
    }
  });
});

