/**
 * Memory Manager
 * 
 * Manages the agent's memory system:
 * - Conversation Memory: Chat history with user
 * - Working Memory: Current task context, observations, intermediate results
 * - Long-term Memory: Persisted facts and learned patterns
 */

import type {
  AgentMemory,
  ConversationMessage,
  WorkingMemoryItem,
  Fact,
  SerializableAgentMemory,
} from '../types';
import { generateId, serializeMemory, deserializeMemory } from '../types';

export class MemoryManager {
  private memory: AgentMemory;

  constructor(initialMemory?: AgentMemory | SerializableAgentMemory) {
    if (initialMemory) {
      // Check if it's serializable format (workingMemory is object, not Map)
      if (!(initialMemory.workingMemory instanceof Map)) {
        this.memory = deserializeMemory(initialMemory as SerializableAgentMemory);
      } else {
        this.memory = initialMemory as AgentMemory;
      }
    } else {
      this.memory = {
        conversation: [],
        workingMemory: new Map(),
        facts: [],
        maxConversationLength: 50,
        maxWorkingMemoryItems: 100,
      };
    }
  }

  // ============================================
  // Conversation Memory
  // ============================================

  /**
   * Add a message to conversation history
   */
  addMessage(role: 'user' | 'agent' | 'system', content: string, metadata?: Record<string, unknown>): ConversationMessage {
    const message: ConversationMessage = {
      id: generateId('msg'),
      role,
      content,
      timestamp: new Date().toISOString(),
      metadata,
    };

    this.memory.conversation.push(message);

    // Trim old messages if exceeding limit
    while (this.memory.conversation.length > this.memory.maxConversationLength) {
      this.memory.conversation.shift();
    }

    return message;
  }

  /**
   * Get recent conversation messages
   */
  getRecentMessages(count?: number): ConversationMessage[] {
    const limit = count || this.memory.maxConversationLength;
    return this.memory.conversation.slice(-limit);
  }

  /**
   * Get all conversation messages
   */
  getAllMessages(): ConversationMessage[] {
    return [...this.memory.conversation];
  }

  /**
   * Clear conversation history
   */
  clearConversation(): void {
    this.memory.conversation = [];
  }

  /**
   * Format conversation for LLM prompt
   */
  formatConversationForPrompt(maxMessages?: number): string {
    const messages = this.getRecentMessages(maxMessages);
    
    return messages.map(msg => {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'agent' ? 'Agent' : 'System';
      return `${roleLabel}: ${msg.content}`;
    }).join('\n\n');
  }

  // ============================================
  // Working Memory
  // ============================================

  /**
   * Set a working memory item
   */
  setWorkingMemory(key: string, value: unknown, type: WorkingMemoryItem['type'] = 'variable', ttlMs?: number): void {
    const item: WorkingMemoryItem = {
      key,
      value,
      type,
      timestamp: new Date().toISOString(),
      expiresAt: ttlMs ? new Date(Date.now() + ttlMs).toISOString() : undefined,
    };

    const workingMemory = this.memory.workingMemory;
    if (workingMemory instanceof Map) {
      workingMemory.set(key, item);
    } else {
      workingMemory[key] = item;
    }

    // Enforce max items limit
    this.cleanupWorkingMemory();
  }

  /**
   * Get a working memory item
   */
  getWorkingMemory<T = unknown>(key: string): T | undefined {
    const workingMemory = this.memory.workingMemory;
    let item: WorkingMemoryItem | undefined;
    
    if (workingMemory instanceof Map) {
      item = workingMemory.get(key);
    } else {
      item = workingMemory[key];
    }

    if (!item) return undefined;

    // Check if expired
    if (item.expiresAt && new Date(item.expiresAt) < new Date()) {
      this.deleteWorkingMemory(key);
      return undefined;
    }

    return item.value as T;
  }

  /**
   * Delete a working memory item
   */
  deleteWorkingMemory(key: string): boolean {
    const workingMemory = this.memory.workingMemory;
    if (workingMemory instanceof Map) {
      return workingMemory.delete(key);
    } else {
      if (key in workingMemory) {
        delete workingMemory[key];
        return true;
      }
      return false;
    }
  }

  /**
   * Get all working memory items of a specific type
   */
  getWorkingMemoryByType(type: WorkingMemoryItem['type']): WorkingMemoryItem[] {
    const workingMemory = this.memory.workingMemory;
    const items: WorkingMemoryItem[] = [];

    if (workingMemory instanceof Map) {
      workingMemory.forEach(item => {
        if (item.type === type) items.push(item);
      });
    } else {
      Object.values(workingMemory).forEach(item => {
        if (item.type === type) items.push(item);
      });
    }

    return items;
  }

