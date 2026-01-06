/**
 * Context Manager
 * 
 * Manages layered context for LLM requests:
 * - L0: Permanent system rules
 * - L1: User profile + conversation summary
 * - L2: Current task message (simplified)
 * - L3: Recent messages (sliding window)
 * 
 * Implements conversation summarization to compress long histories.
 */

import type { BaseMessage } from '@langchain/core/messages';
import type {
  ContextConfig,
  LayeredContext,
  BuildContextInput,
  BuildContextResult,
  ISummarizer,
} from './types';
import { DEFAULT_CONTEXT_CONFIG } from './types';
import { createSummarizer } from './summarizer';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('ContextManager');

/**
 * Context Manager
 * 
 * Handles context compression and layered context assembly.
 */
export class ContextManager {
  private config: ContextConfig;
  private summarizer: ISummarizer;

  constructor(config: Partial<ContextConfig> = {}, summarizer?: ISummarizer) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config };
    this.summarizer = summarizer || createSummarizer({
      useLLM: !!config.summaryApiKey,
      apiKey: config.summaryApiKey,
      baseUrl: config.summaryBaseUrl,
      model: config.summaryModel,
    });
  }

  /**
   * Build layered context for LLM request
   */
  async buildContext(
    input: BuildContextInput,
    systemRules: string
  ): Promise<BuildContextResult> {
    const { goal, lastActionResult, messages, conversationSummary } = input;

    log.debug('Building context', {
      goal: goal.slice(0, 50),
      messageCount: messages.length,
      hasExistingSummary: !!conversationSummary,
    });

    // Determine if we need to summarize
    const needsSummarization = messages.length > this.config.summaryThreshold;
    let newSummary: string | undefined;
    let summarizedMessageCount: number | undefined;

    // Get recent messages for L3 (sliding window)
    let recentMessages: BaseMessage[];
    let contextSummaryText = conversationSummary || '';

    if (needsSummarization) {
      // Split messages: older ones for summary, recent ones for L3
      const splitIndex = messages.length - this.config.maxRecentMessages;
      const messagesToSummarize = messages.slice(0, splitIndex);
      recentMessages = messages.slice(splitIndex);

      if (messagesToSummarize.length > 0) {
        log.debug('Triggering summarization', {
          messagesToSummarize: messagesToSummarize.length,
          recentMessages: recentMessages.length,
        });

        newSummary = await this.summarizer.summarize(
          messagesToSummarize,
          conversationSummary
        );
        summarizedMessageCount = messagesToSummarize.length;
        contextSummaryText = newSummary;
      }
    } else {
      recentMessages = messages.slice(-this.config.maxRecentMessages);
    }

    // Build L1: Context summary (conversation summary)
    const l1ContextSummary = this.buildL1ContextSummary(
      contextSummaryText
    );

    // Build L2: Current task message (simplified)
    const currentTaskMessage = this.buildL2TaskMessage(goal, lastActionResult);

    const context: LayeredContext = {
      systemRules,
      contextSummary: l1ContextSummary,
      currentTaskMessage,
      recentMessages,
    };

    log.debug('Context built', {
      l1Length: l1ContextSummary.length,
      l2Length: currentTaskMessage.length,
      l3MessageCount: recentMessages.length,
      hadSummarization: !!newSummary,
    });

    return {
      context,
      newSummary,
      summarizedMessageCount,
    };
  }

  /**
   * Build L1: Context summary from conversation summary
   */
  private buildL1ContextSummary(
    conversationSummary: string
  ): string {
    if (conversationSummary) {
      return `## Conversation Summary\n${conversationSummary}`;
    }
    return '';
  }

  /**
   * Build L2: Simplified current task message
   * Only includes: goal + last action result (with output summary)
   */
  private buildL2TaskMessage(
    goal: string,
    lastActionResult?: BuildContextInput['lastActionResult']
  ): string {
    let message = `## Task\n${goal}`;

    if (lastActionResult) {
      const icon = lastActionResult.success ? '✓' : '✗';
      message += `\n\n## Last Action\n${icon} ${lastActionResult.step}`;
      
      // Include execution output summary for successful actions
      if (lastActionResult.success && lastActionResult.outputSummary) {
        message += `\nResult: ${lastActionResult.outputSummary}`;
      }
      
      if (!lastActionResult.success && lastActionResult.error) {
        message += `\nError: ${lastActionResult.error}`;
      }
    }

    message += '\n\nRespond with JSON.';

    return message;
  }

  /**
   * Get current config
   */
  getConfig(): ContextConfig {
    return { ...this.config };
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<ContextConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

