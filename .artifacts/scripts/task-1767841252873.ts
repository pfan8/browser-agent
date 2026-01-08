/**
 * Generated Browser Automation Script
 * 
 * Task: 请获取当前浏览器中所有打开的标签页信息，包括每个标签页的标题和URL。使用Playwright代码来查询所有页面(pages)的详细信息。
 * Generated: 2026-01-08T03:00:52.873Z
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
    // 获取所有打开的标签页信息
    const pages = context.pages();
    const tabsInfo = [];
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        // 使用Promise.race来防止超时
        const title = await Promise.race([
          page.title(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => 'Unable to get title');
        
        const url = page.url();
        
        tabsInfo.push({
          index: i + 1,
          title: title,
          url: url
        });
      } catch (error) {
        tabsInfo.push({
          index: i + 1,
          title: 'Error getting title',
          url: page.url() || 'Unknown URL',
          error: error.message
        });
      }
    }
    
    // 存储结果到state中
    state.tabsInfo = tabsInfo;
    
    return {
      success: true,
      totalTabs: pages.length,
      tabs: tabsInfo
    };

}
