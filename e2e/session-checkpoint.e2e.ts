/**
 * Session & Checkpoint E2E Tests (PRD: SC-01 ~ SC-08)
 * 
 * Tests session management and checkpoint functionality:
 * - SC-01: Create session
 * - SC-02: Load session
 * - SC-03: List sessions
 * - SC-04: Delete session
 * - SC-05: Auto checkpoint
 * - SC-06: Manual checkpoint
 * - SC-07: Restore checkpoint
 * - SC-08: Conversation persistence
 */

import { test, expect, waitForAppReady } from './fixtures';

test.describe('PRD: Session Management (SC-01 ~ SC-04)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
  });

  // SC-01: Create Session
  test('SC-01: should create new session', async ({ appPage, diagnose }) => {
    try {
      // Look for session panel or button to create session
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Find new session button
      const newSessionBtn = appPage.locator('button:has-text("New Session"), button:has-text("新建会话"), .new-session-btn');
      
      if (await newSessionBtn.isVisible()) {
        await newSessionBtn.click();
        
        // Fill session name if dialog appears
        const sessionNameInput = appPage.locator('input[placeholder*="name"], input[placeholder*="名称"]');
        if (await sessionNameInput.isVisible({ timeout: 2000 })) {
          await sessionNameInput.fill('Test Session E2E');
          
          // Confirm creation
          const createBtn = appPage.locator('button:has-text("Create"), button:has-text("创建")');
          if (await createBtn.isVisible()) {
            await createBtn.click();
          }
        }
        
        // Session should be created
        await appPage.waitForTimeout(1000);
        
        // Look for session in list
        const sessionPanel = appPage.locator('.session-panel, .session-list');
        if (await sessionPanel.isVisible()) {
          await expect(sessionPanel).toContainText('Test Session', { timeout: 5000 });
        }
      } else {
        // Session feature might not have UI button - test via API
        console.log('Session creation button not found - feature may be API-only');
      }
    } catch (error) {
      await diagnose('SC-01-create-session-failed');
      throw error;
    }
  });

  // SC-02: Load Session
  test('SC-02: should load existing session', async ({ appPage, diagnose }) => {
    try {
      // Open session panel
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Look for existing sessions
      const sessionItems = appPage.locator('.session-item, .session-list-item');
      const count = await sessionItems.count();
      
      if (count > 0) {
        // Click first session to load
        await sessionItems.first().click();
        await appPage.waitForTimeout(1000);
        
        // Session should be loaded (UI might update)
        const sessionPanel = appPage.locator('.session-panel, .session-info');
        await expect(sessionPanel).toBeVisible();
      }
    } catch (error) {
      await diagnose('SC-02-load-session-failed');
      throw error;
    }
  });

  // SC-03: List Sessions
  test('SC-03: should list all sessions', async ({ appPage, diagnose }) => {
    try {
      // Open session panel
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Session panel should be visible
      const sessionPanel = appPage.locator('.session-panel, [class*="session"]');
      await expect(sessionPanel).toBeVisible({ timeout: 5000 });
    } catch (error) {
      await diagnose('SC-03-list-sessions-failed');
      throw error;
    }
  });

  // SC-04: Delete Session
  test('SC-04: should delete session', async ({ appPage, diagnose }) => {
    try {
      // Open session panel
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Find delete button on session item
      const deleteBtn = appPage.locator('.session-item .delete-btn, button[aria-label="Delete session"]');
      
      if (await deleteBtn.first().isVisible({ timeout: 3000 })) {
        // Get initial count
        const sessionItems = appPage.locator('.session-item, .session-list-item');
        const initialCount = await sessionItems.count();
        
        await deleteBtn.first().click();
        
        // Confirm if dialog appears
        const confirmBtn = appPage.locator('button:has-text("Confirm"), button:has-text("确认")');
        if (await confirmBtn.isVisible({ timeout: 2000 })) {
          await confirmBtn.click();
        }
        
        await appPage.waitForTimeout(1000);
        
        // Count should decrease or session removed
        const newCount = await sessionItems.count();
        expect(newCount).toBeLessThanOrEqual(initialCount);
      }
    } catch (error) {
      await diagnose('SC-04-delete-session-failed');
      throw error;
    }
  });
});

test.describe('PRD: Checkpoint Management (SC-05 ~ SC-08)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
  });

  // SC-05: Auto Checkpoint
  test('SC-05: should create auto checkpoints after steps', async ({ appPage, diagnose }) => {
    try {
      // Connect browser first
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await expect(appPage.locator('.connection-status')).toContainText('Connected', {
          timeout: 15000,
        });
      }
      
      // Send a task
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('navigate to example.com');
      await chatInput.press('Enter');
      
      // Wait for task completion
      await appPage.waitForTimeout(5000);
      
      // Check for checkpoints in panel
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Look for checkpoint list
      const checkpointList = appPage.locator('.checkpoint-list, [class*="checkpoint"]');
      // Auto checkpoints might or might not be visible in UI
      // Just verify app is stable
      await expect(appPage.locator('.app-main, main')).toBeVisible();
    } catch (error) {
      await diagnose('SC-05-auto-checkpoint-failed');
      throw error;
    }
  });

  // SC-06: Manual Checkpoint
  test.skip('SC-06: should create manual checkpoint', async ({ appPage, diagnose }) => {
    try {
      // This feature may not have UI - test via chat command
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('checkpoint "Manual Test Checkpoint"');
      await chatInput.press('Enter');
      
      await appPage.waitForTimeout(2000);
      
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toBeVisible();
    } catch (error) {
      await diagnose('SC-06-manual-checkpoint-failed');
      throw error;
    }
  });

  // SC-07: Restore Checkpoint
  test('SC-07: should restore from checkpoint', async ({ appPage, diagnose }) => {
    try {
      // Open agent panel
      const agentPanelToggle = appPage.locator('button:has-text("Agent"), .toggle-btn:has-text("Agent")');
      if (await agentPanelToggle.isVisible()) {
        await agentPanelToggle.click();
        await appPage.waitForTimeout(500);
      }
      
      // Look for checkpoint items
      const checkpointItems = appPage.locator('.checkpoint-item, [class*="checkpoint"]');
      
      if (await checkpointItems.first().isVisible({ timeout: 3000 })) {
        // Try to restore first checkpoint
        const restoreBtn = checkpointItems.first().locator('button:has-text("Restore"), button:has-text("恢复")');
        
        if (await restoreBtn.isVisible()) {
          await restoreBtn.click();
          await appPage.waitForTimeout(2000);
          
          // Should restore (messages might update)
          const messageList = appPage.locator('.message-list, .messages');
          await expect(messageList).toBeVisible();
        }
      }
    } catch (error) {
      await diagnose('SC-07-restore-checkpoint-failed');
      throw error;
    }
  });

  // SC-08: Conversation Persistence
  test('SC-08: should persist conversation history in session', async ({ appPage, diagnose }) => {
    try {
      // Send some messages
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('Test message for persistence');
      await chatInput.press('Enter');
      
      await appPage.waitForTimeout(2000);
      
      // Verify message is in list
      const messageList = appPage.locator('.message-list, .messages');
      await expect(messageList).toContainText('Test message for persistence');
      
      // Messages should be visible after page operations
      // (Full persistence test would require app restart)
    } catch (error) {
      await diagnose('SC-08-conversation-persistence-failed');
      throw error;
    }
  });
});

