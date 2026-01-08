#!/usr/bin/env tsx
/**
 * List Browser Tabs - Connect to Chrome and display all open tabs
 *
 * Usage:
 *   pnpm tsx scripts/list-browser-tabs.ts [cdp-url]
 *
 * Prerequisites:
 *   Chrome must be running with: --remote-debugging-port=9222
 *
 * Example:
 *   # Start Chrome in debug mode:
 *   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *
 *   # Then run this script:
 *   pnpm tsx scripts/list-browser-tabs.ts
 */

import { PlaywrightAdapter } from '../packages/browser-adapter/src/playwright-adapter';

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function printHeader(title: string) {
  console.log(`\n${colors.cyan}${'='.repeat(70)}`);
  console.log(`  ${colors.bright}${title}${colors.reset}`);
  console.log(`${colors.cyan}${'='.repeat(70)}${colors.reset}\n`);
}

async function main() {
  const cdpUrl = process.argv[2] || 'http://localhost:9222';

  console.log(`${colors.blue}Connecting to Chrome browser...${colors.reset}`);
  console.log(`${colors.dim}CDP URL: ${cdpUrl}${colors.reset}\n`);

  // Create adapter
  const adapter = new PlaywrightAdapter();

  try {
    // Connect to browser
    const connectResult = await adapter.connect(cdpUrl);

    if (!connectResult.success) {
      console.error(`${colors.red}Failed to connect to browser:${colors.reset}`);
      console.error(`${colors.red}${connectResult.error}${colors.reset}\n`);
      console.log(`${colors.yellow}Make sure Chrome is running with debug mode:${colors.reset}`);
      console.log(`${colors.dim}/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222${colors.reset}\n`);
      process.exit(1);
    }

    console.log(`${colors.green}✓ Successfully connected to browser${colors.reset}\n`);

    // Get all contexts info
    const contextsInfo = await adapter.getContextsInfo();

    printHeader(`Browser Contexts (${contextsInfo.length})`);

    contextsInfo.forEach((ctx, idx) => {
      const activeMarker = ctx.isActive ? `${colors.green}[ACTIVE]${colors.reset}` : '';
      console.log(`${colors.cyan}Context ${idx}${colors.reset} ${activeMarker}`);
      console.log(`  Pages: ${ctx.pageCount}`);
      console.log();
    });

    // Get context to access pages
    const context = adapter.getContext();

    if (!context) {
      console.error(`${colors.red}No browser context available${colors.reset}`);
      process.exit(1);
    }

    // Get all pages/tabs
    const pages = context.pages();

    printHeader(`Open Tabs (${pages.length})`);

    // Helper function to get title with timeout
    async function getTitleWithTimeout(page: any, timeoutMs: number = 2000): Promise<string | null> {
      try {
        const titlePromise = page.title();
        const timeoutPromise = new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), timeoutMs)
        );
        return await Promise.race([titlePromise, timeoutPromise]);
      } catch {
        return null;
      }
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const url = page.url();

      // Skip internal Chrome pages
      const isInternalPage = url.startsWith('chrome://') ||
                            url.startsWith('chrome-extension://') ||
                            url.startsWith('about:') ||
                            url.startsWith('devtools://');

      if (isInternalPage) {
        console.log(`${colors.dim}Tab ${i}: ${url} [internal]${colors.reset}`);
        continue;
      }

      try {
        const title = await getTitleWithTimeout(page, 2000);
        console.log(`${colors.bright}Tab ${i}:${colors.reset}`);
        if (title) {
          console.log(`  ${colors.cyan}Title:${colors.reset} ${title}`);
        } else {
          console.log(`  ${colors.cyan}Title:${colors.reset} ${colors.dim}(timeout)${colors.reset}`);
        }
        console.log(`  ${colors.cyan}URL:${colors.reset}   ${url}`);
        console.log();
      } catch (error) {
        console.log(`${colors.bright}Tab ${i}:${colors.reset}`);
        console.log(`  ${colors.cyan}URL:${colors.reset} ${url}`);
        console.log(`  ${colors.dim}(Unable to get title)${colors.reset}`);
        console.log();
      }
    }

    // Disconnect
    await adapter.disconnect();
    console.log(`${colors.green}✓ Disconnected from browser${colors.reset}\n`);

  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch(console.error);
