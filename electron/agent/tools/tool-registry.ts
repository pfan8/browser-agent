/**
 * Tool Registry
 * 
 * Manages available tools for the agent to use.
 * Wraps the existing browser-controller and provides a unified interface.
 */

import type {
  ToolDefinition,
  ToolExecutor,
  ToolExecutionResult,
  RegisteredTool,
  ToolCategory,
} from '../types';

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  /**
   * Register a new tool
   */
  register(definition: ToolDefinition, executor: ToolExecutor): void {
    if (this.tools.has(definition.name)) {
      console.warn(`Tool "${definition.name}" is already registered. Overwriting.`);
    }
    
    this.tools.set(definition.name, { definition, executor });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by name
   */
  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Get all tool definitions
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get tool definitions by category
   */
  getByCategory(category: ToolCategory): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter(t => t.definition.category === category)
      .map(t => t.definition);
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name);
    
    if (!tool) {
      return {
        success: false,
        error: `Tool "${name}" not found`,
        duration: 0,
      };
    }

    const startTime = Date.now();

    try {
      // Validate required parameters
      const missingParams = tool.definition.parameters
        .filter(p => p.required && !(p.name in args))
        .map(p => p.name);

      if (missingParams.length > 0) {
        return {
          success: false,
          error: `Missing required parameters: ${missingParams.join(', ')}`,
          duration: Date.now() - startTime,
        };
      }

      // Apply default values for missing optional parameters
      const argsWithDefaults = { ...args };
      for (const param of tool.definition.parameters) {
        if (!(param.name in argsWithDefaults) && param.default !== undefined) {
          argsWithDefaults[param.name] = param.default;
        }
      }

      // Execute the tool
      const result = await tool.executor(argsWithDefaults);
      
      return {
        ...result,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Get formatted tool descriptions for LLM prompts
   */
  getToolDescriptionsForPrompt(): string {
    const definitions = this.getAllDefinitions();
    
    return definitions.map(def => {
      const params = def.parameters.map(p => {
        const required = p.required ? '(required)' : '(optional)';
        const defaultVal = p.default !== undefined ? ` [default: ${p.default}]` : '';
        return `    - ${p.name}: ${p.type} ${required}${defaultVal} - ${p.description}`;
      }).join('\n');

      return `## ${def.name}
Category: ${def.category}
Description: ${def.description}
Parameters:
${params || '    (none)'}
Returns: ${def.returns}`;
    }).join('\n\n');
  }

  /**
   * Get tool names as a simple list
   */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Clear all registered tools
   */
  clear(): void {
    this.tools.clear();
  }
}

// Export singleton instance
export const toolRegistry = new ToolRegistry();

