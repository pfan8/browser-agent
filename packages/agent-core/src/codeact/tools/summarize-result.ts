/**
 * SummarizeResult Tool
 *
 * Deterministic summarization of large objects for LLM consumption.
 * Uses json-truncate for depth limiting and custom logic for arrays/strings.
 */

import truncate from 'json-truncate';
import type { ToolResult, SummarizeConfig } from './types';
import { DEFAULT_SUMMARIZE_CONFIG } from './types';

/**
 * Truncate arrays to a maximum number of items
 */
function truncateArrays(obj: unknown, maxItems: number): unknown {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    const truncated = obj.slice(0, maxItems).map((item) => truncateArrays(item, maxItems));
    if (obj.length > maxItems) {
      truncated.push(`... and ${obj.length - maxItems} more items`);
    }
    return truncated;
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = truncateArrays(value, maxItems);
    }
    return result;
  }

  return obj;
}

/**
 * Truncate long strings
 */
function truncateStrings(obj: unknown, maxLength: number): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    if (obj.length > maxLength) {
      return obj.slice(0, maxLength) + '... (truncated)';
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => truncateStrings(item, maxLength));
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = truncateStrings(value, maxLength);
    }
    return result;
  }

  return obj;
}

/**
 * Summarize a value for LLM consumption
 *
 * @param args - Object containing the data to summarize
 * @param config - Summarization configuration
 * @returns Summarized string representation
 */
export function summarizeResult(
  args: { data: unknown },
  config: Partial<SummarizeConfig> = {}
): string {
  const mergedConfig: SummarizeConfig = {
    ...DEFAULT_SUMMARIZE_CONFIG,
    ...config,
  };

  const { data } = args;

  // Handle null/undefined
  if (data === null) return 'null';
  if (data === undefined) return 'undefined';

  // Handle primitives
  if (typeof data === 'string') {
    if (data.length > mergedConfig.maxStringLength) {
      return `"${data.slice(0, mergedConfig.maxStringLength)}..." (truncated, ${data.length} chars)`;
    }
    return `"${data}"`;
  }

  if (typeof data === 'number' || typeof data === 'boolean') {
    return String(data);
  }

  // Handle objects/arrays
  try {
    // Step 1: Use json-truncate for depth limiting
    const depthTruncated = truncate(data, {
      maxDepth: mergedConfig.maxDepth,
      replace: '[...]',
    });

    // Step 2: Truncate arrays
    const arrayTruncated = truncateArrays(depthTruncated, mergedConfig.maxArrayItems);

    // Step 3: Truncate strings
    const stringTruncated = truncateStrings(arrayTruncated, mergedConfig.maxStringLength);

    // Step 4: Stringify and limit total length
    let result = JSON.stringify(stringTruncated, null, 2);
    if (result.length > mergedConfig.maxTotalLength) {
      result = result.slice(0, mergedConfig.maxTotalLength) + '\n... [output truncated]';
    }

    return result;
  } catch {
    return '[Unable to serialize object]';
  }
}

/**
 * SummarizeResult as a tool function
 * Used when LLM explicitly calls summarizeResult tool
 *
 * @param args - Tool arguments containing data to summarize
 * @param config - Optional summarization config
 * @returns Tool result with the summary
 */
export function summarizeResultTool(
  args: { data: unknown },
  config?: Partial<SummarizeConfig>
): ToolResult {
  const summary = summarizeResult(args, config);
  return {
    success: true,
    data: summary,
    summary,
  };
}

