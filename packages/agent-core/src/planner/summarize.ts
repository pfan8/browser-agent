/**
 * Smart Summarization for Action Results
 * 
 * Generates concise summaries of action results for Planner context,
 * while preserving full data for user display.
 */

/**
 * Configuration for summarization
 */
const SUMMARY_CONFIG = {
  maxSummaryLength: 500,      // Max length of summary for Planner
  maxArrayPreview: 5,         // Max items to preview in arrays
  maxStringPreview: 100,      // Max length for string previews
};

/**
 * Summarize action result data for Planner context
 * 
 * This creates a concise summary suitable for LLM context,
 * while the full data is preserved elsewhere for user display.
 */
export function summarizeActionResult(data: unknown): string {
  if (data === null || data === undefined) {
    return '操作成功';
  }

  if (typeof data !== 'object') {
    return String(data).slice(0, SUMMARY_CONFIG.maxStringPreview);
  }

  const obj = data as Record<string, unknown>;

  // Handle tab list (common case)
  if ('tabs' in obj && Array.isArray(obj.tabs)) {
    return summarizeTabList(obj.tabs, obj.totalTabs as number);
  }

  // Handle generic arrays
  if (Array.isArray(data)) {
    return summarizeArray(data);
  }

  // Handle objects with success/error pattern
  if ('success' in obj) {
    return summarizeSuccessResult(obj);
  }

  // Handle menu items / navigation items
  if ('menuItems' in obj && Array.isArray(obj.menuItems)) {
    return summarizeMenuItems(obj.menuItems);
  }

  // Generic object summary
  return summarizeGenericObject(obj);
}

/**
 * Summarize tab list
 */
function summarizeTabList(
  tabs: Array<Record<string, unknown>>, 
  totalTabs?: number
): string {
  const count = totalTabs ?? tabs.length;
  const activeTab = tabs.find(t => t.isActive || t.isCurrent);
  
  // Get first few tab titles
  const previewTabs = tabs.slice(0, SUMMARY_CONFIG.maxArrayPreview);
  const tabPreviews = previewTabs.map((t, i) => {
    const title = truncate(String(t.title || '无标题'), 30);
    const marker = (t.isActive || t.isCurrent) ? ' [当前]' : '';
    return `${i + 1}. ${title}${marker}`;
  });

  let summary = `共 ${count} 个标签页`;
  
  if (activeTab) {
    summary += `，当前活动: "${truncate(String(activeTab.title), 40)}"`;
  }
  
  summary += `\n前${previewTabs.length}个: ${tabPreviews.join(', ')}`;
  
  if (tabs.length > SUMMARY_CONFIG.maxArrayPreview) {
    summary += `... 等`;
  }

  return summary;
}

/**
 * Summarize generic array
 */
function summarizeArray(arr: unknown[]): string {
  if (arr.length === 0) {
    return '空数组';
  }

  const previewItems = arr.slice(0, SUMMARY_CONFIG.maxArrayPreview);
  const previews = previewItems.map((item, i) => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      // Try to find a name/title/text field
      const displayValue = obj.name || obj.title || obj.text || obj.label;
      if (displayValue) {
        return `${i + 1}. ${truncate(String(displayValue), 40)}`;
      }
      return `${i + 1}. {object}`;
    }
    return `${i + 1}. ${truncate(String(item), 40)}`;
  });

  let summary = `共 ${arr.length} 个项目`;
  summary += `\n${previews.join(', ')}`;
  
  if (arr.length > SUMMARY_CONFIG.maxArrayPreview) {
    summary += `... 等`;
  }

  return summary;
}

/**
 * Summarize success/error result object
 */
