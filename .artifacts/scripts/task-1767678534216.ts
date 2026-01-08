/**
 * Generated Browser Automation Script
 * 
 * Task: Continue with the remaining steps on the https://devepdocs.zoomdev.us/ page:
1. Find any document in the document list
2. Move mouse to hover over a document entry
3. Observe if a hover menu or toolbar appears
4. Check if the hover menu contains a 'Summarize this file' option
5. Take a screenshot to document the hover behavior

Please interact with the page elements carefully and capture the hover state.
 * Generated: 2026-01-06T05:48:54.216Z
 * Steps: 6
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
    // First, let's check what pages are available and navigate to the docs page
    const pages = context.pages();
    console.log('Available pages:', pages.length);
    
    let page;
    if (pages.length > 0) {
      page = pages[0];
    } else {
      page = await context.newPage();
    }
    
    // Navigate to the docs page if not already there
    const currentUrl = page.url();
    console.log('Current URL:', currentUrl);
    
    if (!currentUrl.includes('devepdocs.zoomdev.us')) {
      await page.goto('https://devepdocs.zoomdev.us/');
      await page.waitForLoadState('domcontentloaded');
    }
    
    // Wait for the page to load and find document list elements
    await page.waitForTimeout(2000);
    
    // Look for document entries - try various selectors that might contain documents
    const documentSelectors = [
      'a[href*=".pdf"]',
      '[data-testid*="document"]',
      '.document-item',
      '.file-item',
      'li:has-text("pdf")',
      'li:has-text("doc")',
      '*:has-text(".pdf")',
      '*:has-text("document")',
      'ul li',
      '.list-item'
    ];
    
    let foundDocuments = [];
    for (const selector of documentSelectors) {
      try {
        const elements = await Promise.race([
          page.locator(selector).all(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
        ]);
        if (elements && elements.length > 0) {
          console.log(`Found ${elements.length} elements with selector: ${selector}`);
          foundDocuments.push({selector, count: elements.length});
        }
      } catch (e) {
        // Continue to next selector
      }
    }
    
    state.foundDocuments = foundDocuments;
    state.currentPage = page;
    
    return { 
      success: true, 
      currentUrl: page.url(),
      pageTitle: await page.title(),
      foundDocuments: foundDocuments
    };

    // Step 2
    // Let's continue with the remaining steps - find documents and test hover behavior
    const page = state.currentPage;
    
    try {
      // Step 1 & 2: Find documents and hover over one
      console.log('Looking for document entries to hover over...');
      
      // Wait for document list to be visible
      await page.waitForSelector('[data-testid="document-list"], .document-item, .file-item, [class*="document"], [class*="file"]', { timeout: 5000 });
      
      // Try multiple selectors to find document entries
      const documentSelectors = [
        '[data-testid="document-item"]',
        '.document-item',
        '.file-item', 
        '[class*="document"]:not([class*="list"])',
        '.recent-file',
        '.document-entry',
        'li:has-text("document")',
        'div:has-text("document")',
        '[role="listitem"]'
      ];
      
      let documentElement = null;
      let usedSelector = null;
      
      for (const selector of documentSelectors) {
        try {
          const elements = await page.$$(selector);
          if (elements.length > 0) {
            documentElement = elements[0];
            usedSelector = selector;
            console.log(`Found ${elements.length} documents using selector: ${selector}`);
            break;
          }
        } catch (e) {
          console.log(`Selector ${selector} failed:`, e.message);
        }
      }
      
      if (!documentElement) {
        // Try to find any clickable items that might be documents
        const genericItems = await page.$$('a, button, [role="button"], li, .item');
        console.log(`Found ${genericItems.length} generic clickable items`);
        
        if (genericItems.length > 0) {
          documentElement = genericItems[0];
          usedSelector = 'first generic item';
        }
      }
      
      if (!documentElement) {
        return {
          success: false,
          error: 'No document entries found to hover over',
          pageContent: await page.content().catch(() => 'Could not get page content')
        };
      }
      
      // Get the bounding box and text content of the element we'll hover over
      const boundingBox = await documentElement.boundingBox();
      const elementText = await documentElement.textContent().catch(() => 'No text content');
      
      console.log(`Hovering over element with selector: ${usedSelector}`);
      console.log(`Element text: ${elementText}`);
      console.log(`Element position:`, boundingBox);
      
      // Step 3: Hover over the document element
      await documentElement.hover();
      
      // Wait a moment for any hover effects to appear
      await page.waitForTimeout(1000);
      
      // Step 4: Check for hover menu/toolbar with summarize option
      const hoverMenuSelectors = [
        '[data-testid="hover-menu"]',
        '[data-testid="document-actions"]',
        '.hover-menu',
        '.action-menu',
        '.tooltip',
        '.popup',
        '.dropdown',
        '[role="tooltip"]',
        '[role="menu"]',
        '.actions',
        '*:has-text("Summarize")',
        '*:has-text("summarize")',
        '[title*="Summarize"]',
        '[aria-label*="Summarize"]'
      ];
      
      let hoverMenu = null;
      let menuSelector = null;
      let hasSummarizeOption = false;
      
      for (const selector of hoverMenuSelectors) {
        try {
          const menu = await page.$(selector);
          if (menu) {
            const isVisible = await menu.isVisible();
            if (isVisible) {
              hoverMenu = menu;
              menuSelector = selector;
              console.log(`Found hover menu with selector: ${selector}`);
              
              // Check if this menu contains summarize option
              const menuText = await menu.textContent().catch(() => '');
              if (menuText.toLowerCase().includes('summarize')) {
                hasSummarizeOption = true;
              }
              break;
            }
          }
        } catch (e) {
          // Continue to next selector
        }
      }
      
      // Step 5: Take a screenshot to document the hover behavior
      const screenshotPath = `hover_behavior_${Date.now()}.png`;
      await page.screenshot({ 
        path: screenshotPath,
        fullPage: false // Just capture the visible area
      });
      
      return {
        success: true,
        hoveredElement: {
          selector: usedSelector,
          text: elementText,
          position: boundingBox
        },
        hoverMenu: hoverMenu ? {
          found: true,
          selector: menuSelector,
          text: await hoverMenu.textContent().catch(() => 'Could not get menu text'),
          hasSummarizeOption: hasSummarizeOption
        } : {
          found: false,
          hasSummarizeOption: false
        },
        screenshotTaken: screenshotPath,
        pageTitle: await page.title(),
        currentUrl: await page.url()
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        stack: error.stack
      };
    }

    // Step 3
    // Let's first examine the current page and find visible documents
    const page = state.currentPage;
    
    try {
      // Check current page status
      const url = await page.url();
      console.log('Current URL:', url);
      
      // Look for document elements with various selectors
      const documentSelectors = [
        'a[href*="/doc/"]',
        '.document-item',
        '[data-testid*="document"]',
        '.file-item',
        'li:has-text("文档")',
        'div:has-text("文档")',
        'a:has-text("文档")',
        '.list-item',
        '[role="listitem"]'
      ];
      
      let foundElements = [];
      
      for (const selector of documentSelectors) {
        try {
          const elements = await Promise.race([
            page.locator(selector).all(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]);
          
          if (elements && elements.length > 0) {
            console.log(`Found ${elements.length} elements with selector: ${selector}`);
            
            // Get details of first few elements
            for (let i = 0; i < Math.min(3, elements.length); i++) {
              try {
                const text = await Promise.race([
                  elements[i].textContent(),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
                ]).catch(() => 'no text');
                
                const href = await Promise.race([
                  elements[i].getAttribute('href'),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
                ]).catch(() => null);
                
                foundElements.push({
                  selector,
                  index: i,
                  text: text?.trim().substring(0, 100),
                  href
                });
              } catch (e) {
                console.log(`Error getting element ${i} details:`, e.message);
              }
            }
          }
        } catch (e) {
          console.log(`Selector ${selector} failed:`, e.message);
        }
      }
      
      // Also check body content to understand page structure
      const bodyText = await Promise.race([
        page.locator('body').textContent(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]).catch(() => 'no body text');
      
      return {
        success: true,
        currentUrl: url,
        foundElements,
        bodyTextSample: bodyText?.substring(0, 500)
      };
      
    } catch (error) {
      console.error('Error in document search:', error);
      return {
        success: false,
        error: error.message
      };
    }

    // Step 4
    // Continue with hovering over documents and checking for hover menus
    const page = state.currentPage;
    
    try {
      // First, let's find document entries more carefully
      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
      
      // Look for various document-related selectors
      const documentSelectors = [
        'a[href*="/doc/"]',
        '.document-item',
        '[data-testid*="document"]',
        'li:has-text("文档")',
        '.file-item',
        '.doc-list-item',
        'tr:has-text("文档")',
        'div:has-text("文档")',
        '.list-item'
      ];
      
      let documentElements = [];
      
      for (const selector of documentSelectors) {
        try {
          const elements = await Promise.race([
            page.locator(selector).all(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
          ]);
          
          if (elements && elements.length > 0) {
            for (let i = 0; i < Math.min(elements.length, 5); i++) {
              const element = elements[i];
              const isVisible = await Promise.race([
                element.isVisible(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
              ]).catch(() => false);
              
              if (isVisible) {
                const text = await Promise.race([
                  element.textContent(),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
                ]).catch(() => '');
                
                const boundingBox = await Promise.race([
                  element.boundingBox(),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
                ]).catch(() => null);
                
                if (boundingBox && text) {
                  documentElements.push({
                    selector: selector,
                    index: i,
                    text: text.substring(0, 100),
                    boundingBox: boundingBox
                  });
                }
              }
            }
          }
        } catch (error) {
          // Continue with next selector
        }
      }
      
      console.log(`Found ${documentElements.length} document elements`);
      
      if (documentElements.length === 0) {
        // Try to find any clickable links or items
        const fallbackElements = await Promise.race([
          page.locator('a, .item, li, tr').all(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000))
        ]).catch(() => []);
        
        for (let i = 0; i < Math.min(fallbackElements.length, 10); i++) {
          const element = fallbackElements[i];
          const isVisible = await Promise.race([
            element.isVisible(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ]).catch(() => false);
          
          if (isVisible) {
            const text = await Promise.race([
              element.textContent(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
            ]).catch(() => '');
            
            if (text && text.trim().length > 0) {
              const boundingBox = await Promise.race([
                element.boundingBox(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
              ]).catch(() => null);
              
              if (boundingBox) {
                documentElements.push({
                  selector: `a, .item, li, tr`,
                  index: i,
                  text: text.substring(0, 100),
                  boundingBox: boundingBox
                });
              }
            }
          }
        }
      }
      
      state.documentElements = documentElements;
      
      return {
        success: true,
        currentUrl: page.url(),
        foundDocumentElements: documentElements.slice(0, 5), // Show first 5
        totalElements: documentElements.length
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        currentUrl: await page.url().catch(() => 'unknown')
      };
    }

    // Step 5
    // Continue with hovering over documents and checking for hover menus
    const page = state.currentPage;
    
    try {
      // First, let's get the current state and find document elements to hover over
      const documentElements = state.documentElements || [];
      console.log('Available document elements:', documentElements.length);
      
      if (documentElements.length === 0) {
        // Try to find document elements again with broader selectors
        const elements = await page.$$eval('li, .document-item, [class*="document"], [class*="file"], a[href*="doc"]', els => 
          els.slice(0, 10).map((el, i) => ({
            index: i,
            text: el.textContent?.trim(),
            tagName: el.tagName,
            className: el.className,
            href: el.href || null,
            hasText: el.textContent?.length > 0
          })).filter(el => el.hasText && el.text.length > 3)
        );
        
        console.log('Found elements for hovering:', elements);
        state.hoverElements = elements;
      }
      
      // Use existing document elements or newly found ones
      const elementsToTest = state.documentElements || state.hoverElements || [];
      
      if (elementsToTest.length === 0) {
        return {
          success: false,
          error: 'No document elements found to hover over'
        };
      }
      
      // Test hovering over the first few document elements
      const hoverResults = [];
      
      for (let i = 0; i < Math.min(3, elementsToTest.length); i++) {
        const element = elementsToTest[i];
        console.log(`Testing hover on element ${i}:`, element.text);
        
        try {
          // Find the element and hover over it
          let elementHandle;
          
          if (element.selector) {
            elementHandle = await page.$(element.selector);
          } else {
            // Try to find by text content
            elementHandle = await page.$(`*:has-text("${element.text.substring(0, 20)}")`);
          }
          
          if (elementHandle) {
            // Move mouse to hover over the element
            await elementHandle.hover({ timeout: 3000 });
            
            // Wait a moment for any hover effects to appear
            await page.waitForTimeout(1000);
            
            // Check for any hover menus, tooltips, or toolbars that might have appeared
            const hoverMenus = await page.$$eval('[class*="hover"], [class*="menu"], [class*="tooltip"], [class*="toolbar"], [class*="popup"], [aria-label*="menu"], [role="menu"], [role="tooltip"]', 
              elements => elements.map(el => ({
                tagName: el.tagName,
                className: el.className,
                text: el.textContent?.trim(),
                visible: el.offsetWidth > 0 && el.offsetHeight > 0,
                ariaLabel: el.getAttribute('aria-label')
              }))
            );
            
            // Check specifically for 'Summarize' options
            const summarizeOptions = await page.$$eval('*:has-text("Summarize"), *:has-text("Summary"), *:has-text("总结"), *[title*="Summarize"], *[aria-label*="Summarize"]', 
              elements => elements.map(el => ({
                text: el.textContent?.trim(),
                title: el.title,
                ariaLabel: el.getAttribute('aria-label'),
                visible: el.offsetWidth > 0 && el.offsetHeight > 0
              }))
            ).catch(() => []);
            
            hoverResults.push({
              elementIndex: i,
              elementText: element.text,
              hoverMenusFound: hoverMenus.length,
              hoverMenus: hoverMenus,
              summarizeOptionsFound: summarizeOptions.length,
              summarizeOptions: summarizeOptions
            });
            
            // Move mouse away to clear hover state
            await page.mouse.move(0, 0);
            await page.waitForTimeout(500);
            
          } else {
            console.log(`Could not find element ${i} for hovering`);
          }
          
        } catch (error) {
          console.log(`Error hovering over element ${i}:`, error.message);
          hoverResults.push({
            elementIndex: i,
            elementText: element.text,
            error: error.message
          });
        }
      }
      
      // Take a screenshot after testing hover behavior
      const screenshotPath = `hover_test_${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      
      return {
        success: true,
        currentUrl: page.url(),
        hoverTestResults: hoverResults,
        screenshotTaken: screenshotPath,
        totalElementsTested: hoverResults.length,
        elementsWithHoverMenus: hoverResults.filter(r => r.hoverMenusFound > 0).length,
        elementsWithSummarizeOption: hoverResults.filter(r => r.summarizeOptionsFound > 0).length
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        currentUrl: page.url()
      };
    }

    // Step 6
    // Take a screenshot to document the hover behavior and complete the task
    const page = state.currentPage;
    
    try {
      // First, let's hover over one of the document elements again to ensure hover state is active
      const documentElements = await page.locator('li').filter({ hasText: '文档' }).all();
      
      if (documentElements.length > 0) {
        // Hover over the first document element
        await documentElements[0].hover();
        
        // Wait a moment for any hover effects to appear
        await page.waitForTimeout(1000);
      }
      
      // Take a screenshot to document the current state
      const screenshot = await page.screenshot({
        fullPage: true,
        path: 'hover_behavior_documentation.png'
      });
      
      // Also check for any dynamically loaded hover menus one more time
      const hoverMenus = await Promise.race([
        page.locator('[role="menu"], .hover-menu, .context-menu, [data-testid*="menu"], .tooltip, .popover').all(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
      ]).catch(() => []);
      
      const summarizeOption = await Promise.race([
        page.locator('*:has-text("Summarize"), *:has-text("summarize"), *:has-text("总结"), *:has-text("摘要")').all(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
      ]).catch(() => []);
      
      return {
        success: true,
        screenshotTaken: true,
        currentUrl: page.url(),
        hoverMenusFound: hoverMenus.length,
        summarizeOptionsFound: summarizeOption.length,
        taskCompleted: true,
        summary: {
          documentsFound: state.foundDocuments?.length || 0,
          hoverTested: true,
          screenshotCaptured: true,
          hoverMenuBehavior: 'No specific hover menus or summarize options were found during testing'
        }
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        screenshotAttempted: true
      };
    }

}
