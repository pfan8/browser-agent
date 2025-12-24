/**
 * Memory Manager
 * 
 * Handles memory extraction from completed tasks and injection into agent context.
 * Provides high-level memory operations for the agent.
 */

import type {
  Memory,
  MemoryNamespace,
  CreateMemoryInput,
  IMemoryStore,
  MemorySearchOptions,
  TaskSummaryMemory,
  FactMemory,
  UserPreferencesMemory,
  MemoryManagerConfig,
} from './types';
import { createAgentLogger } from '../tracing';

const log = createAgentLogger('MemoryManager');

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<MemoryManagerConfig> = {
  maxMemoriesPerNamespace: 100,
  autoCleanup: true,
  cleanupInterval: 24 * 60 * 60 * 1000, // 24 hours
  defaultExpiryDays: 30,
};

/**
 * Memory Manager
 * 
 * Provides high-level memory operations for the agent:
 * - Extract memories from task results
 * - Inject relevant memories into context
 * - Manage memory lifecycle
 */
export class MemoryManager {
  private store: IMemoryStore;
  private config: Required<MemoryManagerConfig>;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(store: IMemoryStore, config: MemoryManagerConfig = {}) {
    this.store = store;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    if (this.config.autoCleanup) {
      this.startAutoCleanup();
    }
  }