function summarizeSuccessResult(obj: Record<string, unknown>): string {
  const parts: string[] = [];
  
  // Success status
  parts.push(obj.success ? '成功' : '失败');
  
  // Error message
  if (obj.error) {
    parts.push(`错误: ${truncate(String(obj.error), 100)}`);
  }
  
  // Message
  if (obj.message) {
    parts.push(truncate(String(obj.message), 100));
  }
  
  // Key metrics
  const metricFields = ['totalTabs', 'totalItems', 'count', 'total'];
  for (const field of metricFields) {
    if (field in obj && typeof obj[field] === 'number') {
      parts.push(`${field}: ${obj[field]}`);
    }
  }
  
  // URL/Title
  if (obj.url) {
    parts.push(`URL: ${truncate(String(obj.url), 60)}`);
  }
  if (obj.title) {
    parts.push(`标题: ${truncate(String(obj.title), 40)}`);
  }
  
  // Handle nested arrays (like tabs)
  if ('tabs' in obj && Array.isArray(obj.tabs)) {
    parts.push(summarizeTabList(obj.tabs, obj.totalTabs as number));
  }

  return parts.join('; ');
}

/**
 * Summarize menu items / navigation items
 */
function summarizeMenuItems(items: unknown[]): string {
  if (items.length === 0) {
    return '无菜单项';
  }

  const previewItems = items.slice(0, SUMMARY_CONFIG.maxArrayPreview);
  const previews = previewItems.map((item, i) => {
    if (typeof item === 'object' && item !== null) {
      const obj = item as Record<string, unknown>;
      const name = obj.name || obj.text || obj.title || obj.label;
      return `${i + 1}. ${truncate(String(name || 'unknown'), 30)}`;
    }
    return `${i + 1}. ${truncate(String(item), 30)}`;
  });

  let summary = `共 ${items.length} 个菜单项: ${previews.join(', ')}`;
  
  if (items.length > SUMMARY_CONFIG.maxArrayPreview) {
    summary += `... 等`;
  }

  return summary;
}

/**
 * Summarize generic object
 */
function summarizeGenericObject(obj: Record<string, unknown>): string {
  const priorityFields = ['url', 'title', 'message', 'status', 'result', 'error'];
  const parts: string[] = [];
  
  // First, add priority fields
  for (const field of priorityFields) {
    if (field in obj && obj[field] !== undefined && obj[field] !== null) {
      const value = obj[field];
      if (typeof value === 'object') {
        parts.push(`${field}: {object}`);
      } else {
        parts.push(`${field}: ${truncate(String(value), 60)}`);
      }
    }
  }
  
  // Then add other fields if we have room
  const otherFields = Object.keys(obj)
    .filter(k => !priorityFields.includes(k))
    .slice(0, 3);
  
  for (const field of otherFields) {
    if (parts.join(', ').length > SUMMARY_CONFIG.maxSummaryLength - 50) {
      break;
    }
    const value = obj[field];
    if (value === undefined || value === null) continue;
    
    if (Array.isArray(value)) {
      parts.push(`${field}: [${value.length} items]`);
    } else if (typeof value === 'object') {
      parts.push(`${field}: {object}`);
    } else {
      parts.push(`${field}: ${truncate(String(value), 40)}`);
    }
  }

  return parts.join(', ') || 'object';
}

/**
 * Truncate string with ellipsis
 */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) {
    return str;
  }
  return str.slice(0, maxLen - 3) + '...';
}

/**
 * Build summary for history entries
 */
export function summarizeHistoryResult(data: unknown): string {
  const summary = summarizeActionResult(data);
  // History entries should be more compact
  return truncate(summary, 150);
}

/**
 * Format full data as Markdown for user display
 * 
 * This provides detailed, readable output for the final result
 */
export function formatFullDataAsMarkdown(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }

  if (typeof data !== 'object') {
    return null;
  }

  const obj = data as Record<string, unknown>;

  // Handle tab list (common case)
  if ('tabs' in obj && Array.isArray(obj.tabs)) {
    return formatTabListMarkdown(obj.tabs, obj.totalTabs as number);
  }

  // Handle menu items
  if ('menuItems' in obj && Array.isArray(obj.menuItems)) {
    return formatMenuItemsMarkdown(obj.menuItems);
  }

  // Handle generic arrays
  if (Array.isArray(data) && data.length > 5) {
    return formatArrayMarkdown(data);
  }

  // For other objects, don't format (use LLM's message)
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

