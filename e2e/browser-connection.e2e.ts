/**
 * Browser Connection E2E Tests (PRD: BC-01 ~ BC-06)
 * 
 * Tests CDP browser connection functionality:
 * - BC-01: CDP connection
 * - BC-02: Connection status display
 * - BC-03: Page info retrieval
 * - BC-04: Multi-tab support
 * - BC-05: Graceful disconnect
 * - BC-06: Reconnection
 * 
 * Prerequisites:
 * - Chrome must be running with: --remote-debugging-port=9222
 */

import { test, expect, waitForAppReady, isBrowserConnected } from './fixtures';

test.describe('PRD: Browser Connection (BC-*)', () => {
  // BC-01: CDP Connection
  test('BC-01: should connect to browser via CDP', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Click connect button
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await expect(connectBtn).toBeVisible();
      await connectBtn.click();
      
      // Wait for connection (may take a few seconds)
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Verify disconnect button appears
      await expect(appPage.locator('.disconnect-btn, button:has-text("Disconnect")')).toBeVisible();
    } catch (error) {
      await diagnose('BC-01-cdp-connection-failed');
      throw error;
    }
  });

  // BC-02: Connection Status Display
  test('BC-02: should display correct connection status', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Initial state: Disconnected
      await expect(appPage.locator('.connection-status')).toContainText('Disconnected');
      
      // After connect: Connected
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // After disconnect: Disconnected again
      const disconnectBtn = appPage.locator('.disconnect-btn, button:has-text("Disconnect")');
      await disconnectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Disconnected', {
        timeout: 5000,
      });
    } catch (error) {
      await diagnose('BC-02-status-display-failed');
      throw error;
    }
  });

  // BC-03: Page Info Retrieval
  test('BC-03: should retrieve page info after connection', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect first
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Page info should be displayed
      const pageInfo = appPage.locator('.current-page-info, .page-info');
      await expect(pageInfo).toBeVisible({ timeout: 10000 });
      
      // URL should be non-empty
      const pageUrl = appPage.locator('.page-url');
      if (await pageUrl.isVisible()) {
        const urlText = await pageUrl.textContent();
        expect(urlText).toBeTruthy();
        expect(urlText?.length).toBeGreaterThan(0);
      }
    } catch (error) {
      await diagnose('BC-03-page-info-failed');
      throw error;
    }
  });

  // BC-04: Multi-Tab Support
  test('BC-04: should list and switch browser tabs', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect first
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Click on page info to show tabs dropdown
      const pageInfo = appPage.locator('.current-page-info, .page-info');
      await expect(pageInfo).toBeVisible({ timeout: 10000 });
      await pageInfo.click();
      
      // Tabs dropdown should appear
      const tabsDropdown = appPage.locator('.tabs-dropdown, .tabs-list');
      await expect(tabsDropdown).toBeVisible({ timeout: 5000 });
      
      // Should show at least one tab
      const tabItems = appPage.locator('.tabs-dropdown-item, .tab-item');
      const tabCount = await tabItems.count();
      expect(tabCount).toBeGreaterThanOrEqual(1);
    } catch (error) {
      await diagnose('BC-04-multi-tab-failed');
      throw error;
    }
  });

  // BC-05: Graceful Disconnect
  test('BC-05: should disconnect without affecting browser', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Disconnect
      const disconnectBtn = appPage.locator('.disconnect-btn, button:has-text("Disconnect")');
      await disconnectBtn.click();
      
      // Should be disconnected
      await expect(appPage.locator('.connection-status')).toContainText('Disconnected', {
        timeout: 5000,
      });
      
      // Connect button should reappear
      await expect(appPage.locator('.connect-btn, button:has-text("Connect")')).toBeVisible();
      
      // Note: We can't easily verify the browser is still running from here,
      // but the fact that we can reconnect (next test) proves it
    } catch (error) {
      await diagnose('BC-05-graceful-disconnect-failed');
      throw error;
    }
  });

  // BC-06: Reconnection
  test('BC-06: should allow reconnection after disconnect', async ({ appPage, diagnose }) => {
    try {
      await waitForAppReady(appPage);
      
      // Connect
      let connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
      
      // Disconnect
      const disconnectBtn = appPage.locator('.disconnect-btn, button:has-text("Disconnect")');
      await disconnectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Disconnected', {
        timeout: 5000,
      });
      
      // Reconnect
      connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 15000,
      });
    } catch (error) {
      await diagnose('BC-06-reconnection-failed');
      throw error;
    }
  });
});

// Helper test to verify Chrome debug mode is running
test.describe('Browser Connection Prerequisites', () => {
  test.skip('should have Chrome running in debug mode', async ({ appPage, diagnose }) => {
    // This test is skipped by default - it's a manual check
    // Run manually when debugging connection issues
    try {
      await waitForAppReady(appPage);
      
      const connectBtn = appPage.locator('.connect-btn, button:has-text("Connect")');
      await connectBtn.click();
      
      // If this times out, Chrome is not running with --remote-debugging-port=9222
      await expect(appPage.locator('.connection-status')).toContainText('Connected', {
        timeout: 5000,
      });
    } catch (error) {
      await diagnose('chrome-debug-mode-check');
      throw new Error(
        'Chrome debug mode not available. Start Chrome with:\n' +
        '/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222'
      );
    }
  });
});

