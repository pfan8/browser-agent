/**
 * Generated Browser Automation Script
 * 
 * Task: 请获取当前浏览器中所有标签页的信息，包括标题和URL，为后续的分类展示做准备。如果可能的话，截取一个当前浏览器状态的截图。
 * Generated: 2026-01-08T02:17:39.258Z
 * Steps: 2
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
    // 获取所有标签页信息
    const pages = context.pages();
    console.log(`找到 ${pages.length} 个标签页`);
    
    const tabsInfo = [];
    
    // 遍历所有标签页获取信息
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        // 使用Promise.race来避免超时
        const title = await Promise.race([
          page.title(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
        ]).catch(() => '无法获取标题');
        
        const url = await Promise.race([
          page.url(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
        ]).catch(() => '无法获取URL');
        
        tabsInfo.push({
          index: i + 1,
          title: title,
          url: url,
          isActive: page === pages[0] // 简单判断是否为活动页面
        });
        
      } catch (error) {
        console.log(`获取第${i+1}个标签页信息时出错:`, error.message);
        tabsInfo.push({
          index: i + 1,
          title: '无法获取',
          url: '无法获取',
          error: error.message
        });
      }
    }
    
    // 保存标签页信息到状态
    state.tabsInfo = tabsInfo;
    state.totalTabs = pages.length;
    
    console.log('所有标签页信息:', tabsInfo);
    
    return {
      success: true,
      totalTabs: pages.length,
      tabsInfo: tabsInfo
    };

    // Step 2
    // 截取当前浏览器状态的截图
    try {
      const pages = context.pages();
      
      // 获取当前活跃的标签页（通常是第一个）
      let activePage = pages[0];
      
      // 如果有多个页面，尝试找到当前可见的页面
      for (let page of pages) {
        try {
          const isVisible = await Promise.race([
            page.evaluate(() => !document.hidden),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => false);
          
          if (isVisible) {
            activePage = page;
            break;
          }
        } catch (e) {
          console.log(`检查页面可见性失败: ${e.message}`);
        }
      }
      
      console.log(`准备截图当前页面: ${activePage.url()}`);
      
      // 截取当前页面的截图
      const screenshot = await Promise.race([
        activePage.screenshot({
          fullPage: false,  // 只截取可见区域
          type: 'png'
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('screenshot timeout')), 5000))
      ]);
      
      // 将截图保存到状态中
      state.screenshot = {
        data: screenshot,
        timestamp: new Date().toISOString(),
        pageUrl: activePage.url(),
        pageTitle: await Promise.race([
          activePage.title(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('title timeout')), 1000))
        ]).catch(() => 'Unknown Title')
      };
      
      return {
        success: true,
        screenshotTaken: true,
        activePageInfo: {
          url: activePage.url(),
          title: state.screenshot.pageTitle
        },
        screenshotSize: screenshot.length
      };
      
    } catch (error) {
      console.log(`截图失败: ${error.message}`);
      return {
        success: false,
        error: error.message,
        screenshotTaken: false
      };
    }

}
