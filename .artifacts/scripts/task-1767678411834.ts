/**
 * Generated Browser Automation Script
 * 
 * Task: Please perform the following browser automation task:
1. Open a new tab
2. Navigate to https://devepdocs.zoomdev.us/
3. Wait for the page to load completely
4. Take a screenshot to show the current state of the page

This is the first step in a multi-step process where I need to explore the document list and test hover functionality.
 * Generated: 2026-01-06T05:46:51.834Z
 * Steps: 1
 */

import { Page, BrowserContext } from 'playwright';

interface ExecutionContext {
    page: Page;
    context: BrowserContext;
    variables: Record<string, unknown>;
}

export async function execute(ctx: ExecutionContext): Promise<void> {
    const { page, context, variables } = ctx;
    
    // Step 1
    // Open a new tab and navigate to the specified URL
    const page = await context.newPage();
    
    // Navigate to the URL
    await page.goto('https://devepdocs.zoomdev.us/');
    
    // Wait for the page to load completely
    // We'll wait for the network to be idle and for the main content to be visible
    await page.waitForLoadState('networkidle');
    
    // Also wait for any dynamic content to load by checking for common page elements
    try {
      await page.waitForSelector('body', { timeout: 5000 });
    } catch (error) {
      console.log('Body selector timeout, but continuing...');
    }
    
    // Take a screenshot
    const screenshot = await page.screenshot({ fullPage: true });
    
    // Store the page and screenshot in state for future use
    state.currentPage = page;
    state.screenshot = screenshot;
    state.pageUrl = 'https://devepdocs.zoomdev.us/';
    
    // Get page title and basic info for confirmation
    const title = await page.title();
    const url = page.url();
    
    return {
      success: true,
      title: title,
      url: url,
      screenshotTaken: true,
      message: 'Successfully opened new tab, navigated to the URL, waited for page load, and took screenshot'
    };

}
