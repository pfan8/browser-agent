/**
 * Generated Browser Automation Script
 * 
 * Task: 请使用已存储在state中的标签页信息(state.tabsInfo)来实现标签页分类展示功能。需要：1）根据标签页的URL和标题对30个标签页进行智能分类（如：工作、娱乐、学习、购物、社交媒体等）2）创建一个清晰的分类展示页面，显示每个分类下的标签页列表 3）每个标签页显示标题、URL和可点击的链接。请确保代码正确执行并避免解析错误。
 * Generated: 2026-01-08T02:20:04.154Z
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
    // First, let's get all open pages and collect tab information
    const pages = context.pages();
    console.log(`Found ${pages.length} pages`);
    
    // Collect information from all tabs
    const tabsInfo = [];
    
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      try {
        // Use Promise.race to handle potential timeouts
        const pageInfo = await Promise.race([
          (async () => {
            const title = await page.title();
            const url = page.url();
            return { title, url, index: i };
          })(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('timeout')), 2000)
          )
        ]);
        
        tabsInfo.push(pageInfo);
      } catch (error) {
        // If we can't get info from a page, add basic info
        tabsInfo.push({
          title: `Tab ${i + 1} (unavailable)`,
          url: 'about:blank',
          index: i
        });
      }
    }
    
    // Store the tabs information in state
    state.tabsInfo = tabsInfo;
    
    console.log('Collected tabs info:', tabsInfo.length, 'tabs');
    return { success: true, tabsCount: tabsInfo.length, tabsInfo };

    // Step 2
    // Get the stored tabs information
    const tabsInfo = state.tabsInfo;
    console.log('Total tabs:', tabsInfo.length);
    console.log('Sample tabs:', tabsInfo.slice(0, 5));
    
    // Smart categorization function based on URL and title
    function categorizeTabs(tabs) {
      const categories = {
        'Work & Development': [],
        'Entertainment': [],
        'Learning & Education': [],
        'Shopping': [],
        'Social Media': [],
        'News & Media': [],
        'Tools & Utilities': [],
        'Other': []
      };
    
      tabs.forEach(tab => {
        const url = tab.url.toLowerCase();
        const title = tab.title.toLowerCase();
        
        // Work & Development patterns
        if (url.includes('github') || url.includes('gitlab') || url.includes('zoom') || url.includes('slack') || 
            url.includes('jira') || url.includes('confluence') || url.includes('trello') || url.includes('asana') ||
            title.includes('app-center') || title.includes('pipeline') || title.includes('deploy') ||
            url.includes('corp.') || url.includes('dev') || url.includes('api') || url.includes('docs')) {
          categories['Work & Development'].push(tab);
        }
        // Entertainment patterns
        else if (url.includes('youtube') || url.includes('netflix') || url.includes('spotify') || url.includes('twitch') ||
                 url.includes('hulu') || url.includes('disney') || url.includes('amazon') && url.includes('prime') ||
                 title.includes('video') || title.includes('music') || title.includes('game')) {
          categories['Entertainment'].push(tab);
        }
        // Learning & Education patterns
        else if (url.includes('coursera') || url.includes('udemy') || url.includes('khan') || url.includes('edx') ||
                 url.includes('stackoverflow') || url.includes('mdn') || url.includes('w3schools') ||
                 url.includes('tutorial') || title.includes('learn') || title.includes('course') ||
                 url.includes('education') || url.includes('university') || url.includes('.edu')) {
          categories['Learning & Education'].push(tab);
        }
        // Shopping patterns
        else if (url.includes('amazon') || url.includes('ebay') || url.includes('shop') || url.includes('buy') ||
                 url.includes('cart') || url.includes('checkout') || url.includes('store') || url.includes('mall') ||
                 title.includes('shop') || title.includes('buy') || title.includes('price')) {
          categories['Shopping'].push(tab);
        }
        // Social Media patterns
        else if (url.includes('facebook') || url.includes('twitter') || url.includes('instagram') || url.includes('linkedin') ||
                 url.includes('reddit') || url.includes('discord') || url.includes('telegram') || url.includes('whatsapp') ||
                 url.includes('social') || title.includes('chat') || title.includes('message')) {
          categories['Social Media'].push(tab);
        }
        // News & Media patterns
        else if (url.includes('news') || url.includes('cnn') || url.includes('bbc') || url.includes('reuters') ||
                 url.includes('techcrunch') || url.includes('verge') || url.includes('medium') ||
                 title.includes('news') || title.includes('article') || title.includes('blog')) {
          categories['News & Media'].push(tab);
        }
        // Tools & Utilities patterns
        else if (url.includes('google') && (url.includes('drive') || url.includes('docs') || url.includes('sheets')) ||
                 url.includes('dropbox') || url.includes('onedrive') || url.includes('notion') ||
                 url.includes('calculator') || url.includes('translate') || url.includes('weather') ||
                 title.includes('tool') || title.includes('utility')) {
          categories['Tools & Utilities'].push(tab);
        }
        // Everything else goes to Other
        else {
          categories['Other'].push(tab);
        }
      });
    
      return categories;
    }
    
    // Categorize all tabs
    const categorizedTabs = categorizeTabs(tabsInfo);
    
    // Store categorized data
    state.categorizedTabs = categorizedTabs;
    
    // Show categorization summary
    const summary = {};
    for (const [category, tabs] of Object.entries(categorizedTabs)) {
      summary[category] = tabs.length;
    }
    
    return {
      success: true,
      totalTabs: tabsInfo.length,
      categorySummary: summary,
      sampleCategories: Object.keys(categorizedTabs).reduce((acc, key) => {
        if (categorizedTabs[key].length > 0) {
          acc[key] = categorizedTabs[key].slice(0, 2).map(tab => ({ title: tab.title, url: tab.url.substring(0, 50) + '...' }));
        }
        return acc;
      }, {})
    };

}
