/**
 * SQLite Memory Store
 * 
 * Persistent memory storage using SQLite.
 * Implements IMemoryStore interface for long-term memory management.
 * 
 * Note: Falls back to in-memory storage if the native SQLite module
 * (better-sqlite3) fails to load.
 */

import type {
  Memory,
  MemoryNamespace,
  CreateMemoryInput,
  UpdateMemoryInput,
  MemorySearchOptions,
  IMemoryStore,
  MemoryStoreStats,
  MemoryImportance,
} from './types';

/**
 * Generate a unique memory ID
 */
function generateMemoryId(): string {
  return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Convert importance level to numeric score
 */
function importanceLevelToScore(level: MemoryImportance): number {
  switch (level) {
    case 'critical': return 1.0;
    case 'high': return 0.8;
    case 'medium': return 0.5;
    case 'low': return 0.2;
    default: return 0.5;
  }
}

/**
 * Convert numeric score to importance level
 */
function scoreToImportanceLevel(score: number): MemoryImportance {
  if (score >= 0.9) return 'critical';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * SQLite-based memory store implementation
 */
export class SqliteMemoryStore implements IMemoryStore {
  private db: import('better-sqlite3').Database | null = null;
  private dbPath: string;
  private useFallback: boolean = false;
  private inMemoryStore: Map<string, Memory> = new Map();

  constructor(dbPath: string = './data/memory.db') {
    this.dbPath = dbPath;
    
    try {
      // Lazy load better-sqlite3
      const Database = require('better-sqlite3');
      
      // Ensure directory exists
      const path = require('path');
      const fs = require('fs');
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      this.db = new Database(dbPath);
      this.initializeTables();
      console.log('[SqliteMemoryStore] SQLite initialized successfully:', dbPath);
    } catch (error) {
      console.warn('[SqliteMemoryStore] Failed to load SQLite, using in-memory fallback:',
        error instanceof Error ? error.message : String(error));
      this.useFallback = true;
      this.db = null;
    }
  }

  /**
   * Check if using fallback mode
   */
  isUsingFallback(): boolean {
    return this.useFallback;
  }

  /**
   * Initialize SQLite tables
   */
  private initializeTables(): void {
    if (!this.db) return;
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        importance_level TEXT NOT NULL DEFAULT 'medium',
        source TEXT NOT NULL DEFAULT 'agent',
        tags_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT,
        UNIQUE(namespace, key)
      );
      
      CREATE INDEX IF NOT EXISTS idx_memories_namespace 
        ON memories(namespace);
      CREATE INDEX IF NOT EXISTS idx_memories_importance 
        ON memories(importance DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_updated 
        ON memories(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_expires 
        ON memories(expires_at);
    `);
  }

  /**
   * Convert database row to Memory object
   */
  private rowToMemory(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      namespace: row.namespace as MemoryNamespace,
      key: row.key as string,
      value: JSON.parse(row.value_json as string),
      metadata: {
        createdAt: row.created_at as string,
        updatedAt: row.updated_at as string,
        lastAccessedAt: row.last_accessed_at as string,
        accessCount: row.access_count as number,
        importance: row.importance as number,
        importanceLevel: row.importance_level as MemoryImportance,
        source: row.source as string,
        tags: row.tags_json ? JSON.parse(row.tags_json as string) : undefined,
        expiresAt: (row.expires_at as string) || undefined,
      },
    };
  }

  /**
   * Create a new memory
   */
  async create(input: CreateMemoryInput): Promise<Memory> {
    const now = new Date().toISOString();
    const id = generateMemoryId();
    
    const importance = input.importance ?? 
      (input.importanceLevel ? importanceLevelToScore(input.importanceLevel) : 0.5);
    const importanceLevel = input.importanceLevel ?? scoreToImportanceLevel(importance);
    
    if (this.useFallback || !this.db) {
      // In-memory fallback
      // Check for existing by namespace+key
      for (const [existingId, m] of this.inMemoryStore) {
        if (m.namespace === input.namespace && m.key === input.key) {
          // Update existing
          const updated: Memory = {
            ...m,
            value: input.value,
            metadata: {
              ...m.metadata,
              updatedAt: now,
              importance,
              importanceLevel,
              tags: input.tags || m.metadata.tags,
              expiresAt: input.expiresAt || m.metadata.expiresAt,
            },
          };
          this.inMemoryStore.set(existingId, updated);
          return updated;
        }
      }
      
      // Create new
      const memory: Memory = {
        id,
        namespace: input.namespace,
        key: input.key,
        value: input.value,
        metadata: {
          createdAt: now,
          updatedAt: now,
          lastAccessedAt: now,
          accessCount: 0,
          importance,
          importanceLevel,
          source: input.source || 'agent',
          tags: input.tags,
          expiresAt: input.expiresAt,
        },
      };
      this.inMemoryStore.set(id, memory);
      return memory;
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO memories (
        id, namespace, key, value_json, importance, importance_level,
        source, tags_json, created_at, updated_at, last_accessed_at, 
        access_count, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET
        value_json = excluded.value_json,
        importance = excluded.importance,
        importance_level = excluded.importance_level,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
    `);
    
    stmt.run(
      id,
      input.namespace,
      input.key,
      JSON.stringify(input.value),
      importance,
      importanceLevel,
      input.source || 'agent',
      input.tags ? JSON.stringify(input.tags) : null,
      now,
      now,
      now,
      input.expiresAt || null
    );
    
    return (await this.getByKey(input.namespace, input.key))!;
  }

  /**
   * Get memory by ID
   */
  async get(id: string): Promise<Memory | null> {
    if (this.useFallback || !this.db) {
      return this.inMemoryStore.get(id) || null;
    }
    
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE id = ?`);
    const row = stmt.get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  /**
   * Get memory by namespace and key
   */
  async getByKey(namespace: MemoryNamespace, key: string): Promise<Memory | null> {
    if (this.useFallback || !this.db) {
      for (const m of this.inMemoryStore.values()) {
        if (m.namespace === namespace && m.key === key) {
          return m;
        }
      }
      return null;
    }
    
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE namespace = ? AND key = ?
    `);
    const row = stmt.get(namespace, key) as Record<string, unknown> | undefined;
    return row ? this.rowToMemory(row) : null;
  }

  /**
   * Update a memory
   */
  async update(id: string, input: UpdateMemoryInput): Promise<Memory | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    
    const now = new Date().toISOString();
    
    if (this.useFallback || !this.db) {
      const updated: Memory = {
        ...existing,
        value: input.value !== undefined ? input.value : existing.value,
        metadata: {
          ...existing.metadata,
          updatedAt: now,
          importance: input.importance ?? existing.metadata.importance,
          importanceLevel: input.importanceLevel ?? existing.metadata.importanceLevel,
          tags: input.tags ?? existing.metadata.tags,
          expiresAt: input.expiresAt ?? existing.metadata.expiresAt,
        },
      };
      this.inMemoryStore.set(id, updated);
      return updated;
    }
    
    const updates: string[] = ['updated_at = ?'];
    const values: unknown[] = [now];
    
    if (input.value !== undefined) {
      updates.push('value_json = ?');
      values.push(JSON.stringify(input.value));
    }
    
    if (input.importance !== undefined) {
      updates.push('importance = ?');
      values.push(input.importance);
      updates.push('importance_level = ?');
      values.push(scoreToImportanceLevel(input.importance));
    } else if (input.importanceLevel !== undefined) {
      updates.push('importance_level = ?');
      values.push(input.importanceLevel);
      updates.push('importance = ?');
      values.push(importanceLevelToScore(input.importanceLevel));
    }
    
    if (input.tags !== undefined) {
      updates.push('tags_json = ?');
      values.push(JSON.stringify(input.tags));
    }
    
    if (input.expiresAt !== undefined) {
      updates.push('expires_at = ?');
      values.push(input.expiresAt);
    }
    
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE memories SET ${updates.join(', ')} WHERE id = ?
    `);
    stmt.run(...values);
    
    return this.get(id);
  }

  /**
   * Delete a memory
   */
  async delete(id: string): Promise<boolean> {
    if (this.useFallback || !this.db) {
      return this.inMemoryStore.delete(id);
    }
    
    const stmt = this.db.prepare(`DELETE FROM memories WHERE id = ?`);
    const result = stmt.run(id);
    return result.changes > 0;
  }

  /**
   * Search memories with options
   */
  async search(options: MemorySearchOptions = {}): Promise<Memory[]> {
    if (this.useFallback || !this.db) {
      return this.searchInMemory(options);
    }
    
    const conditions: string[] = [];
    const values: unknown[] = [];
    
    if (options.namespace) {
      conditions.push('namespace = ?');
      values.push(options.namespace);
    }
    
    if (options.minImportance !== undefined) {
      conditions.push('importance >= ?');
      values.push(options.minImportance);
    }
    
    if (!options.includeExpired) {
      conditions.push('(expires_at IS NULL OR expires_at > ?)');
      values.push(new Date().toISOString());
    }
    
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}` 
      : '';
    
    const orderBy = options.orderBy || 'updated_at';
    const order = options.order || 'desc';
    const limit = options.limit || 100;
    
    const stmt = this.db.prepare(`
      SELECT * FROM memories 
      ${whereClause}
      ORDER BY ${orderBy} ${order.toUpperCase()}
      LIMIT ?
    `);
    
    const rows = stmt.all(...values, limit) as Array<Record<string, unknown>>;
    let memories = rows.map(row => this.rowToMemory(row));
    
    // Filter by tags if specified (done in JS for flexibility)
    if (options.tags && options.tags.length > 0) {
      memories = memories.filter(m => {
        if (!m.metadata.tags) return false;
        return options.tags!.some(tag => m.metadata.tags!.includes(tag));
      });
    }
    
    return memories;
  }

  /**
   * In-memory search implementation
   */
  private searchInMemory(options: MemorySearchOptions): Memory[] {
    const now = new Date().toISOString();
    let results = Array.from(this.inMemoryStore.values());
    
    // Filter by namespace
    if (options.namespace) {
      results = results.filter(m => m.namespace === options.namespace);
    }
    
    // Filter by importance
    if (options.minImportance !== undefined) {
      results = results.filter(m => m.metadata.importance >= options.minImportance!);
    }
    
    // Filter expired
    if (!options.includeExpired) {
      results = results.filter(m => 
        !m.metadata.expiresAt || m.metadata.expiresAt > now
      );
    }
    
    // Filter by tags
    if (options.tags && options.tags.length > 0) {
      results = results.filter(m => {
        if (!m.metadata.tags) return false;
        return options.tags!.some(tag => m.metadata.tags!.includes(tag));
      });
    }
    
    // Sort
    const orderBy = options.orderBy || 'updated_at';
    const order = options.order || 'desc';
    results.sort((a, b) => {
      const aVal = orderBy === 'importance' 
        ? a.metadata.importance 
        : new Date(a.metadata.updatedAt).getTime();
      const bVal = orderBy === 'importance'
        ? b.metadata.importance
        : new Date(b.metadata.updatedAt).getTime();
      return order === 'desc' ? bVal - aVal : aVal - bVal;
    });
    
    // Limit
    const limit = options.limit || 100;
    return results.slice(0, limit);
  }

  /**
   * Search memories by text content
   */
  async searchByText(query: string, options: MemorySearchOptions = {}): Promise<Memory[]> {
    const queryLower = query.toLowerCase();
    
    // Get all memories matching other criteria
    const memories = await this.search(options);
    
    // Filter by text match in value
    return memories.filter(m => {
      const valueStr = JSON.stringify(m.value).toLowerCase();
      return valueStr.includes(queryLower);
    });
  }

  /**
   * List memories by namespace
   */
  async listByNamespace(namespace: MemoryNamespace, limit: number = 50): Promise<Memory[]> {
    return this.search({ namespace, limit });
  }

  /**
   * Clear all memories in a namespace
   */
  async clearNamespace(namespace: MemoryNamespace): Promise<number> {
    if (this.useFallback || !this.db) {
      let count = 0;
      for (const [id, m] of this.inMemoryStore) {
        if (m.namespace === namespace) {
          this.inMemoryStore.delete(id);
          count++;
        }
      }
      return count;
    }
    
    const stmt = this.db.prepare(`DELETE FROM memories WHERE namespace = ?`);
    const result = stmt.run(namespace);
    return result.changes;
  }

  /**
   * Record memory access (update access count and timestamp)
   */
  async recordAccess(id: string): Promise<void> {
    const now = new Date().toISOString();
    
    if (this.useFallback || !this.db) {
      const memory = this.inMemoryStore.get(id);
      if (memory) {
        memory.metadata.lastAccessedAt = now;
        memory.metadata.accessCount++;
      }
      return;
    }
    
    const stmt = this.db.prepare(`
      UPDATE memories 
      SET last_accessed_at = ?, access_count = access_count + 1
      WHERE id = ?
    `);
    stmt.run(now, id);
  }

  /**
   * Cleanup old or low-importance memories
   */
  async cleanup(options: { maxAge?: number; minImportance?: number } = {}): Promise<number> {
    const now = new Date();
    
    if (this.useFallback || !this.db) {
      let count = 0;
      for (const [id, m] of this.inMemoryStore) {
        // Delete expired
        if (m.metadata.expiresAt && m.metadata.expiresAt < now.toISOString()) {
          this.inMemoryStore.delete(id);
          count++;
          continue;
        }
        // Delete old low-importance
        if (options.maxAge) {
          const cutoff = new Date(now.getTime() - options.maxAge).toISOString();
          const minImportance = options.minImportance ?? 0.3;
          if (m.metadata.updatedAt < cutoff && m.metadata.importance < minImportance) {
            this.inMemoryStore.delete(id);
            count++;
          }
        }
      }
      return count;
    }
    
    const conditions: string[] = [];
    const values: unknown[] = [];
    
    // Delete expired memories
    conditions.push('expires_at IS NOT NULL AND expires_at < ?');
    values.push(now.toISOString());
    
    // Delete old low-importance memories
    if (options.maxAge) {
      const cutoffDate = new Date(now.getTime() - options.maxAge).toISOString();
      const minImportance = options.minImportance ?? 0.3;
      conditions.push(`(updated_at < ? AND importance < ?)`);
      values.push(cutoffDate, minImportance);
    }
    
    const stmt = this.db.prepare(`
      DELETE FROM memories WHERE ${conditions.join(' OR ')}
    `);
    const result = stmt.run(...values);
    return result.changes;
  }

  /**
   * Get memory store statistics
   */
  async getStats(): Promise<MemoryStoreStats> {
    if (this.useFallback || !this.db) {
      const byNamespace: Record<MemoryNamespace, number> = {
        user_prefs: 0,
        facts: 0,
        task_summary: 0,
        learned_paths: 0,
        custom: 0,
      };
      
      let oldest: string | undefined;
      let newest: string | undefined;
      let totalImportance = 0;
      
      for (const m of this.inMemoryStore.values()) {
        byNamespace[m.namespace] = (byNamespace[m.namespace] || 0) + 1;
        totalImportance += m.metadata.importance;
        if (!oldest || m.metadata.createdAt < oldest) oldest = m.metadata.createdAt;
        if (!newest || m.metadata.createdAt > newest) newest = m.metadata.createdAt;
      }
      
      return {
        totalMemories: this.inMemoryStore.size,
        byNamespace,
        oldestMemory: oldest,
        newestMemory: newest,
        averageImportance: this.inMemoryStore.size > 0 
          ? totalImportance / this.inMemoryStore.size 
          : 0,
      };
    }
    
    const totalStmt = this.db.prepare(`SELECT COUNT(*) as count FROM memories`);
    const total = (totalStmt.get() as { count: number }).count;
    
    const namespaceStmt = this.db.prepare(`
      SELECT namespace, COUNT(*) as count FROM memories GROUP BY namespace
    `);
    const namespaceRows = namespaceStmt.all() as Array<{ namespace: string; count: number }>;
    
    const byNamespace: Record<MemoryNamespace, number> = {
      user_prefs: 0,
      facts: 0,
      task_summary: 0,
      learned_paths: 0,
      custom: 0,
    };
    
    for (const row of namespaceRows) {
      byNamespace[row.namespace as MemoryNamespace] = row.count;
    }
    
    const dateStmt = this.db.prepare(`
      SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memories
    `);
    const dates = dateStmt.get() as { oldest: string | null; newest: string | null };
    
    const avgStmt = this.db.prepare(`
      SELECT AVG(importance) as avg FROM memories
    `);
    const avgResult = avgStmt.get() as { avg: number | null };
    
    return {
      totalMemories: total,
      byNamespace,
      oldestMemory: dates.oldest || undefined,
      newestMemory: dates.newest || undefined,
      averageImportance: avgResult.avg || 0,
    };
  }

  /**
   * Close the database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
    }
  }
}
