/**
 * Generated Browser Automation Script
 * 
 * Task: 请获取当前浏览器中打开的所有标签页信息，包括每个标签页的标题和URL。使用Playwright代码来实现这个功能。
 * Generated: 2026-01-08T02:38:08.136Z
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
    // Get all pages (tabs) from the browser context
    const pages = context.pages();
    const tabsInfo = [];
    
    // Iterate through each page to get title and URL
    for (const page of pages) {
      try {
        // Use Promise.race with timeout to avoid blocking
        const title = await Promise.race([
          page.title(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => 'Unable to get title');
        
        const url = page.url();
        
        tabsInfo.push({
          title: title,
          url: url
        });
      } catch (error) {
        tabsInfo.push({
          title: 'Error getting title',
          url: page.url() || 'Unknown URL',
          error: error.message
        });
      }
    }
    
    // Store the result in state for potential future use
    state.tabsInfo = tabsInfo;
    
    return {
      success: true,
      totalTabs: tabsInfo.length,
      tabs: tabsInfo
    };

}
