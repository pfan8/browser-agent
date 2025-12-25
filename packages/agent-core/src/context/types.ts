/**
 * Context Management Types
 * 
 * Defines types for layered context management and conversation summarization.
 * Based on the hierarchical context strategy:
 * - L0: System rules (permanent)
 * - L1: User profile + context summary
 * - L2: Current task message
 * - L3: Recent conversation (sliding window)
 */

import type { BaseMessage } from '@langchain/core/messages';

/**
 * Configuration for context management
 */
export interface ContextConfig {
  /** Maximum tokens for the entire context (default: 8000) */
  maxTokens: number;
  /** Maximum number of recent messages to keep in L3 sliding window (default: 6) */
  maxRecentMessages: number;
  /** Number of messages that triggers summarization (default: 10) */
  summaryThreshold: number;
  /** Model to use for generating summaries (optional, uses main model if not set) */
  summaryModel?: string;
  /** API key for summary model */
  summaryApiKey?: string;
  /** Base URL for summary model */
  summaryBaseUrl?: string;
}

/**
 * Default context configuration
 */
export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxTokens: 8000,
  maxRecentMessages: 6,
  summaryThreshold: 10,
};

/**
 * Layered context structure for LLM requests
 */
export interface LayeredContext {
  /** L0: Permanent system rules */
  systemRules: string;
  /** L1: User profile + conversation summary */
  contextSummary: string;
  /** L2: Current task/user message */
  currentTaskMessage: string;
  /** L3: Recent messages (sliding window) */
  recentMessages: BaseMessage[];
}

/**
 * Input for building context
 */
export interface BuildContextInput {
  /** Current goal/task */
  goal: string;
  /** Last action result */
  lastActionResult?: {
    step: string;
    success: boolean;
    error?: string;
    /** Summary of the execution output (truncated if too long) */
    outputSummary?: string;
  };
  /** Conversation summary from previous iterations */
  conversationSummary?: string;
  /** Full message history */
  messages: BaseMessage[];
  /** Memory context (user preferences, facts, etc.) */
  memoryContext?: {
    contextSummary?: string;
    relevantFacts?: string[];
    recentTasks?: string[];
  };
}

/**
 * Result of context building, includes updated summary if generated
 */
export interface BuildContextResult {
  /** The layered context for LLM */
  context: LayeredContext;
  /** Updated conversation summary (if summarization was triggered) */
  newSummary?: string;
  /** Number of messages included in the summary */
  summarizedMessageCount?: number;
}

/**
 * Summarizer interface for generating conversation summaries
 */
export interface ISummarizer {
  /**
   * Generate a summary of the given messages
   * @param messages Messages to summarize
   * @param existingSummary Existing summary to incorporate
   * @returns Generated summary text
   */
  summarize(messages: BaseMessage[], existingSummary?: string): Promise<string>;
}

