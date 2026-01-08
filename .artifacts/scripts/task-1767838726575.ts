/**
 * Generated Browser Automation Script
 * 
 * Task: 请使用已存储在state中的tabsInfo数据，对这30个标签页进行分类展示。请按照以下要求：
1. 根据网站域名和内容类型对标签页进行智能分类（如：社交媒体、开发工具、新闻、购物、教育等）
2. 创建一个清晰的分类展示界面，显示每个分类下的标签页
3. 每个标签页显示标题和URL
4. 统计每个分类的标签页数量
5. 可以考虑在浏览器中创建一个新的HTML页面来展示分类结果
 * Generated: 2026-01-08T02:18:46.575Z
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
    // Get all open pages and collect their information
    const pages = context.pages();
    const tabsInfo = [];
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        // Use Promise.race to handle potential timeouts
        const title = await Promise.race([
          page.title(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => 'Unknown Title');
        
        const url = page.url();
        
        tabsInfo.push({
          index: i,
          title: title,
          url: url,
          domain: new URL(url).hostname
        });
      } catch (error) {
        // Handle any errors and continue with next page
        tabsInfo.push({
          index: i,
          title: 'Error loading page',
          url: page.url() || 'about:blank',
          domain: 'unknown'
        });
      }
    }
    
    // Store the collected data
    state.tabsInfo = tabsInfo;
    
    return {
      success: true,
      tabCount: tabsInfo.length,
      sample: tabsInfo.slice(0, 3) // Show first 3 as sample
    };

}
