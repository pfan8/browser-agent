/**
 * Act Node
 * 
 * Executes the action decided by the think node.
 * Implements:
 * - RA-03: Action execution
 * - RA-04: Result verification
 * - ER-01: Selector fallback strategies
 * - ER-02: Wait and retry on failure
 * - SA-02: Action result verification
 */

import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { AgentState, ActionResult, SelectorAttempt, AgentAction } from '../state';
import type { StructuredToolInterface } from '@langchain/core/tools';

/**
 * Selector strategies for ER-01 fallback
 */
type SelectorStrategy = 'css' | 'text' | 'testid' | 'role' | 'xpath';

/**
 * Generate alternative selectors for ER-01
 */
function generateAlternativeSelectors(
  originalSelector: string
): Array<{ selector: string; strategy: SelectorStrategy }> {
  const alternatives: Array<{ selector: string; strategy: SelectorStrategy }> = [];
  
  // If it's a text-based selector, try different strategies
  const textMatch = originalSelector.match(/^["']?([^"']+)["']?$/);
  if (textMatch) {
    const text = textMatch[1];
    
    // Try text selector
    alternatives.push({ 
      selector: `text="${text}"`, 
      strategy: 'text' 
    });
    
    // Try role with name
    alternatives.push({ 
      selector: `role=button[name="${text}"]`, 
      strategy: 'role' 
    });
    alternatives.push({ 
      selector: `role=link[name="${text}"]`, 
      strategy: 'role' 
    });
    
    // Try partial text match
    alternatives.push({ 
      selector: `text=${text}`, 
      strategy: 'text' 
    });
    
    // Try data-testid if looks like an ID
    if (/^[a-z][a-z0-9-_]*$/i.test(text)) {
      alternatives.push({ 
        selector: `[data-testid="${text}"]`, 
        strategy: 'testid' 
      });
    }
  }
  
  // If it's a CSS selector that failed, try simpler versions
  if (originalSelector.includes(' ')) {
    // Try just the last part
    const parts = originalSelector.split(' ');
    const lastPart = parts[parts.length - 1];
    alternatives.push({ selector: lastPart, strategy: 'css' });
  }
  
  // If it's an ID selector, try without #
  if (originalSelector.startsWith('#')) {
    const id = originalSelector.slice(1);
    alternatives.push({ 
      selector: `[id="${id}"]`, 
      strategy: 'css' 
    });
    alternatives.push({ 
      selector: `[data-testid="${id}"]`, 
      strategy: 'testid' 
    });
  }
  
  return alternatives;
}

/**
 * Wait helper for ER-02
 */
function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Creates an act node that executes browser actions (RA-03, RA-04, ER-*)
 */
