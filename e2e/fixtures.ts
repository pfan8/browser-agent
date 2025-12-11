/**
 * E2E Test Fixtures for Electron Application
 * 
 * Provides:
 * - electronApp: Electron application instance
 * - appPage: Main window page for interactions
 * - diagnose: Helper function for collecting debug information
 */

import { test as base, expect, ElectronApplication, Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// Test fixture types
type TestFixtures = {
  electronApp: ElectronApplication;
  appPage: Page;
  diagnose: (context: string) => Promise<void>;
};

// Extend base test with Electron fixtures
export const test = base.extend<TestFixtures>({
  // Electron application fixture
  electronApp: async ({}, use) => {
    const appPath = path.join(__dirname, '..', 'dist-electron', 'main.js');
    
    // Check if the app is built
    if (!fs.existsSync(appPath)) {
      throw new Error(
        `Electron app not built. Run "pnpm build" first.\n` +
        `Expected: ${appPath}\n` +
        `Hint: Use "pnpm test:e2e:debug" which auto-builds before testing.`
      );
    }

    // Launch Electron app
    const app = await electron.launch({
      args: [appPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        ELECTRON_ENABLE_LOGGING: '1',
      },
    });

    // Collect main process stdout
    app.process().stdout?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log(`[MAIN] ${text}`);
      }
    });

    // Collect main process stderr
    app.process().stderr?.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[MAIN-ERR] ${text}`);
      }
    });

    await use(app);
    
    // Cleanup
    await app.close();
  },

  // Main window page fixture
  appPage: async ({ electronApp }, use) => {
    // Wait for the first window
    const window = await electronApp.firstWindow();
    
    // Wait for app to be ready
    await window.waitForLoadState('domcontentloaded');

    // Collect renderer console logs
    window.on('console', (msg) => {
      const type = msg.type().toUpperCase();
      const text = msg.text();
      // Only log meaningful messages
      if (text && !text.includes('DevTools')) {
        console.log(`[RENDERER-${type}] ${text}`);
      }
    });

    // Collect page errors
    window.on('pageerror', (error) => {
      console.error(`[PAGE_ERROR] ${error.message}`);
    });

    await use(window);
  },

  // Diagnostic helper fixture
  diagnose: async ({ appPage }, use) => {
    const diagnoseFn = async (context: string) => {
      const timestamp = Date.now();
      const safeContext = context.replace(/[^a-zA-Z0-9-_]/g, '-');
      
      console.log(`\n===== DIAGNOSIS: ${context} =====`);

      // Ensure diagnostics directory exists
      const diagnosticsDir = path.join(__dirname, '..', 'test-results', 'diagnostics');
      fs.mkdirSync(diagnosticsDir, { recursive: true });

      // 1. Take screenshot
      const screenshotPath = path.join(diagnosticsDir, `${timestamp}-${safeContext}.png`);
      try {
        await appPage.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`Screenshot: ${screenshotPath}`);
      } catch (e) {
        console.log(`Screenshot failed: ${e}`);
      }

      // 2. Log current URL
      try {
        console.log(`URL: ${appPage.url()}`);
      } catch {
        console.log(`URL: Unable to get`);
      }

      // 3. Get page title
      try {
        const title = await appPage.title();
        console.log(`Title: ${title}`);
      } catch {
        console.log(`Title: Unable to get`);
      }

      // 4. Get visible interactive elements
      try {
        const buttons = await appPage.locator('button:visible').allTextContents();
        const inputs = await appPage.locator('input:visible').count();
        console.log(`Visible buttons: ${JSON.stringify(buttons.slice(0, 10))}`);
        console.log(`Visible inputs: ${inputs}`);
      } catch {
        console.log(`Elements: Unable to get`);
      }

      // 5. Check for error elements
      try {
        const errorElements = await appPage.locator('[class*="error"], .error, [data-error]').allTextContents();
        if (errorElements.length > 0) {
          console.log(`Error elements found: ${JSON.stringify(errorElements)}`);
        }
      } catch {
        // Ignore
      }

      // 6. Get DOM snapshot (abbreviated)
      try {
        const bodyHTML = await appPage.evaluate(() => {
          const body = document.body;
          return body ? body.innerHTML.substring(0, 3000) : 'No body';
        });
        console.log(`DOM (first 3000 chars):\n${bodyHTML}`);
      } catch {
        console.log(`DOM: Unable to get`);
      }

      console.log(`===== END DIAGNOSIS =====\n`);
    };

    await use(diagnoseFn);
  },
});

// Re-export expect for convenience
export { expect };

// Helper function to wait for app to be fully ready
export async function waitForAppReady(page: Page, timeout = 10000): Promise<void> {
  await page.waitForLoadState('domcontentloaded', { timeout });
  
  // Wait for main title to appear
  await page.waitForSelector('.app-title', { timeout });
}

// Helper function to check if browser is connected
export async function isBrowserConnected(page: Page): Promise<boolean> {
  try {
    const status = await page.locator('.connection-status').textContent();
    return status?.toLowerCase().includes('connected') ?? false;
  } catch {
    return false;
  }
}

// Helper to get current page info from the app
export async function getAppPageInfo(page: Page): Promise<{ url: string; title: string } | null> {
  try {
    const urlElement = await page.locator('.page-url').textContent();
    const titleElement = await page.locator('.page-title').textContent();
    return {
      url: urlElement || '',
      title: titleElement || '',
    };
  } catch {
    return null;
  }
}

