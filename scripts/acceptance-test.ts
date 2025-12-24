#!/usr/bin/env tsx
/**
 * Interactive Acceptance Test CLI for BC/BO Features
 * 
 * This script provides an interactive menu to manually test all
 * Browser Connection (BC-01~BC-06) and Browser Operations (BO-01~BO-10)
 * features against a real Chrome browser.
 * 
 * Prerequisites:
 * 1. Start Chrome with: --remote-debugging-port=9222
 *    Mac: /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
 *    Windows: chrome.exe --remote-debugging-port=9222
 * 
 * Usage:
 *   pnpm acceptance
 *   # or
 *   npx tsx scripts/acceptance-test.ts
 */

import * as readline from 'readline';
import { PlaywrightAdapter } from '@chat-agent/browser-adapter';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// Test result tracking
interface TestResult {
  id: string;
  name: string;
  passed: boolean;
  error?: string;
}

const testResults: TestResult[] = [];

// Helper functions
function log(message: string): void {
  console.log(message);
}

function logInfo(message: string): void {
  console.log(`${colors.cyan}ℹ${colors.reset} ${message}`);
}

function logSuccess(message: string): void {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message: string): void {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function logWarning(message: string): void {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

function logHeader(message: string): void {
  console.log(`\n${colors.bright}${colors.blue}═══ ${message} ═══${colors.reset}\n`);
}

function recordResult(id: string, name: string, passed: boolean, error?: string): void {
  testResults.push({ id, name, passed, error });
  if (passed) {
    logSuccess(`${id}: ${name} - PASSED`);
  } else {
    logError(`${id}: ${name} - FAILED${error ? `: ${error}` : ''}`);
  }
}

// Create readline interface
function createReadline(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function confirm(rl: readline.Interface, question: string): Promise<boolean> {
  const answer = await prompt(rl, `${question} (y/n): `);
  return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

async function waitForEnter(rl: readline.Interface): Promise<void> {
  await prompt(rl, '\nPress Enter to continue...');
}

// Test implementations
async function testBC01(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-01: CDP Connection');
  logInfo('Testing connection to Chrome via CDP at http://localhost:9222');
  
  const result = await adapter.connect('http://localhost:9222');
  
  if (result.success) {
    recordResult('BC-01', 'CDP Connection', true);
  } else {
    recordResult('BC-01', 'CDP Connection', false, result.error);
    logWarning('Make sure Chrome is running with --remote-debugging-port=9222');
  }
}

async function testBC02(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-02: Connection Status');
  logInfo('Checking connection status...');
  
  const status = await adapter.getStatus();
  const isConnected = adapter.isConnected();
  
  log(`  Connected: ${status.connected}`);
  log(`  isConnected(): ${isConnected}`);
  
  const passed = status.connected && isConnected;
  recordResult('BC-02', 'Connection Status', passed, passed ? undefined : 'Status not showing connected');
}

async function testBC03(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-03: Page Info');
  logInfo('Getting current page URL and title...');
  
  const pageInfo = await adapter.getPageInfo();
  
  // More prominent display for BC-03
  console.log('');
  console.log(`${colors.bright}${colors.cyan}  ┌─────────────────────────────────────────────┐${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  │ PAGE INFO:                                  │${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  │${colors.reset}   URL:   ${pageInfo.url.substring(0, 35)}${pageInfo.url.length > 35 ? '...' : ''}`);
  console.log(`${colors.bright}${colors.cyan}  │${colors.reset}   Title: ${pageInfo.title.substring(0, 35)}${pageInfo.title.length > 35 ? '...' : ''}`);
  console.log(`${colors.bright}${colors.cyan}  └─────────────────────────────────────────────┘${colors.reset}`);
  console.log('');
  
  const passed = pageInfo.url !== '' && pageInfo.title !== '';
  
  if (passed) {
    const confirmed = await confirm(rl, 'Does the page info match your browser?');
    recordResult('BC-03', 'Page Info', confirmed, confirmed ? undefined : 'User reported mismatch');
  } else {
    recordResult('BC-03', 'Page Info', false, 'Empty page info returned');
  }
}

async function testBC04(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-04: Multiple Tabs');
  logInfo('Listing all open tabs...');
  
  const pages = await adapter.listPages();
  
  log(`  Found ${pages.length} tab(s):`);
  pages.forEach((page, i) => {
    log(`    ${i}: ${page.title} (${page.url})${page.active ? ' [ACTIVE]' : ''}`);
  });
  
  if (pages.length > 1) {
    const switchTo = await prompt(rl, `Enter tab index to switch to (0-${pages.length - 1}): `);
    const index = parseInt(switchTo, 10);
    
    if (!isNaN(index) && index >= 0 && index < pages.length) {
      const result = await adapter.switchToPage(index);
      
      if (result.success) {
        logSuccess(`Switched to tab ${index}`);
        recordResult('BC-04', 'Multiple Tabs', true);
      } else {
        recordResult('BC-04', 'Multiple Tabs', false, result.error);
      }
    } else {
      logWarning('Invalid index, skipping switch test');
      recordResult('BC-04', 'Multiple Tabs', pages.length > 0);
    }
  } else {
    logInfo('Only one tab open. Open more tabs to test switching.');
    recordResult('BC-04', 'Multiple Tabs', pages.length > 0);
  }
}

async function testBC05(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-05: Disconnect');
  logInfo('Disconnecting from browser...');
  
  await adapter.disconnect();
  
  const isConnected = adapter.isConnected();
  log(`  isConnected after disconnect: ${isConnected}`);
  
  const passed = !isConnected;
  
  if (passed) {
    const browserRunning = await confirm(rl, 'Is Chrome still running? (Should be yes)');
    recordResult('BC-05', 'Disconnect', browserRunning, browserRunning ? undefined : 'Chrome closed unexpectedly');
  } else {
    recordResult('BC-05', 'Disconnect', false, 'Still showing as connected');
  }
}

async function testBC06(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BC-06: Reconnection');
  logInfo('Testing reconnection to browser...');
  
  const result = await adapter.reconnect();
  
  if (result.success) {
    const isConnected = adapter.isConnected();
    recordResult('BC-06', 'Reconnection', isConnected);
  } else {
    const lastError = adapter.getLastConnectionError();
    recordResult('BC-06', 'Reconnection', false, lastError || result.error);
  }
}

async function testBO01(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-01: Navigate');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  
  const url = await prompt(rl, 'Enter URL to navigate to (leave empty to skip): ');
  
  if (!url) {
    logWarning('No URL provided, skipping navigation test');
    recordResult('BO-01', 'Navigate', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Navigating to ${url}...`);
  
  const result = await adapter.navigate(url);
  
  if (result.success) {
    await adapter.wait(1000);
    const newPageInfo = await adapter.getPageInfo();
    log(`  Current URL: ${newPageInfo.url}`);
    
    const confirmed = await confirm(rl, 'Did the browser navigate correctly?');
    recordResult('BO-01', 'Navigate', confirmed);
  } else {
    recordResult('BO-01', 'Navigate', false, result.error);
  }
}

async function testBO02(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-02: Click');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('Make sure the current page has clickable elements.');
  
  const selector = await prompt(rl, 'Enter selector to click (e.g., a, button, #id): ');
  
  if (!selector) {
    logWarning('No selector provided, skipping click test');
    recordResult('BO-02', 'Click', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Clicking on "${selector}"...`);
  
  const result = await adapter.click(selector);
  
  if (result.success) {
    const confirmed = await confirm(rl, 'Did the click work?');
    recordResult('BO-02', 'Click', confirmed);
  } else {
    recordResult('BO-02', 'Click', false, result.error);
  }
}

async function testBO03(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-03: Type');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('Make sure the current page has an input field.');
  
  const selector = await prompt(rl, 'Enter input selector (e.g., input, textarea, #id): ');
  
  if (!selector) {
    logWarning('No selector provided, skipping type test');
    recordResult('BO-03', 'Type', true, 'Skipped by user');
    return;
  }
  
  const text = await prompt(rl, 'Enter text to type: ');
  
  if (!text) {
    logWarning('No text provided, skipping type test');
    recordResult('BO-03', 'Type', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Typing "${text}" into "${selector}"...`);
  
  const result = await adapter.type(selector, text);
  
  if (result.success) {
    const confirmed = await confirm(rl, 'Did the text appear in the input?');
    recordResult('BO-03', 'Type', confirmed);
  } else {
    recordResult('BO-03', 'Type', false, result.error);
  }
}

async function testBO04(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-04: Screenshot');
  
  logInfo('Taking a screenshot of the current page...');
  
  const result = await adapter.screenshot('acceptance_test');
  
  if (result.success) {
    const path = (result.data as any)?.path;
    log(`  Screenshot saved to: ${path}`);
    recordResult('BO-04', 'Screenshot', true);
  } else {
    recordResult('BO-04', 'Screenshot', false, result.error);
  }
}

async function testBO05(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-05: Wait');
  
  logInfo('Waiting for 2 seconds...');
  
  const startTime = Date.now();
  const result = await adapter.wait(2000);
  const elapsed = Date.now() - startTime;
  
  log(`  Waited for ${elapsed}ms`);
  
  const passed = result.success && elapsed >= 1900;
  recordResult('BO-05', 'Wait', passed, passed ? undefined : result.error);
}

async function testBO06(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-06: Press Key');
  
  const key = await prompt(rl, 'Enter key to press (default: Tab): ');
  const targetKey = key || 'Tab';
  
  logInfo(`Pressing "${targetKey}" key...`);
  
  const result = await adapter.press(targetKey);
  
  if (result.success) {
    const confirmed = await confirm(rl, 'Did the key press work?');
    recordResult('BO-06', 'Press Key', confirmed);
  } else {
    recordResult('BO-06', 'Press Key', false, result.error);
  }
}

async function testBO07(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-07: Hover');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('Make sure the current page has elements to hover over.');
  
  const selector = await prompt(rl, 'Enter selector to hover (e.g., a, button, #id): ');
  
  if (!selector) {
    logWarning('No selector provided, skipping hover test');
    recordResult('BO-07', 'Hover', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Hovering over "${selector}"...`);
  
  const result = await adapter.hover(selector);
  
  if (result.success) {
    const confirmed = await confirm(rl, 'Did the hover work?');
    recordResult('BO-07', 'Hover', confirmed);
  } else {
    recordResult('BO-07', 'Hover', false, result.error);
  }
}

async function testBO08(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-08: Select');
  
  logInfo('This test requires a page with a <select> dropdown.');
  logInfo('Navigate to such a page first, or skip this test.');
  
  const skip = await confirm(rl, 'Skip this test?');
  if (skip) {
    logWarning('Test skipped');
    recordResult('BO-08', 'Select', true, 'Skipped by user');
    return;
  }
  
  const selector = await prompt(rl, 'Enter select element selector: ');
  const value = await prompt(rl, 'Enter value to select: ');
  
  if (!selector || !value) {
    logWarning('Selector or value not provided');
    recordResult('BO-08', 'Select', false, 'Missing input');
    return;
  }
  
  logInfo(`Selecting "${value}" in "${selector}"...`);
  
  const result = await adapter.select(selector, value);
  
  if (result.success) {
    const confirmed = await confirm(rl, 'Did the selection work?');
    recordResult('BO-08', 'Select', confirmed);
  } else {
    recordResult('BO-08', 'Select', false, result.error);
  }
}

async function testBO09(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-09: Selector Strategies');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('Testing multiple selector strategies: css, text, testid, role, placeholder, label');
  
  const selector = await prompt(rl, 'Enter a selector to test (text, css, or any strategy): ');
  
  if (!selector) {
    logWarning('No selector provided, skipping selector strategies test');
    recordResult('BO-09', 'Selector Strategies', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Testing selector: "${selector}"`);
  const result = await adapter.click(selector);
  
  if (result.success) {
    logSuccess('Selector strategy worked!');
    const confirmed = await confirm(rl, 'Did the click work as expected?');
    recordResult('BO-09', 'Selector Strategies', confirmed);
  } else {
    logWarning(`Selector failed: ${result.error}`);
    recordResult('BO-09', 'Selector Strategies', false, result.error);
  }
}

async function testBO10(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-10: Selector Fallback');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('Testing selector fallback mechanism...');
  logInfo('This tests that when one selector fails, alternatives are tried.');
  
  const selector = await prompt(rl, 'Enter a selector that might need fallback (e.g., partial text): ');
  
  if (!selector) {
    logWarning('No selector provided, skipping fallback test');
    recordResult('BO-10', 'Selector Fallback', true, 'Skipped by user');
    return;
  }
  
  logInfo(`Testing selector with fallback: "${selector}"`);
  const result = await adapter.click(selector);
  
  if (result.success) {
    logSuccess('Selector fallback worked - found element using one of the strategies');
    const confirmed = await confirm(rl, 'Did it find the element?');
    recordResult('BO-10', 'Selector Fallback', confirmed);
  } else {
    logInfo('Element not found after trying all strategies');
    log(`  Error: ${result.error}`);
    
    const confirmed = await confirm(rl, 'Did the error message show element was not found after fallback attempts?');
    recordResult('BO-10', 'Selector Fallback', confirmed);
  }
}

async function testBO11(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-11: Go Back');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('This will navigate back in browser history.');
  logInfo('Make sure you have browsed at least 2 pages to have history.');
  
  const proceed = await confirm(rl, 'Go back in history?');
  
  if (!proceed) {
    recordResult('BO-11', 'Go Back', true, 'Skipped by user');
    return;
  }
  
  logInfo('Going back...');
  const result = await adapter.goBack();
  
  if (result.success) {
    await adapter.wait(1000);
    const newPageInfo = await adapter.getPageInfo();
    log(`  New URL: ${newPageInfo.url}`);
    
    const confirmed = await confirm(rl, 'Did the browser go back correctly?');
    recordResult('BO-11', 'Go Back', confirmed);
  } else {
    recordResult('BO-11', 'Go Back', false, result.error);
  }
}

async function testBO12(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-12: Go Forward');
  
  const pageInfo = await adapter.getPageInfo();
  logInfo(`Current page: ${pageInfo.url}`);
  logInfo('This will navigate forward in browser history.');
  logInfo('Make sure you have gone back first to have forward history.');
  
  const proceed = await confirm(rl, 'Go forward in history?');
  
  if (!proceed) {
    recordResult('BO-12', 'Go Forward', true, 'Skipped by user');
    return;
  }
  
  logInfo('Going forward...');
  const result = await adapter.goForward();
  
  if (result.success) {
    await adapter.wait(1000);
    const newPageInfo = await adapter.getPageInfo();
    log(`  New URL: ${newPageInfo.url}`);
    
    const confirmed = await confirm(rl, 'Did the browser go forward correctly?');
    recordResult('BO-12', 'Go Forward', confirmed);
  } else {
    recordResult('BO-12', 'Go Forward', false, result.error);
  }
}

async function testBO13(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('BO-13: Close Tab');
  
  const pages = await adapter.listPages();
  log(`  Found ${pages.length} tab(s):`);
  pages.forEach((page, i) => {
    log(`    ${i}: ${page.title} (${page.url})${page.active ? ' [ACTIVE]' : ''}`);
  });
  
  if (pages.length <= 1) {
    logWarning('Only one tab open. Cannot test close tab without losing connection.');
    recordResult('BO-13', 'Close Tab', true, 'Skipped - only 1 tab');
    return;
  }
  
  const indexStr = await prompt(rl, `Enter tab index to close (0-${pages.length - 1}), or leave empty to skip: `);
  
  if (!indexStr) {
    recordResult('BO-13', 'Close Tab', true, 'Skipped by user');
    return;
  }
  
  const index = parseInt(indexStr, 10);
  
  if (isNaN(index) || index < 0 || index >= pages.length) {
    logWarning('Invalid index');
    recordResult('BO-13', 'Close Tab', false, 'Invalid index');
    return;
  }
  
  logInfo(`Closing tab ${index}...`);
  const result = await adapter.closePage(index);
  
  if (result.success) {
    const newPages = await adapter.listPages();
    log(`  Remaining tabs: ${newPages.length}`);
    
    const confirmed = await confirm(rl, 'Did the tab close correctly?');
    recordResult('BO-13', 'Close Tab', confirmed);
  } else {
    recordResult('BO-13', 'Close Tab', false, result.error);
  }
}

// Main menu
async function showMainMenu(rl: readline.Interface): Promise<string> {
  console.log(`
${colors.bright}${colors.cyan}╔═══════════════════════════════════════════════════════════════╗
║         BC/BO Acceptance Test - Interactive CLI               ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}

${colors.bright}Browser Connection Tests:${colors.reset}
  1. BC-01: CDP Connection
  2. BC-02: Connection Status
  3. BC-03: Page Info
  4. BC-04: Multiple Tabs
  5. BC-05: Disconnect
  6. BC-06: Reconnection

${colors.bright}Browser Operation Tests:${colors.reset}
  7.  BO-01: Navigate
  8.  BO-02: Click
  9.  BO-03: Type
  10. BO-04: Screenshot
  11. BO-05: Wait
  12. BO-06: Press Key
  13. BO-07: Hover
  14. BO-08: Select
  15. BO-09: Selector Strategies
  16. BO-10: Selector Fallback
  17. BO-11: Go Back
  18. BO-12: Go Forward
  19. BO-13: Close Tab

${colors.bright}Other:${colors.reset}
  a. Run All Tests
  s. Show Summary
  q. Quit
`);

  return prompt(rl, 'Select option: ');
}

function showSummary(): void {
  logHeader('Test Summary');
  
  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;
  const total = testResults.length;
  
  console.log(`${colors.bright}Total: ${total} | ${colors.green}Passed: ${passed}${colors.reset} | ${colors.red}Failed: ${failed}${colors.reset}`);
  console.log('');
  
  if (testResults.length === 0) {
    logWarning('No tests have been run yet.');
    return;
  }
  
  console.log('Detailed Results:');
  testResults.forEach(result => {
    const status = result.passed 
      ? `${colors.green}PASS${colors.reset}` 
      : `${colors.red}FAIL${colors.reset}`;
    const error = result.error && !result.passed ? ` - ${result.error}` : '';
    console.log(`  [${status}] ${result.id}: ${result.name}${error}`);
  });
}

async function runAllTests(adapter: PlaywrightAdapter, rl: readline.Interface): Promise<void> {
  logHeader('Running All Tests');
  logWarning('This will run all BC and BO tests in sequence.');
  
  const proceed = await confirm(rl, 'Continue?');
  if (!proceed) return;
  
  // BC Tests
  await testBC01(adapter, rl);
  if (!adapter.isConnected()) {
    logError('Cannot continue - not connected to browser');
    return;
  }
  await testBC02(adapter, rl);
  await testBC03(adapter, rl);
  await testBC04(adapter, rl);
  await testBC05(adapter, rl);
  await testBC06(adapter, rl);
  
  // BO Tests
  if (!adapter.isConnected()) {
    logError('Cannot continue - not connected to browser');
    return;
  }
  await testBO01(adapter, rl);
  await testBO02(adapter, rl);
  await testBO03(adapter, rl);
  await testBO04(adapter, rl);
  await testBO05(adapter, rl);
  await testBO06(adapter, rl);
  await testBO07(adapter, rl);
  await testBO08(adapter, rl);
  await testBO09(adapter, rl);
  await testBO10(adapter, rl);
  await testBO11(adapter, rl);
  await testBO12(adapter, rl);
  await testBO13(adapter, rl);
  
  showSummary();
}

async function main(): Promise<void> {
  console.clear();
  console.log(`
${colors.bright}${colors.blue}
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   Chat Browser Agent - BC/BO Acceptance Testing               ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
${colors.reset}
${colors.yellow}Prerequisites:${colors.reset}
  1. Start Chrome with remote debugging:
     ${colors.cyan}Mac:${colors.reset} /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222
     ${colors.cyan}Win:${colors.reset} chrome.exe --remote-debugging-port=9222

  2. Make sure Chrome is running before starting tests.
`);

  const adapter = new PlaywrightAdapter({
    screenshotPath: './recordings',
  });
  
  const rl = createReadline();
  
  let running = true;
  
  while (running) {
    const choice = await showMainMenu(rl);
    
    switch (choice.toLowerCase()) {
      case '1':
        await testBC01(adapter, rl);
        break;
      case '2':
        await testBC02(adapter, rl);
        break;
      case '3':
        await testBC03(adapter, rl);
        break;
      case '4':
        await testBC04(adapter, rl);
        break;
      case '5':
        await testBC05(adapter, rl);
        break;
      case '6':
        await testBC06(adapter, rl);
        break;
      case '7':
        await testBO01(adapter, rl);
        break;
      case '8':
        await testBO02(adapter, rl);
        break;
      case '9':
        await testBO03(adapter, rl);
        break;
      case '10':
        await testBO04(adapter, rl);
        break;
      case '11':
        await testBO05(adapter, rl);
        break;
      case '12':
        await testBO06(adapter, rl);
        break;
      case '13':
        await testBO07(adapter, rl);
        break;
      case '14':
        await testBO08(adapter, rl);
        break;
      case '15':
        await testBO09(adapter, rl);
        break;
      case '16':
        await testBO10(adapter, rl);
        break;
      case '17':
        await testBO11(adapter, rl);
        break;
      case '18':
        await testBO12(adapter, rl);
        break;
      case '19':
        await testBO13(adapter, rl);
        break;
      case 'a':
        await runAllTests(adapter, rl);
        break;
      case 's':
        showSummary();
        break;
      case 'q':
        running = false;
        break;
      default:
        logWarning('Invalid option');
    }
    
    if (running && choice !== 's') {
      await waitForEnter(rl);
    }
  }
  
  showSummary();
  
  // Cleanup
  if (adapter.isConnected()) {
    await adapter.disconnect();
  }
  rl.close();
  
  console.log(`\n${colors.cyan}Goodbye!${colors.reset}\n`);
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