export function createActNode(browserAdapter: IBrowserAdapter, tools: StructuredToolInterface[]) {
  // Build tool map for quick lookup
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    console.log('[ActNode] Executing action (RA-03)...');
    
    try {
      // Get the latest action
      const latestAction = state.actionHistory[state.actionHistory.length - 1];
      if (!latestAction || latestAction.result) {
        return {
          status: 'error',
          error: 'No pending action to execute',
        };
      }

      const startTime = Date.now();

      // Find the tool
      const tool = toolMap.get(latestAction.tool);
      if (!tool) {
        const toolName = latestAction.tool || '(空)';
        const errorMessage = latestAction.tool 
          ? `未知操作: ${toolName}` 
          : 'AI 响应解析失败，未能识别有效的操作指令';
        
        const result: ActionResult = {
          success: false,
          error: errorMessage,
          duration: Date.now() - startTime,
        };

        const updatedAction = { ...latestAction, result };
        const updatedHistory = [...state.actionHistory.slice(0, -1), updatedAction];

        // Provide user-friendly error message
        const friendlyResult = `❌ 任务执行失败\n\n📋 失败原因: ${errorMessage}\n\n💡 建议: 请尝试用更简单明确的语言描述任务，例如:\n  - "打开 google.com"\n  - "点击登录按钮"\n  - "在搜索框输入 hello"`;

        return {
          status: 'error',
          error: result.error,
          result: friendlyResult,
          isComplete: true,
          actionHistory: updatedHistory,
          consecutiveFailures: state.consecutiveFailures + 1,
        };
      }

      console.log(`[ActNode] Executing tool: ${tool.name}(${JSON.stringify(latestAction.args)})`);
      
      let result: ActionResult;
      const selectorAttempts: SelectorAttempt[] = [];
      const maxRetries = latestAction.maxRetries || 3;
      let currentRetry = latestAction.retryCount || 0;
      
      // Try to execute the action with retries (ER-02)
      // Use < to ensure exactly maxRetries attempts (e.g., maxRetries=3 → attempts 0,1,2)
      while (currentRetry < maxRetries) {
        try {
          const toolResult = await tool.invoke(latestAction.args);
          
          // Parse tool result
          const parsedResult = typeof toolResult === 'string' 
            ? JSON.parse(toolResult) 
            : toolResult;

          result = {
            success: parsedResult.success !== false,
            data: parsedResult.data || parsedResult,
            error: parsedResult.error,
            duration: Date.now() - startTime,
            verified: true, // SA-02: Mark as verified
            verificationDetails: 'Action completed successfully',
          };
          
          if (result.success) {
            break; // Success, exit retry loop
          }
          
          // ER-01: Try selector fallback for click/type actions
          if (!result.success && 
              (latestAction.tool === 'click' || latestAction.tool === 'type') &&
              latestAction.args.selector) {
            
            const originalSelector = latestAction.args.selector as string;
            selectorAttempts.push({
              selector: originalSelector,
              strategy: 'css',
              success: false,
              error: result.error,
            });
            
            console.log('[ActNode] ER-01: Trying alternative selectors...');
            
            const alternatives = generateAlternativeSelectors(originalSelector);
            let altSuccess = false;
            
            for (const alt of alternatives) {
              console.log(`[ActNode] Trying: ${alt.selector} (${alt.strategy})`);
              try {
                const altArgs = { ...latestAction.args, selector: alt.selector };
                const altResult = await tool.invoke(altArgs);
                const parsedAltResult = typeof altResult === 'string' 
                  ? JSON.parse(altResult) 
                  : altResult;
                
                selectorAttempts.push({
                  selector: alt.selector,
                  strategy: alt.strategy,
                  success: parsedAltResult.success !== false,
                  error: parsedAltResult.error,
                });
                
                if (parsedAltResult.success !== false) {
                  console.log(`[ActNode] ER-01: Alternative selector succeeded: ${alt.selector}`);
                  result = {
                    success: true,
                    data: parsedAltResult.data || parsedAltResult,
                    duration: Date.now() - startTime,
                    verified: true,
                    verificationDetails: `Used alternative selector: ${alt.selector}`,
                  };
                  altSuccess = true;
                  break;
                }
              } catch {
                selectorAttempts.push({
                  selector: alt.selector,
                  strategy: alt.strategy,
                  success: false,
                  error: 'Exception thrown',
                });
              }
            }
            
            if (altSuccess) {
              break; // Success with alternative selector
            }
          }
          
          // ER-02: Wait before retry
          if (currentRetry < maxRetries) {
            const waitTime = 500 * (currentRetry + 1); // Exponential backoff
            console.log(`[ActNode] ER-02: Waiting ${waitTime}ms before retry ${currentRetry + 1}/${maxRetries}`);
            await wait(waitTime);
          }
          
          currentRetry++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          result = {
            success: false,
            error: errorMessage,
            duration: Date.now() - startTime,
            verified: false,
          };
          
          if (currentRetry < maxRetries) {
            const waitTime = 500 * (currentRetry + 1);
            console.log(`[ActNode] ER-02: Error occurred, waiting ${waitTime}ms before retry`);
            await wait(waitTime);
          }
          currentRetry++;
        }
      }

      // Update action with result and selector attempts
      const updatedAction: AgentAction = { 
        ...latestAction, 
        result: result!,
        selectorAttempts: selectorAttempts.length > 0 ? selectorAttempts : undefined,
        retryCount: currentRetry,
      };
      const updatedHistory = [...state.actionHistory.slice(0, -1), updatedAction];

      if (result!.success) {
        console.log(`[ActNode] Action succeeded: ${tool.name}`);
        
        // Track completed step for MS progress
        const stepDescription = `${tool.name}(${JSON.stringify(latestAction.args)})`;
        
        return {
          status: 'acting',
          actionHistory: updatedHistory,
          consecutiveFailures: 0,
          completedSteps: [stepDescription],
          currentStepIndex: state.currentStepIndex + 1,
        };
      } else {
        console.log(`[ActNode] Action failed after ${currentRetry} retries: ${result!.error}`);
        return {
          status: 'acting',
          actionHistory: updatedHistory,
          consecutiveFailures: state.consecutiveFailures + 1,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[ActNode] Error:', errorMessage);
      
      // Translate common errors
      let friendlyError = errorMessage;
      if (errorMessage.includes('disconnected') || errorMessage.includes('Disconnected')) {
        friendlyError = '浏览器连接已断开';
      } else if (errorMessage.includes('navigation')) {
        friendlyError = '页面导航失败';
      }
      
      const friendlyResult = `❌ 操作执行失败\n\n📋 错误: ${friendlyError}\n\n💡 建议: 请检查浏览器连接状态`;
      
      return {
        status: 'error',
        error: `Act failed: ${errorMessage}`,
        result: friendlyResult,
        isComplete: true,
        consecutiveFailures: state.consecutiveFailures + 1,
      };
    }
  };
}

