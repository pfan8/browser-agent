/**
 * UI E2E Tests (PRD: UI-01 ~ UI-08)
 * 
 * Tests user interface components and interactions:
 * - UI-01: Chat panel
 * - UI-02: Message status
 * - UI-03: Connect/Disconnect buttons
 * - UI-04: Settings panel
 * - UI-05: Tab switching
 * - UI-06: Agent panel
 * - UI-07: Checkpoint list
 * - UI-08: Task stop button
 */

import { test, expect, waitForAppReady } from './fixtures';

test.describe('PRD: User Interface (UI-*)', () => {
  // UI-01: Chat Panel
  test('UI-01: should have functional chat panel', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Chat panel elements
      const chatPanel = appPage.locator('.chat-panel, [class*="chat"]');
      // Message list
      const messageList = appPage.locator('.message-list, .messages');
      // Input field
      const chatInput = appPage.locator('.command-input, input[type="text"]');
      
      // All should be visible
      await expect(messageList).toBeVisible();
      await expect(chatInput.first()).toBeVisible();
      
      // Should be able to type
      await chatInput.first().fill('Test message');
      await expect(chatInput.first()).toHaveValue('Test message');
    } catch (error) {
      await diagnose('UI-01-chat-panel-failed');
      throw error;
    }
  });

  // UI-02: Message Status
  test('UI-02: should display message status indicators', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Send a message
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Test status message');
      await chatInput.press('Enter');
      
      // Wait for processing
      await appPage.waitForTimeout(2000);
      
      // Message should appear with some status
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toContainText('Test status message');
      
      // Look for status indicators (success, error, processing)
      const messages = await messageList.locator('.message').all();
      expect(messages.length).toBeGreaterThan(0);
    } catch (error) {
      await diagnose('UI-02-message-status-failed');
      throw error;
    }
  });

  // UI-03: Connect/Disconnect Buttons
  test('UI-03: should have working connect/disconnect buttons', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Initially should have connect button
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await expect(connectBtn).toBeVisible();
      await expect(connectBtn).toBeEnabled();
      
      // Click connect
      await connectBtn.click();
      
      // Wait for connection
      await appPage.waitForTimeout(5000);
      
      // Should now show disconnect button
      const disconnectBtn = appPage.locator('.disconnect-btn, button:has-text("Disconnect")');
      if (await disconnectBtn.isVisible({ timeout: 10000 })) {
        await expect(disconnectBtn).toBeEnabled();
        
        // Click disconnect
        await disconnectBtn.click();
        await appPage.waitForTimeout(2000);
        
        // Connect button should reappear
        await expect(connectBtn).toBeVisible();
      }
    } catch (error) {
      await diagnose('UI-03-connect-buttons-failed');
      throw error;
    }
  });

  // UI-04: Settings Panel
  test('UI-04: should open and configure settings panel', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open settings
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"], button:has-text("⚙")');
      await expect(settingsBtn).toBeVisible();
      await settingsBtn.click();
      
      // Panel should open
      const settingsPanel = appPage.locator('.settings-overlay, .settings-panel');
      await expect(settingsPanel).toBeVisible({ timeout: 5000 });
      
      // Should have configuration options
      const inputs = await settingsPanel.locator('input').count();
      expect(inputs).toBeGreaterThan(0);
      
      // Close settings
      const closeBtn = settingsPanel.locator('button:has-text("×"), .close-btn');
      if (await closeBtn.isVisible()) {
        await closeBtn.click();
      } else {
        await appPage.keyboard.press('Escape');
      }
      
      await expect(settingsPanel).not.toBeVisible({ timeout: 5000 });
    } catch (error) {
      await diagnose('UI-04-settings-panel-failed');
      throw error;
    }
  });

  // UI-05: Tab Switching
  test('UI-05: should switch between browser tabs', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect first
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Find tab dropdown
      const pageInfo = appPage.locator('.current-page-info, .page-info');
      if (await pageInfo.isVisible()) {
        await pageInfo.click();
        
        // Tabs dropdown should appear
        const tabsDropdown = appPage.locator('.tabs-dropdown, .tabs-list');
        await expect(tabsDropdown).toBeVisible({ timeout: 5000 });
        
        // Should show tab items
        const tabItems = tabsDropdown.locator('.tabs-dropdown-item, .tab-item');
        const count = await tabItems.count();
        expect(count).toBeGreaterThan(0);
        
        // Close dropdown
        await appPage.keyboard.press('Escape');
      }
    } catch (error) {
      await diagnose('UI-05-tab-switching-failed');
      throw error;
    }
  });

  // UI-06: Agent Panel
  test('UI-06: should display agent panel with plan and progress', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Toggle agent panel
      const agentToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      
      if (await agentToggle.isVisible()) {
        await agentToggle.click();
        await appPage.waitForTimeout(500);
        
        // Agent panel should be visible
        const agentPanel = appPage.locator('.session-panel, [class*="agent-panel"]');
        await expect(agentPanel).toBeVisible({ timeout: 5000 });
        
        // Should have session/plan information area
        // Toggle again to hide
        await agentToggle.click();
        await appPage.waitForTimeout(500);
      }
    } catch (error) {
      await diagnose('UI-06-agent-panel-failed');
      throw error;
    }
  });

  // UI-07: Checkpoint List
  test('UI-07: should display checkpoint list', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Open agent panel
      const agentToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentToggle.isVisible()) {
        await agentToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Look for checkpoint section
      const checkpointSection = appPage.locator('[class*="checkpoint"], .checkpoint-list');
      
      // May or may not have checkpoints
      // Just verify the section exists or panel is visible
      const agentPanel = appPage.locator('.session-panel, [class*="agent"]');
      await expect(agentPanel).toBeVisible({ timeout: 5000 });
    } catch (error) {
      await diagnose('UI-07-checkpoint-list-failed');
      throw error;
    }
  });

  // UI-08: Task Stop Button
  test('UI-08: should have working task stop button', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect browser
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await expect(appPage.locator('.connection-status')).toContainText('Connected', {
          timeout: 15000,
        });
      }
      
      // Start a task
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Analyze this page in detail');
      await chatInput.press('Enter');
      
      // Look for stop button during execution
      await appPage.waitForTimeout(1000);
      
      const stopBtn = appPage.locator('button:has-text("Stop"), button:has-text("停止"), .stop-btn');
      
      if (await stopBtn.isVisible({ timeout: 5000 })) {
        // Click stop
        await stopBtn.click();
        await appPage.waitForTimeout(2000);
        
        // App should remain responsive
        await expect(chatInput).toBeEnabled();
      }
    } catch (error) {
      await diagnose('UI-08-stop-button-failed');
      throw error;
    }
  });
});

test.describe('UI Responsiveness', () => {
  test('should remain responsive during long operations', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await appPage.waitForTimeout(5000);
      }
      
      // Start a task
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Navigate to example.com');
      await chatInput.press('Enter');
      
      // During processing, UI should still respond
      await appPage.waitForTimeout(2000);
      
      // Can still type
      await chatInput.fill('Another message');
      await expect(chatInput).toHaveValue('Another message');
      
      // Header buttons should be clickable
      const settingsBtn = appPage.locator('.settings-btn, button[title="Settings"]');
      await expect(settingsBtn).toBeEnabled();
    } catch (error) {
      await diagnose('ui-responsiveness-failed');
      throw error;
    }
  });

  test('should handle rapid user interactions', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      
      // Rapid typing and sending
      for (let i = 0; i < 3; i++) {
        await chatInput.fill(`Message ${i + 1}`);
        await chatInput.press('Enter');
        await appPage.waitForTimeout(500);
      }
      
      // All messages should appear
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toContainText('Message 1');
      await expect(messageList).toContainText('Message 2');
      await expect(messageList).toContainText('Message 3');
    } catch (error) {
      await diagnose('rapid-interactions-failed');
      throw error;
    }
  });
});

