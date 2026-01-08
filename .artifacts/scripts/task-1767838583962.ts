/**
 * Generated Browser Automation Script
 * 
 * Task: 获取当前浏览器中所有打开的标签页信息，包括标签页标题、URL等详细信息。请使用Playwright代码来实现这个功能。
 * Generated: 2026-01-08T02:16:23.962Z
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
    // 获取当前浏览器中所有打开的标签页信息
    try {
      // 获取所有已打开的页面
      const pages = context.pages();
      console.log(`找到 ${pages.length} 个打开的标签页`);
      
      // 存储所有标签页信息
      const tabsInfo = [];
      
      // 遍历每个页面，获取详细信息
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        
        try {
          // 使用Promise.race来处理可能的超时
          const [title, url] = await Promise.all([
            Promise.race([
              page.title(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
            ]).catch(() => '无法获取标题'),
            
            Promise.race([
              page.url(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
            ]).catch(() => '无法获取URL')
          ]);
          
          // 获取页面的其他信息
          const isClosed = page.isClosed();
          
          tabsInfo.push({
            index: i + 1,
            title: title,
            url: url,
            isClosed: isClosed,
            timestamp: new Date().toISOString()
          });
          
          console.log(`标签页 ${i + 1}: ${title} - ${url}`);
          
        } catch (error) {
          console.log(`获取标签页 ${i + 1} 信息时出错: ${error.message}`);
          tabsInfo.push({
            index: i + 1,
            title: '获取失败',
            url: '获取失败',
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }
      
      // 将结果存储到状态中
      state.tabsInfo = tabsInfo;
      state.totalTabs = pages.length;
      
      return {
        success: true,
        totalTabs: pages.length,
        tabsInfo: tabsInfo,
        summary: `成功获取了 ${pages.length} 个标签页的信息`
      };
      
    } catch (error) {
      console.error('获取标签页信息时发生错误:', error);
      return {
        success: false,
        error: error.message,
        message: '获取标签页信息失败'
      };
    }

}
