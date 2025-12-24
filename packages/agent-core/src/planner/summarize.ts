/**
 * Data Formatting for User Display
 * 
 * Formats action result data as Markdown for user-friendly display.
 * Note: For LLM context, we use direct JSON.stringify (see prompts.ts).
 */

/**
 * Format full data as Markdown for user display
 * 
 * This provides detailed, readable output for the final result shown to users.
 * Returns null if no special formatting is needed.
 */
export function formatFullDataAsMarkdown(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Handle nested data structure (e.g., { success: true, data: { tabs: [...] } })
  if ('data' in obj && typeof obj.data === 'object' && obj.data !== null) {
    const nestedData = obj.data as Record<string, unknown>;
    if ('tabs' in nestedData && Array.isArray(nestedData.tabs)) {
      return formatTabListMarkdown(nestedData.tabs, nestedData.count as number || nestedData.totalTabs as number);
    }
    if ('menuItems' in nestedData && Array.isArray(nestedData.menuItems)) {
      return formatMenuItemsMarkdown(nestedData.menuItems);
    }
  }

  // Handle tab list at top level
  if ('tabs' in obj && Array.isArray(obj.tabs)) {
    return formatTabListMarkdown(obj.tabs, obj.totalTabs as number);
  }

  // Handle menu items at top level
  if ('menuItems' in obj && Array.isArray(obj.menuItems)) {
    return formatMenuItemsMarkdown(obj.menuItems);
  }

  // Handle generic arrays (only if large enough to warrant formatting)
  if (Array.isArray(data) && data.length > 5) {
    return formatArrayMarkdown(data);
  }

  // For other objects, don't format (use LLM's message directly)
  return null;
}

/**
 * Format tab list as Markdown table
 */
function formatTabListMarkdown(
  tabs: Array<Record<string, unknown>>,
  totalTabs?: number
): string {
  const count = totalTabs ?? tabs.length;
  
  const lines: string[] = [
    '',
    `### 📑 全部 ${count} 个标签页`,
    '',
    '| # | 标题 | URL |',
    '|---|------|-----|',
  ];

  tabs.forEach((tab, index) => {
    const title = String(tab.title || '(无标题)').replace(/\|/g, '\\|');
    const url = String(tab.url || '').replace(/\|/g, '\\|');
    const marker = (tab.isActive || tab.isCurrent) ? ' **[当前]**' : '';
    // Truncate URL for readability
    const displayUrl = url.length > 60 ? url.slice(0, 57) + '...' : url;
    lines.push(`| ${index + 1} | ${title}${marker} | ${displayUrl} |`);
  });

  return lines.join('\n');
}

/**
 * Format menu items as Markdown list
 */
function formatMenuItemsMarkdown(items: unknown[]): string {
  const lines: string[] = [
    '',
    `### 📋 全部 ${items.length} 个菜单项`,
    '',
  ];

  items.forEach((item, index) => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = obj.name || obj.text || obj.title || obj.label || '(未知)';
      const href = obj.href || obj.url || '';
      lines.push(`${index + 1}. **${name}**${href ? ` - ${href}` : ''}`);
    } else {
      lines.push(`${index + 1}. ${String(item)}`);
    }
  });

  return lines.join('\n');
}

/**
 * Format generic array as Markdown
 */
function formatArrayMarkdown(arr: unknown[]): string {
  const lines: string[] = [
    '',
    `### 📃 全部 ${arr.length} 项`,
    '',
  ];

  arr.forEach((item, index) => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      const displayValue = obj.name || obj.title || obj.text || obj.label;
      if (displayValue) {
        lines.push(`${index + 1}. ${displayValue}`);
      } else {
        lines.push(`${index + 1}. \`${JSON.stringify(item).slice(0, 80)}...\``);
      }
    } else {
      lines.push(`${index + 1}. ${String(item)}`);
    }
  });

  return lines.join('\n');
}
