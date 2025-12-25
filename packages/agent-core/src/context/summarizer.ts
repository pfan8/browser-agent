/**
 * Conversation Summarizer
 * 
 * Generates summaries of conversation history to compress context.
 * Can use LLM for intelligent summarization or fall back to rule-based extraction.
 */

import { ChatAnthropic } from '@langchain/anthropic';
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from '@langchain/core/messages';
import type { ISummarizer } from './types';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('Summarizer');

/**
 * Configuration for the summarizer
 */
export interface SummarizerConfig {
  /** Use LLM for summarization (default: true) */
  useLLM: boolean;
  /** API key for LLM */
  apiKey?: string;
  /** Base URL for LLM */
  baseUrl?: string;
  /** Model to use (default: claude-3-haiku) */
  model?: string;
  /** Max tokens for summary output */
  maxSummaryTokens?: number;
}

const SUMMARIZER_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a concise summary of the conversation history.

Focus on:
1. Key actions taken and their results
2. Important decisions made
3. Current state and progress toward the goal
4. Any errors or issues encountered

Keep the summary concise (under 200 words) and factual. Use bullet points.
Output in the same language as the conversation.`;

/**
 * LLM-based conversation summarizer
 */
export class LLMSummarizer implements ISummarizer {
  private llm: ChatAnthropic | null = null;
  private config: SummarizerConfig;

  constructor(config: SummarizerConfig) {
    this.config = config;

    if (config.useLLM && config.apiKey) {
      const llmOptions: Record<string, unknown> = {
        anthropicApiKey: config.apiKey,
        modelName: config.model || 'claude-3-haiku-20240307',
        maxTokens: config.maxSummaryTokens || 500,
        temperature: 0,
      };

      if (config.baseUrl) {
        llmOptions.anthropicApiUrl = config.baseUrl;
      }

      this.llm = new ChatAnthropic(llmOptions);
      log.info('LLM Summarizer initialized', { model: config.model });
    }
  }

  async summarize(messages: BaseMessage[], existingSummary?: string): Promise<string> {
    if (!this.llm) {
      // Fall back to rule-based summarization
      return this.ruleBasedSummarize(messages, existingSummary);
    }

    try {
      const conversationText = this.formatMessagesForSummary(messages);
      
      let userPrompt = `Summarize this conversation:\n\n${conversationText}`;
      if (existingSummary) {
        userPrompt = `Previous summary:\n${existingSummary}\n\nNew conversation to incorporate:\n${conversationText}\n\nCreate an updated summary.`;
      }

      const response = await this.llm.invoke([
        new SystemMessage(SUMMARIZER_SYSTEM_PROMPT),
        new HumanMessage(userPrompt),
      ]);

      const summary = typeof response.content === 'string'
        ? response.content
        : JSON.stringify(response.content);

      log.debug('Generated summary', { 
        inputMessages: messages.length,
        summaryLength: summary.length,
      });

      return summary;
    } catch (error) {
      log.warn('LLM summarization failed, falling back to rules', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return this.ruleBasedSummarize(messages, existingSummary);
    }
  }

  /**
   * Format messages as text for summarization
   */
  private formatMessagesForSummary(messages: BaseMessage[]): string {
    return messages.map(m => {
      const role = m._getType();
      const content = typeof m.content === 'string' 
        ? m.content 
        : JSON.stringify(m.content);
      return `[${role}]: ${content.slice(0, 500)}`;
    }).join('\n\n');
  }

  /**
   * Rule-based summarization fallback
   */
  private ruleBasedSummarize(messages: BaseMessage[], existingSummary?: string): string {
    const parts: string[] = [];

    if (existingSummary) {
      parts.push(existingSummary);
    }

    // Extract key information from messages
    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      
      // Extract task/goal
      const taskMatch = content.match(/## Task\n(.+)/);
      if (taskMatch) {
        parts.push(`任务: ${taskMatch[1].slice(0, 100)}`);
      }

      // Extract action results
      const successMatch = content.match(/\[✓\] (.+)/);
      if (successMatch) {
        parts.push(`✓ ${successMatch[1].slice(0, 80)}`);
      }

      const failMatch = content.match(/\[✗\] (.+)/);
      if (failMatch) {
        parts.push(`✗ ${failMatch[1].slice(0, 80)}`);
      }

      // Extract errors
      const errorMatch = content.match(/Error: (.+)/);
      if (errorMatch) {
        parts.push(`错误: ${errorMatch[1].slice(0, 80)}`);
      }
    }

    // Deduplicate and limit
    const uniqueParts = [...new Set(parts)].slice(0, 10);
    return uniqueParts.join('\n');
  }
}

/**
 * Simple rule-based summarizer (no LLM required)
 */
export class RuleBasedSummarizer implements ISummarizer {
  async summarize(messages: BaseMessage[], existingSummary?: string): Promise<string> {
    const parts: string[] = [];

    if (existingSummary) {
      parts.push(existingSummary);
    }

    let actionCount = 0;
    let successCount = 0;
    let errorCount = 0;

    for (const msg of messages) {
      const content = typeof msg.content === 'string' ? msg.content : '';
      
      if (content.includes('[✓]')) {
        successCount++;
        actionCount++;
      }
      if (content.includes('[✗]')) {
        errorCount++;
        actionCount++;
      }
    }

    if (actionCount > 0) {
      parts.push(`已执行 ${actionCount} 个操作 (成功: ${successCount}, 失败: ${errorCount})`);
    }

    return parts.join('\n') || '无历史记录';
  }
}

/**
 * Create a summarizer based on config
 */
export function createSummarizer(config: SummarizerConfig): ISummarizer {
  if (config.useLLM && config.apiKey) {
    return new LLMSummarizer(config);
  }
  return new RuleBasedSummarizer();
}

