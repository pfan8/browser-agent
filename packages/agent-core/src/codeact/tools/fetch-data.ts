/**
 * FetchData Tool
 *
 * Retrieves data from the execution variables (state).
 * This allows the LLM to inspect stored values.
 */

import type { ToolResult, FetchDataArgs } from './types';
import { summarizeResult } from './summarize-result';

/**
 * Build actionable hint for LLM based on data type and size
 * Helps LLM understand data is complete and what to do next
 */
function buildActionHint(data: unknown, varName: string): string {
    if (Array.isArray(data)) {
        return `\n\n[✓ Complete: Array with ${data.length} items. Use 'finish' to return this data, or 'runCode' to process it.]`;
    }
    if (typeof data === 'object' && data !== null) {
        const keys = Object.keys(data);
        return `\n\n[✓ Complete: Object with ${keys.length} keys. Use 'finish' to return this data.]`;
    }
    return `\n\n[✓ Data retrieved. Use 'finish' to complete the task.]`;
}

/**
 * Fetch data from execution variables
 *
 * @param args - Tool arguments specifying what to fetch
 * @param variables - Current execution variables
 * @returns Tool result with the requested data
 */
export function fetchData(
    args: FetchDataArgs,
    variables: Record<string, unknown>
): ToolResult {
    const { target, name } = args;

    switch (target) {
        case 'keys':
            // Return only the variable names
            const keys = Object.keys(variables);
            return {
                success: true,
                data: keys,
                summary:
                    keys.length > 0
                        ? `Available variables: ${keys.join(', ')}`
                        : 'No variables stored in state',
            };

        case 'single':
            // Return a single variable by name
            if (!name) {
                return {
                    success: false,
                    error: 'Variable name is required when target is "single"',
                    summary: 'Error: Missing variable name',
                };
            }

            if (!(name in variables)) {
                return {
                    success: false,
                    error: `Variable "${name}" not found in state`,
                    summary: `Error: Variable "${name}" does not exist`,
                };
            }

            const value = variables[name];
            const valueSummary = summarizeResult({ data: value });
            const hint = buildActionHint(value, name);
            return {
                success: true,
                data: value,
                summary: `state.${name} = ${valueSummary}${hint}`,
            };

        case 'all':
        default:
            // Return all variables
            const allKeys = Object.keys(variables);
            if (allKeys.length === 0) {
                return {
                    success: true,
                    data: {},
                    summary: 'State is empty - no variables stored',
                };
            }

            const allSummary = summarizeResult({ data: variables });
            return {
                success: true,
                data: variables,
                summary: `All variables (${allKeys.length}): ${allSummary}`,
            };
    }
}
