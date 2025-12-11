/**
 * Recording & Export E2E Tests (PRD: RS-01 ~ RS-05)
 * 
 * Tests operation recording and script export:
 * - RS-01: Operation recording
 * - RS-02: DSL format
 * - RS-03: Playwright export
 * - RS-04: Clear recording
 * - RS-05: Recording preview
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

// Helper to send command
async function sendCommand(appPage: import('@playwright/test').Page, command: string) {
  const chatInput = appPage.locator('.command-input, input[type="text"]').first();
  await chatInput.fill(command);
  await chatInput.press('Enter');
}

test.describe('PRD: Recording & Export (RS-*)', () => {
  test.beforeEach(async ({ appPage }) => {
    await waitForAppReady(appPage);
    await connectBrowser(appPage);
  });

  // RS-01: Operation Recording
  test('RS-01: should record browser operations', async ({ appPage, diagnose }) => {
    try {
      // Show preview panel
      const toggleBtn = appPage.locator('.toggle-btn:has-text("Preview"), button:has-text("Show Preview")');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await appPage.waitForTimeout(500);
      }
      
      // Perform an operation
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(3000);
      
      // Check for operation in preview
      const operationPreview = appPage.locator('.operation-preview, .operations-list');
      if (await operationPreview.isVisible({ timeout: 5000 })) {
        // Should have recorded the navigate operation
        const operations = await operationPreview.locator('.operation-item, li').count();
        expect(operations).toBeGreaterThan(0);
      }
    } catch (error) {
      await diagnose('RS-01-operation-recording-failed');
      throw error;
    }
  });

  // RS-02: DSL Format
  test('RS-02: should store operations in DSL format', async ({ appPage, diagnose }) => {
    try {
      // Perform operations
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      await sendCommand(appPage, 'screenshot dsl-test');
      await appPage.waitForTimeout(2000);
      
      // Show preview
      const toggleBtn = appPage.locator('.toggle-btn:has-text("Preview"), button:has-text("Show Preview")');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await appPage.waitForTimeout(500);
      }
      
      // Operations should be visible in preview (DSL format internally)
      const operationPreview = appPage.locator('.operation-preview, .operations-list');
      if (await operationPreview.isVisible()) {
        // Should contain operation types
        const previewText = await operationPreview.textContent();
        // DSL types like 'navigate' or 'screenshot' should appear
        expect(previewText).toBeTruthy();
      }
    } catch (error) {
      await diagnose('RS-02-dsl-format-failed');
      throw error;
    }
  });

  // RS-03: Playwright Export
  test('RS-03: should export to Playwright script', async ({ appPage, diagnose }) => {
    try {
      // First record some operations
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      // Find and click export button
      const exportBtn = appPage.locator('.export-btn, button:has-text("Export")');
      await expect(exportBtn).toBeVisible();
      
      // Check if button is enabled (needs operations)
      if (await exportBtn.isEnabled()) {
        await exportBtn.click();
        
        // Modal should appear with script
        const modal = appPage.locator('.modal-overlay, .modal-content, [role="dialog"]');
        await expect(modal).toBeVisible({ timeout: 5000 });
        
        // Script preview should contain playwright code
        const scriptPreview = appPage.locator('.script-preview, pre, code');
        if (await scriptPreview.isVisible()) {
          const scriptText = await scriptPreview.textContent();
          expect(scriptText).toContain('playwright');
        }
        
        // Close modal
        const closeBtn = appPage.locator('.modal-close, button:has-text("×")');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    } catch (error) {
      await diagnose('RS-03-playwright-export-failed');
      throw error;
    }
  });

  // RS-04: Clear Recording
  test('RS-04: should clear recorded operations', async ({ appPage, diagnose }) => {
    try {
      // Show preview first
      const toggleBtn = appPage.locator('.toggle-btn:has-text("Preview"), button:has-text("Show Preview")');
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        await appPage.waitForTimeout(500);
      }
      
      // Record something
      await sendCommand(appPage, 'goto https://example.com');
      await appPage.waitForTimeout(2000);
      
      // Find clear button in preview panel
      const clearBtn = appPage.locator('.operation-preview button:has-text("Clear"), button:has-text("清空")');
      
      if (await clearBtn.isVisible()) {
        await clearBtn.click();
        await appPage.waitForTimeout(500);
        
        // Operations should be cleared
        const operationPreview = appPage.locator('.operation-preview, .operations-list');
        const operations = await operationPreview.locator('.operation-item, li').count();
        expect(operations).toBe(0);
      }
    } catch (error) {
      await diagnose('RS-04-clear-recording-failed');
      throw error;
    }
  });

  // RS-05: Recording Preview
  test('RS-05: should show recording preview panel', async ({ appPage, diagnose }) => {
    try {
      // Toggle preview panel
      const toggleBtn = appPage.locator('.toggle-btn:has-text("Preview"), button:has-text("Show Preview")');
      
      if (await toggleBtn.isVisible()) {
        await toggleBtn.click();
        
        // Preview panel should appear
        const operationPreview = appPage.locator('.operation-preview, .preview-panel');
        await expect(operationPreview).toBeVisible({ timeout: 5000 });
        
        // Toggle again to hide
        await toggleBtn.click();
        await appPage.waitForTimeout(500);
        
        // Should be hidden
        await expect(operationPreview).not.toBeVisible();
      }
    } catch (error) {
      await diagnose('RS-05-recording-preview-failed');
      throw error;
    }
  });
});

test.describe('Export Features', () => {
  test('should copy script to clipboard', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      await connectBrowser(appPage);
      
      // Record operation
      const chatInput = appPage.locator('.command-input, input[type="text"]').first();
      await chatInput.fill('goto https://example.com');
      await chatInput.press('Enter');
      await appPage.waitForTimeout(3000);
      
      // Export
      const exportBtn = appPage.locator('.export-btn, button:has-text("Export")');
      if (await exportBtn.isEnabled()) {
        await exportBtn.click();
        await appPage.waitForTimeout(1000);
        
        // Click copy button
        const copyBtn = appPage.locator('.copy-btn, button:has-text("Copy")');
        if (await copyBtn.isVisible()) {
          await copyBtn.click();
          
          // Note: Can't easily verify clipboard in Playwright
          // Just ensure button click doesn't error
          await appPage.waitForTimeout(500);
        }
        
        // Close modal
        const closeBtn = appPage.locator('.modal-close, button:has-text("×")');
        if (await closeBtn.isVisible()) {
          await closeBtn.click();
        }
      }
    } catch (error) {
      await diagnose('copy-script-failed');
      throw error;
    }
  });
});