  /**
   * Start automatic cleanup timer
   */
  private startAutoCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.runCleanup().catch(err => {
        log.warn('Auto cleanup failed', { error: err.message });
      });
    }, this.config.cleanupInterval);
  }

  /**
   * Run cleanup of expired and low-importance memories
   */
  async runCleanup(): Promise<number> {
    const maxAge = this.config.defaultExpiryDays * 24 * 60 * 60 * 1000;
    const deleted = await this.store.cleanup({ maxAge, minImportance: 0.2 });
    if (deleted > 0) {
      log.info('Cleaned up memories', { deleted });
    }
    return deleted;
  }

  // ============================================
  // Task Summary Operations
  // ============================================

  /**
   * Save a task summary to memory
   */
  async saveTaskSummary(summary: TaskSummaryMemory): Promise<Memory> {
    const key = `task_${Date.now()}_${summary.threadId || 'unknown'}`;
    
    return this.store.create({
      namespace: 'task_summary',
      key,
      value: summary,
      importance: summary.success ? 0.6 : 0.4,
      importanceLevel: summary.success ? 'medium' : 'low',
      source: 'agent',
      tags: [
        summary.success ? 'success' : 'failure',
        ...(summary.urlsVisited?.map(url => {
          try {
            return new URL(url).hostname;
          } catch {
            return null;
          }
        }).filter(Boolean) as string[] || []),
      ],
    });
  }

  /**
   * Get recent task summaries
   */
  async getRecentTasks(limit: number = 10): Promise<TaskSummaryMemory[]> {
    const memories = await this.store.listByNamespace('task_summary', limit);
    return memories.map(m => m.value as TaskSummaryMemory);
  }

  /**
   * Get task summaries for a specific domain
   */
  async getTasksForDomain(domain: string, limit: number = 5): Promise<TaskSummaryMemory[]> {
    const memories = await this.store.search({
      namespace: 'task_summary',
      tags: [domain],
      limit,
    });
    return memories.map(m => m.value as TaskSummaryMemory);
  }

  // ============================================
  // Fact Operations
  // ============================================

  /**
   * Save a fact to memory
   */
  async saveFact(fact: FactMemory, key?: string): Promise<Memory> {
    const factKey = key || `fact_${Date.now()}`;
    const importance = fact.confidence ?? 0.5;
    
    return this.store.create({
      namespace: 'facts',
      key: factKey,
      value: fact,
      importance,
      importanceLevel: importance >= 0.8 ? 'high' : importance >= 0.5 ? 'medium' : 'low',
      source: fact.source || 'agent',
      tags: fact.category ? [fact.category] : undefined,
    });
  }

  /**
   * Get all facts
   */
  async getFacts(options?: { category?: string; limit?: number }): Promise<FactMemory[]> {
    const searchOptions: MemorySearchOptions = {
      namespace: 'facts',
      limit: options?.limit || 50,
      orderBy: 'importance',
      order: 'desc',
    };
    
    if (options?.category) {
      searchOptions.tags = [options.category];
    }
    
    const memories = await this.store.search(searchOptions);
    return memories.map(m => m.value as FactMemory);
  }

  /**
   * Search facts by content
   */
  async searchFacts(query: string, limit: number = 10): Promise<FactMemory[]> {
    const memories = await this.store.searchByText(query, {
      namespace: 'facts',
      limit,
    });
    return memories.map(m => m.value as FactMemory);
  }

  // ============================================
  // User Preferences Operations
  // ============================================

  /**
   * Get user preferences
   */
  async getUserPreferences(): Promise<UserPreferencesMemory | null> {
    const memory = await this.store.getByKey('user_prefs', 'main');
    return memory?.value as UserPreferencesMemory | null;
  }

  /**
   * Update user preferences
   */
  async updateUserPreferences(prefs: Partial<UserPreferencesMemory>): Promise<Memory> {
    const existing = await this.getUserPreferences();
    const merged: UserPreferencesMemory = {
      ...existing,
      ...prefs,
    };
    
    return this.store.create({
      namespace: 'user_prefs',
      key: 'main',
      value: merged,
      importance: 1.0,
      importanceLevel: 'critical',
      source: 'user',
    });
  }

  /**
   * Add a frequently visited site
   */
  async addFrequentSite(url: string): Promise<void> {
    const prefs = await this.getUserPreferences() || {};
    const sites = prefs.frequentSites || [];
    
    // Add if not already present, move to front if present
    const filtered = sites.filter(s => s !== url);
    filtered.unshift(url);
    
    // Keep only top 20
    await this.updateUserPreferences({
      frequentSites: filtered.slice(0, 20),
    });
  }

  // ============================================
  // Context Injection
  // ============================================

  /**
   * Build memory context for a new task
   * Returns relevant memories to inject into agent context
   */
  async buildContextForTask(goal: string): Promise<{
    userPrefs: UserPreferencesMemory | null;
    relevantFacts: FactMemory[];
    recentTasks: TaskSummaryMemory[];
    contextSummary: string;
  }> {
    log.debug('Building memory context', { goal: goal.substring(0, 50) });
    
    // Get user preferences
    const userPrefs = await this.getUserPreferences();
    
    // Search for relevant facts
    const relevantFacts = await this.searchFacts(goal, 5);
    
    // Get recent successful tasks
    const recentTasks = await this.getRecentTasks(5);
    
    // Build context summary
    const contextSummary = this.buildContextSummary(userPrefs, relevantFacts, recentTasks);
    
    log.debug('Memory context built', {
      hasUserPrefs: !!userPrefs,
      factCount: relevantFacts.length,
      recentTaskCount: recentTasks.length,
    });
    
    return {
      userPrefs,
      relevantFacts,
      recentTasks,
      contextSummary,
    };
  }

  /**
   * Build a text summary of memory context for injection into prompts
   */
  private buildContextSummary(
    userPrefs: UserPreferencesMemory | null,
    facts: FactMemory[],
    recentTasks: TaskSummaryMemory[]
  ): string {
    const parts: string[] = [];
    
    // User preferences
    if (userPrefs) {
      if (userPrefs.language) {
        parts.push(`用户偏好语言: ${userPrefs.language}`);
      }
      if (userPrefs.frequentSites && userPrefs.frequentSites.length > 0) {
        parts.push(`常用网站: ${userPrefs.frequentSites.slice(0, 3).join(', ')}`);
      }
    }
    
    // Relevant facts
    if (facts.length > 0) {
      parts.push(`相关记忆:`);
      for (const fact of facts.slice(0, 3)) {
        parts.push(`  - ${fact.content}`);
      }
    }
    
    // Recent successful tasks
    const successfulTasks = recentTasks.filter(t => t.success).slice(0, 3);
    if (successfulTasks.length > 0) {
      parts.push(`最近完成的任务:`);
      for (const task of successfulTasks) {
        parts.push(`  - ${task.goal.substring(0, 50)}`);
      }
    }
    
    return parts.join('\n');
  }

  // ============================================
  // Memory Extraction from Task Results
  // ============================================

  /**
   * Extract memories from a completed task
   */
  async extractFromTaskResult(result: {
    goal: string;
    success: boolean;
    actionHistory?: Array<{ tool: string; args: Record<string, unknown>; result?: { success: boolean } }>;
    observation?: { url?: string };
    threadId?: string;
    duration?: number;
  }): Promise<void> {
    log.debug('Extracting memories from task result', {
      goal: result.goal.substring(0, 50),
      success: result.success,
    });
    
    // Save task summary
    const urlsVisited = this.extractVisitedUrls(result.actionHistory || []);
    const keyActions = this.extractKeyActions(result.actionHistory || []);
    
    await this.saveTaskSummary({
      goal: result.goal,
      summary: result.success 
        ? `成功完成任务: ${result.goal.substring(0, 100)}`
        : `任务失败: ${result.goal.substring(0, 100)}`,
      success: result.success,
      keyActions,
      urlsVisited,
      duration: result.duration,
      threadId: result.threadId,
    });
    
    // Track frequently visited sites
    if (result.success && urlsVisited.length > 0) {
      for (const url of urlsVisited.slice(0, 3)) {
        try {
          const hostname = new URL(url).origin;
          await this.addFrequentSite(hostname);
        } catch {
          // Ignore invalid URLs
        }
      }
    }
    
    log.debug('Memories extracted', {
      urlsVisited: urlsVisited.length,
      keyActions: keyActions.length,
    });
  }

  /**
   * Extract visited URLs from action history
   */
  private extractVisitedUrls(
    actionHistory: Array<{ tool: string; args: Record<string, unknown> }>
  ): string[] {
    const urls: string[] = [];
    
    for (const action of actionHistory) {
      if (action.tool === 'navigate' && action.args.url) {
        urls.push(action.args.url as string);
      }
    }
    
    return [...new Set(urls)]; // Deduplicate
  }

  /**
   * Extract key actions from action history
   */
  private extractKeyActions(
    actionHistory: Array<{ tool: string; args: Record<string, unknown>; result?: { success: boolean } }>
  ): string[] {
    const actions: string[] = [];
    
    for (const action of actionHistory) {
      if (action.result?.success) {
        let desc = '';
        switch (action.tool) {
          case 'navigate':
            desc = `导航到 ${action.args.url}`;
            break;
          case 'click':
            desc = `点击 ${action.args.selector || action.args.text}`;
            break;
          case 'type':
            desc = `输入文本`;
            break;
          default:
            continue;
        }
        if (desc) {
          actions.push(desc);
        }
      }
    }
    
    return actions.slice(0, 10); // Keep only top 10
  }

  // ============================================
  // Lifecycle
  // ============================================

  /**
   * Get store statistics
   */
  async getStats() {
    return this.store.getStats();
  }

  /**
   * Close the memory manager and store
   */
  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.store.close();
  }
}

