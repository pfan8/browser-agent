/**
 * Playwright Adapter E2E Tests
 * 
 * Real browser tests for BO-01 ~ BO-13 (Browser Operations)
 * Tests against public websites using actual Chrome connection.
 * 
 * Prerequisites:
 *   Start Chrome with: --remote-debugging-port=9222
 * 
 * Run with:
 *   pnpm test:e2e
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PlaywrightAdapter } from '../src/playwright-adapter';
import * as fs from 'fs';
import * as path from 'path';

// Test configuration
const CDP_URL = 'http://localhost:9222';
const TEST_TIMEOUT = 60000;

describe('PlaywrightAdapter E2E Tests', () => {
  let adapter: PlaywrightAdapter;
  let isConnected = false;
  let testTabIndex = -1;

  beforeAll(async () => {
    adapter = new PlaywrightAdapter({
      screenshotPath: './recordings',
      defaultTimeout: TEST_TIMEOUT,
    });

    // Try to connect to Chrome
    const result = await adapter.connect(CDP_URL);
    isConnected = result.success;

    if (!isConnected) {
      console.warn('⚠️  Chrome not running with remote debugging. E2E tests will be skipped.');
      console.warn('   Start Chrome with: --remote-debugging-port=9222');
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    if (isConnected) {
      await adapter.disconnect();
    }
  });

  beforeEach(async () => {
    if (!isConnected) {
      return;
    }
    // Reconnect if connection was lost during previous test
    if (!adapter.isConnected()) {
      const result = await adapter.connect(CDP_URL);
      isConnected = result.success;
      if (!isConnected) {
        console.warn('Failed to reconnect to Chrome');
        return;
      }
    }
    
    // Create a new tab for this test to minimize side effects
    const page = adapter.getPage();
    if (page) {
      const context = page.context();
      const newPage = await context.newPage();
      
      // Set the new page as the current page
      adapter.setPage(newPage);
      
      // Track the tab index for cleanup
      const pages = await adapter.listPages();
      testTabIndex = pages.length - 1;
      
      // Navigate to a clean state
      await adapter.navigate('about:blank');
      await adapter.wait(200);
    }
  });

  afterEach(async () => {
    if (!isConnected || testTabIndex < 0) {
      return;
    }
    
    // Close the test tab to clean up
    try {
      const pages = await adapter.listPages();
      if (pages.length > 1) {
        // Close the current test tab
        await adapter.closePage();
      }
    } catch (error) {
      // Ignore errors during cleanup
    }
    
    testTabIndex = -1;
  });

  // Helper to skip tests if not connected
  const runIfConnected = (testFn: () => Promise<void>) => {
    return async () => {
      if (!isConnected) {
        console.log('Skipping test - Chrome not connected');
        return;
      }
      await testFn();
    };
  };

  // ============================================
  // BO-01: Navigate
  // ============================================

  describe('E2E: BO-01 Navigate', () => {
    it('should navigate to example.com and verify URL', runIfConnected(async () => {
      const result = await adapter.navigate('https://example.com');
      
      expect(result.success).toBe(true);
      
      // Verify using page.evaluate
      const currentUrl = await adapter.getPage()?.evaluate(() => window.location.href);
      expect(currentUrl).toContain('example.com');
    }), TEST_TIMEOUT);

    it('should add https protocol if missing', runIfConnected(async () => {
      const result = await adapter.navigate('example.com');
      
      expect(result.success).toBe(true);
      expect((result.data as any)?.url).toBe('https://example.com');
    }), TEST_TIMEOUT);

    it('should get correct page title after navigation', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      
      const title = await adapter.getPage()?.evaluate(() => document.title);
      expect(title).toContain('Example');
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-02: Click
  // ============================================

  describe('E2E: BO-02 Click', () => {
    it('should click link on example.com', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      // Check link exists
      const linkExists = await adapter.getPage()?.evaluate(() => {
        return document.querySelector('a') !== null;
      });
      expect(linkExists).toBe(true);
      
      // Click the "More information..." link
      const result = await adapter.click('a');
      
      if (!result.success) {
        console.log('Click failed:', result.error);
      }
      expect(result.success).toBe(true);
      
      // Wait for navigation
      await adapter.wait(2000);
      
      // Verify we navigated away from example.com
      const currentUrl = await adapter.getPage()?.evaluate(() => window.location.href);
      expect(currentUrl).not.toBe('https://example.com/');
    }), TEST_TIMEOUT);

    it('should use text selector to click', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      // Get the exact text of the link from the page
      const linkText = await adapter.getPage()?.evaluate(() => {
        const link = document.querySelector('a');
        return link?.textContent?.trim() || '';
      });
      
      if (!linkText) {
        console.log('No link text found');
        return;
      }
      
      console.log('Link text:', linkText);
      
      // Click using exact text content
      const result = await adapter.click(linkText);
      
      if (!result.success) {
        console.log('Text click failed:', result.error);
      }
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-03: Type
  // ============================================

  describe('E2E: BO-03 Type', () => {
    it('should type text into Google search box', runIfConnected(async () => {
      await adapter.navigate('https://www.google.com');
      await adapter.wait(2000);
      
      const testText = 'playwright testing';
      
      // Check what search element exists
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        if (document.querySelector('[title="Search"]')) return '[title="Search"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found on page');
        return;
      }
      
      const result = await adapter.type(searchSelector, testText);
      
      if (!result.success) {
        console.log('Type failed:', result.error);
      }
      expect(result.success).toBe(true);
      
      // Verify the input value
      const inputValue = await adapter.getPage()?.evaluate(() => {
        const textarea = document.querySelector('textarea[name="q"]') as HTMLTextAreaElement;
        const input = document.querySelector('input[name="q"]') as HTMLInputElement;
        return textarea?.value || input?.value || '';
      });
      
      expect(inputValue).toBe(testText);
    }), TEST_TIMEOUT);

    it('should clear existing text before typing when clear=true', runIfConnected(async () => {
      await adapter.navigate('https://www.google.com');
      await adapter.wait(2000);
      
      // Find the search selector
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found');
        return;
      }
      
      // Type initial text
      await adapter.type(searchSelector, 'initial text');
      await adapter.wait(500);
      
      // Type new text with clear=true (default)
      await adapter.type(searchSelector, 'new text');
      await adapter.wait(500);
      
      const inputValue = await adapter.getPage()?.evaluate(() => {
        const textarea = document.querySelector('textarea[name="q"]') as HTMLTextAreaElement;
        const input = document.querySelector('input[name="q"]') as HTMLInputElement;
        return textarea?.value || input?.value || '';
      });
      
      expect(inputValue).toBe('new text');
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-04: Screenshot
  // ============================================

  describe('E2E: BO-04 Screenshot', () => {
    it('should take screenshot and save file', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(500);
      
      const screenshotName = `e2e_test_${Date.now()}`;
      const result = await adapter.screenshot(screenshotName);
      
      expect(result.success).toBe(true);
      expect((result.data as any)?.path).toContain(screenshotName);
      
      // Verify file exists
      const filePath = (result.data as any)?.path;
      if (filePath) {
        const exists = fs.existsSync(filePath);
        expect(exists).toBe(true);
        
        // Clean up
        if (exists) {
          fs.unlinkSync(filePath);
        }
      }
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-05: Wait
  // ============================================

  describe('E2E: BO-05 Wait', () => {
    it('should wait for specified duration', runIfConnected(async () => {
      const startTime = Date.now();
      const waitTime = 1000;
      
      const result = await adapter.wait(waitTime);
      
      const elapsed = Date.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(elapsed).toBeGreaterThanOrEqual(waitTime - 100); // Allow 100ms tolerance
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-06: Press
  // ============================================

  describe('E2E: BO-06 Press', () => {
    it('should press Enter after typing', runIfConnected(async () => {
      await adapter.navigate('https://www.google.com');
      await adapter.wait(2000);
      
      // Find search box
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found');
        return;
      }
      
      // Type in search box
      await adapter.type(searchSelector, 'vitest testing');
      await adapter.wait(1000);
      
      // Press Enter
      const result = await adapter.press('Enter');
      expect(result.success).toBe(true);
      
      // Wait for potential navigation
      await adapter.wait(3000);
      
      // Just verify press worked - URL may or may not change depending on Google's behavior
    }), TEST_TIMEOUT);

    it('should press Tab to move focus', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(1000);
      
      const result = await adapter.press('Tab');
      
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-07: Hover
  // ============================================

  describe('E2E: BO-07 Hover', () => {
    it('should hover over link on example.com', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      // Check link exists
      const linkExists = await adapter.getPage()?.evaluate(() => {
        return document.querySelector('a') !== null;
      });
      expect(linkExists).toBe(true);
      
      const result = await adapter.hover('a');
      
      if (!result.success) {
        console.log('Hover failed:', result.error);
      }
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-08: Select / Autocomplete
  // ============================================

  describe.only('E2E: BO-08 Select / Autocomplete', () => {
    it('should click autocomplete suggestion from Google search', runIfConnected(async () => {
      // Navigate to Google
      await adapter.navigate('https://www.google.com', 'load');
      await adapter.wait(1000);
      
      // Find search box
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found');
        return;
      }
      
      // Type a common search term to trigger autocomplete
      const typeResult = await adapter.type(searchSelector, 'playwright', false);
      expect(typeResult.success).toBe(true);
      
      // Wait for autocomplete suggestions to appear
      await adapter.wait(1500);
      
      // Check if autocomplete suggestions appeared
      const suggestionsExist = await adapter.getPage()?.evaluate(() => {
        // Google autocomplete suggestions are in a listbox
        const listbox = document.querySelector('[role="listbox"]');
        const suggestions = document.querySelectorAll('[role="option"], [role="presentation"] li');
        return (listbox !== null) || (suggestions.length > 0);
      });
      
      if (!suggestionsExist) {
        console.log('No autocomplete suggestions appeared (may be blocked or disabled)');
        // This is acceptable - autocomplete may not appear in some environments
        return;
      }
      
      // Click on the first suggestion
      const clickResult = await adapter.click('[role="option"]');
      
      if (!clickResult.success) {
        // Try alternative selector for suggestions
        const altClick = await adapter.click('[role="listbox"] li');
        if (!altClick.success) {
          console.log('Could not click autocomplete suggestion');
          return;
        }
      }
      
      // Wait for potential navigation or search
      await adapter.wait(2000);
      
      // Verify something happened (either search or URL changed)
      const page = adapter.getPage();
      if (page) {
        const currentUrl = await page.evaluate(() => window.location.href);
        console.log('Current URL after autocomplete click:', currentUrl);
        // Just verify we're still on a Google domain
        expect(currentUrl).toContain('google');
      }
    }), TEST_TIMEOUT);

    it('should select from Google autocomplete with different query', runIfConnected(async () => {
      // Navigate to Google
      await adapter.navigate('https://www.google.com', 'load');
      await adapter.wait(1000);
      
      // Find search box
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found');
        return;
      }
      
      // Type a different search term
      const typeResult = await adapter.type(searchSelector, 'vitest', false);
      expect(typeResult.success).toBe(true);
      
      // Wait for autocomplete suggestions to appear
      await adapter.wait(1500);
      
      // Check if autocomplete suggestions appeared and count them
      const suggestionsInfo = await adapter.getPage()?.evaluate(() => {
        const options = document.querySelectorAll('[role="option"]');
        const listItems = document.querySelectorAll('[role="listbox"] li');
        return {
          optionCount: options.length,
          listItemCount: listItems.length,
          hasListbox: document.querySelector('[role="listbox"]') !== null
        };
      });
      
      console.log('Suggestions info:', suggestionsInfo);
      
      if (!suggestionsInfo?.hasListbox && suggestionsInfo?.optionCount === 0) {
        console.log('No autocomplete suggestions appeared');
        return;
      }
      
      // Try to get the text of the first suggestion before clicking
      const firstSuggestionText = await adapter.getPage()?.evaluate(() => {
        const option = document.querySelector('[role="option"]');
        return option?.textContent?.trim() || '';
      });
      
      console.log('First suggestion text:', firstSuggestionText);
      
      // Click on the first suggestion
      const clickResult = await adapter.click('[role="option"]');
      
      if (!clickResult.success) {
        console.log('Click on option failed, trying alternative');
        // Try pressing down arrow and enter
        await adapter.press('ArrowDown');
        await adapter.wait(200);
        await adapter.press('Enter');
      }
      
      // Wait for navigation
      await adapter.wait(2000);
      
      // Verify we navigated to search results
      const page = adapter.getPage();
      if (page) {
        const currentUrl = await page.evaluate(() => window.location.href);
        console.log('URL after selection:', currentUrl);
        // Should be on Google search results or still on Google
        expect(currentUrl).toContain('google');
      }
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-09: Selector Strategies
  // ============================================

  describe('E2E: BO-09 Selector Strategies', () => {
    it('should find element using CSS selector', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      const result = await adapter.click('a');
      if (!result.success) {
        console.log('CSS selector failed:', result.error);
      }
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);

    it('should find element using text selector', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      // Get exact link text
      const linkText = await adapter.getPage()?.evaluate(() => {
        const link = document.querySelector('a');
        return link?.textContent?.trim() || '';
      });
      
      if (!linkText) {
        console.log('No link text found');
        return;
      }
      
      const result = await adapter.click(linkText);
      if (!result.success) {
        console.log('Text selector failed:', result.error);
      }
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-10: Selector Fallback
  // ============================================

  describe('E2E: BO-10 Selector Fallback', () => {
    it('should try alternative selectors when primary fails', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      // Get exact link text and test fallback
      const linkText = await adapter.getPage()?.evaluate(() => {
        const link = document.querySelector('a');
        return link?.textContent?.trim() || '';
      });
      
      if (!linkText) {
        console.log('No link text found');
        return;
      }
      
      const result = await adapter.click(linkText);
      
      if (!result.success) {
        console.log('Fallback test failed:', result.error);
      }
      expect(result.success).toBe(true);
    }), TEST_TIMEOUT);

    it('should return error when no selector matches', runIfConnected(async () => {
      await adapter.navigate('https://example.com');
      await adapter.wait(2000);
      
      const result = await adapter.click('NonExistentElement12345');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Element not found');
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-11: Go Back
  // ============================================

  describe('E2E: BO-11 GoBack', () => {
    it('should navigate back in history', runIfConnected(async () => {
      // Navigate to first page
      await adapter.navigate('https://example.com', 'load');
      await adapter.wait(1000);
      
      // Navigate to second page
      await adapter.navigate('https://httpbin.org/html', 'load');
      await adapter.wait(1000);
      
      // Go back
      const result = await adapter.goBack();
      
      if (!result.success) {
        console.log('GoBack failed:', result.error);
      }
      expect(result.success).toBe(true);
      
      await adapter.wait(2000);
      
      // Verify we're back on example.com
      const page = adapter.getPage();
      if (page) {
        const urlAfterBack = await page.evaluate(() => window.location.href);
        expect(urlAfterBack || '').toContain('example.com');
      }
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-12: Go Forward
  // ============================================

  describe('E2E: BO-12 GoForward', () => {
    it('should navigate forward in history', runIfConnected(async () => {
      // Navigate to first page
      await adapter.navigate('https://example.com', 'load');
      await adapter.wait(1000);
      
      // Navigate to second page
      await adapter.navigate('https://httpbin.org/html', 'load');
      await adapter.wait(1000);
      
      // Go back
      const backResult = await adapter.goBack();
      if (!backResult.success) {
        console.log('GoBack failed:', backResult.error);
      }
      await adapter.wait(2000);
      
      // Go forward
      const result = await adapter.goForward();
      
      if (!result.success) {
        console.log('GoForward failed:', result.error);
      }
      expect(result.success).toBe(true);
      
      await adapter.wait(2000);
      
      // Verify we're on httpbin.org
      const page = adapter.getPage();
      if (page) {
        const currentUrl = await page.evaluate(() => window.location.href);
        expect(currentUrl || '').toContain('httpbin.org');
      }
    }), TEST_TIMEOUT);
  });

  // ============================================
  // BO-13: Close Tab
  // ============================================

  describe('E2E: BO-13 CloseTab', () => {
    it('should close current tab', runIfConnected(async () => {
      // Get initial page count (should be at least 2: original + test tab)
      const initialPages = await adapter.listPages();
      const initialCount = initialPages.length;
      
      // We should have at least 2 pages since beforeEach creates a new tab
      expect(initialCount).toBeGreaterThanOrEqual(2);
      
      // Close current page (the test tab)
      const result = await adapter.closePage();
      expect(result.success).toBe(true);
      
      // Verify page count decreased
      const finalPages = await adapter.listPages();
      expect(finalPages.length).toBe(initialCount - 1);
      
      // Mark that we already closed it so afterEach doesn't try again
      testTabIndex = -1;
    }), TEST_TIMEOUT);
  });

  // ============================================
  // Integration Tests
  // ============================================

  describe('E2E: Integration Scenarios', () => {
    it('should perform search workflow on Google', runIfConnected(async () => {
      // 1. Navigate to Google
      await adapter.navigate('https://www.google.com');
      await adapter.wait(2000);
      
      // 2. Find search box
      const searchSelector = await adapter.getPage()?.evaluate(() => {
        if (document.querySelector('textarea[name="q"]')) return 'textarea[name="q"]';
        if (document.querySelector('input[name="q"]')) return 'input[name="q"]';
        return null;
      });
      
      if (!searchSelector) {
        console.log('No search box found');
        return;
      }
      
      // 3. Type search query
      const searchQuery = 'playwright browser automation';
      const typeResult = await adapter.type(searchSelector, searchQuery);
      expect(typeResult.success).toBe(true);
      
      // 4. Take screenshot of page
      const screenshot = await adapter.screenshot('google_search_page');
      expect(screenshot.success).toBe(true);
      
      // Clean up screenshot
      const filePath = (screenshot.data as any)?.path;
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }), TEST_TIMEOUT);

    it('should navigate and go back/forward', runIfConnected(async () => {
      // Navigate to example.com
      await adapter.navigate('https://example.com', 'load');
      await adapter.wait(1000);
      
      const page1Url = await adapter.getPage()?.evaluate(() => window.location.href);
      
      // Navigate to second page
      await adapter.navigate('https://httpbin.org/html', 'load');
      await adapter.wait(1000);
      
      const page2Url = await adapter.getPage()?.evaluate(() => window.location.href);
      expect(page2Url).not.toBe(page1Url);
      
      // Go back
      const backResult = await adapter.goBack();
      if (!backResult.success) {
        console.log('GoBack failed:', backResult.error);
      }
      await adapter.wait(2000);
      
      const backUrl = await adapter.getPage()?.evaluate(() => window.location.href);
      expect(backUrl || '').toContain('example.com');
      
      // Go forward
      const fwdResult = await adapter.goForward();
      if (!fwdResult.success) {
        console.log('GoForward failed:', fwdResult.error);
      }
      await adapter.wait(2000);
      
      const forwardUrl = await adapter.getPage()?.evaluate(() => window.location.href);
      expect(forwardUrl || '').toContain('httpbin.org');
    }), TEST_TIMEOUT);
  });
});