  /**
   * Clear all working memory
   */
  clearWorkingMemory(): void {
    if (this.memory.workingMemory instanceof Map) {
      this.memory.workingMemory.clear();
    } else {
      this.memory.workingMemory = {};
    }
  }

  /**
   * Cleanup expired items and enforce size limit
   */
  private cleanupWorkingMemory(): void {
    const workingMemory = this.memory.workingMemory;
    const now = new Date();
    const toDelete: string[] = [];

    // Find expired items
    if (workingMemory instanceof Map) {
      workingMemory.forEach((item, key) => {
        if (item.expiresAt && new Date(item.expiresAt) < now) {
          toDelete.push(key);
        }
      });
    } else {
      Object.entries(workingMemory).forEach(([key, item]) => {
        if (item.expiresAt && new Date(item.expiresAt) < now) {
          toDelete.push(key);
        }
      });
    }

    // Delete expired items
    for (const key of toDelete) {
      this.deleteWorkingMemory(key);
    }

    // Enforce max items limit (remove oldest)
    const size = workingMemory instanceof Map ? workingMemory.size : Object.keys(workingMemory).length;
    if (size > this.memory.maxWorkingMemoryItems) {
      const entries: [string, WorkingMemoryItem][] = workingMemory instanceof Map 
        ? Array.from(workingMemory.entries())
        : Object.entries(workingMemory);

      // Sort by timestamp (oldest first)
      entries.sort((a, b) => 
        new Date(a[1].timestamp).getTime() - new Date(b[1].timestamp).getTime()
      );

      // Delete oldest items
      const toRemove = size - this.memory.maxWorkingMemoryItems;
      for (let i = 0; i < toRemove; i++) {
        this.deleteWorkingMemory(entries[i][0]);
      }
    }
  }

  /**
   * Store the latest observation
   */
  storeObservation(observation: unknown): void {
    this.setWorkingMemory('latest_observation', observation, 'observation');
  }

  /**
   * Get the latest observation
   */
  getLatestObservation<T = unknown>(): T | undefined {
    return this.getWorkingMemory<T>('latest_observation');
  }

  // ============================================
  // Long-term Memory (Facts)
  // ============================================

  /**
   * Add a fact to long-term memory
   */
  addFact(content: string, source: Fact['source'] = 'extracted', confidence: number = 1.0): Fact {
    // Check for duplicate
    const existing = this.memory.facts.find(f => f.content === content);
    if (existing) {
      existing.lastUsedAt = new Date().toISOString();
      existing.useCount++;
      return existing;
    }

    const fact: Fact = {
      id: generateId('fact'),
      content,
      source,
      confidence,
      createdAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      useCount: 1,
    };

    this.memory.facts.push(fact);
    return fact;
  }

  /**
   * Search facts by content
   */
  searchFacts(query: string): Fact[] {
    const lowerQuery = query.toLowerCase();
    return this.memory.facts.filter(f => 
      f.content.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get all facts
   */
  getAllFacts(): Fact[] {
    return [...this.memory.facts];
  }

  /**
   * Get most used facts
   */
  getMostUsedFacts(limit: number = 10): Fact[] {
    return [...this.memory.facts]
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  /**
   * Remove a fact
   */
  removeFact(factId: string): boolean {
    const index = this.memory.facts.findIndex(f => f.id === factId);
    if (index >= 0) {
      this.memory.facts.splice(index, 1);
      return true;
    }
    return false;
  }

  /**
   * Mark a fact as used (update lastUsedAt and useCount)
   */
  useFact(factId: string): void {
    const fact = this.memory.facts.find(f => f.id === factId);
    if (fact) {
      fact.lastUsedAt = new Date().toISOString();
      fact.useCount++;
    }
  }

  /**
   * Clear all facts
   */
  clearFacts(): void {
    this.memory.facts = [];
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Get the raw memory object
   */
  getMemory(): AgentMemory {
    return this.memory;
  }

  /**
   * Serialize memory for storage
   */
  serialize(): SerializableAgentMemory {
    return serializeMemory(this.memory);
  }

  /**
   * Load from serialized data
   */
  loadFromSerialized(data: SerializableAgentMemory): void {
    this.memory = deserializeMemory(data);
  }

  /**
   * Create a summary of the current memory state
   */
  getSummary(): string {
    const wmSize = this.memory.workingMemory instanceof Map 
      ? this.memory.workingMemory.size 
      : Object.keys(this.memory.workingMemory).length;

    return [
      `Conversation: ${this.memory.conversation.length} messages`,
      `Working Memory: ${wmSize} items`,
      `Facts: ${this.memory.facts.length} stored`,
    ].join('\n');
  }

  /**
   * Clear all memory
   */
  clearAll(): void {
    this.clearConversation();
    this.clearWorkingMemory();
    this.clearFacts();
  }
}

// Export singleton for convenience (though instances are preferred)
export const memoryManager = new MemoryManager();

