/**
 * Checkpointer Configuration
 * 
 * Uses LangGraph's native SqliteSaver for checkpoint persistence.
 * Includes ThreadMetadataStore for UI session management (names, descriptions).
 */

import { MemorySaver, type BaseCheckpointSaver } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";

/**
 * Checkpointer types
 */
export type CheckpointerType = 'memory' | 'sqlite';

/**
 * Configuration for the checkpointer
 */
export interface CheckpointerConfig {
  type: CheckpointerType;
  sqlitePath?: string;
}

/**
 * Thread metadata stored in SQLite (for UI display)
 */
export interface ThreadMetadata {
  threadId: string;
  createdAt: string;
  updatedAt: string;
  name?: string;
  description?: string;
  messageCount: number;
}

/**
 * Checkpoint history item for restore functionality
 */
export interface CheckpointHistoryItem {
  checkpointId: string;
  threadId: string;
  parentCheckpointId?: string;
  createdAt: string;
  step: number;
  metadata?: {
    source?: string;
    writes?: Record<string, unknown>;
  };
  messagePreview?: string;
  isUserMessage: boolean;
}

/**
 * In-memory thread storage for fallback mode
 */
interface InMemoryThread {
  metadata: ThreadMetadata;
}

/**
 * Thread Metadata Store
 * 
 * Manages thread metadata (names, descriptions) separately from checkpoints.
 * This is used for UI session list display.
 */
export class ThreadMetadataStore {
  private db: import('better-sqlite3').Database | null = null;
  private useFallback: boolean = false;
  private inMemoryThreads: Map<string, InMemoryThread> = new Map();

  constructor(dbPath: string = './data/thread_metadata.db') {
    try {
      const Database = require('better-sqlite3');
      const path = require('path');
      const fs = require('fs');
      
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      this.db = new Database(dbPath);
      this.initializeTables();
      console.log('[ThreadMetadataStore] SQLite initialized:', dbPath);
    } catch (error) {
      console.warn('[ThreadMetadataStore] Using in-memory fallback:', 
        error instanceof Error ? error.message : String(error));
      this.useFallback = true;
      this.db = null;
    }
  }

  private initializeTables(): void {
    if (!this.db) return;
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS thread_metadata (
        thread_id TEXT PRIMARY KEY,
        name TEXT,
        description TEXT,
        message_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_thread_metadata_updated 
        ON thread_metadata(updated_at DESC);
    `);
  }

  createThread(threadId: string, name?: string, description?: string): ThreadMetadata {
    const now = new Date().toISOString();
    
    if (this.useFallback || !this.db) {
      const existing = this.inMemoryThreads.get(threadId);
      if (existing) {
        if (name !== undefined) existing.metadata.name = name;
        if (description !== undefined) existing.metadata.description = description;
        existing.metadata.updatedAt = now;
        return existing.metadata;
      }
      
      const metadata: ThreadMetadata = {
        threadId,
        name,
        description,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.inMemoryThreads.set(threadId, { metadata });
      return metadata;
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO thread_metadata (thread_id, name, description, message_count, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        name = COALESCE(excluded.name, thread_metadata.name),
        description = COALESCE(excluded.description, thread_metadata.description),
        updated_at = excluded.updated_at
    `);
    
    stmt.run(threadId, name || null, description || null, now, now);
    return this.getThread(threadId)!;
  }

  getThread(threadId: string): ThreadMetadata | null {
    if (this.useFallback || !this.db) {
      const thread = this.inMemoryThreads.get(threadId);
      return thread?.metadata || null;
    }
    
    const stmt = this.db.prepare(`
      SELECT thread_id, name, description, message_count, created_at, updated_at
      FROM thread_metadata WHERE thread_id = ?
    `);
    
    const row = stmt.get(threadId) as {
      thread_id: string;
      name: string | null;
      description: string | null;
      message_count: number;
      created_at: string;
      updated_at: string;
    } | undefined;
    
    if (!row) return null;
    
    return {
      threadId: row.thread_id,
      name: row.name || undefined,
      description: row.description || undefined,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  listThreads(limit: number = 50): ThreadMetadata[] {
    if (this.useFallback || !this.db) {
      return Array.from(this.inMemoryThreads.values())
        .map(t => t.metadata)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
    }
    
    const stmt = this.db.prepare(`
      SELECT thread_id, name, description, message_count, created_at, updated_at
      FROM thread_metadata
      ORDER BY updated_at DESC
      LIMIT ?
    `);
    
    const rows = stmt.all(limit) as Array<{
      thread_id: string;
      name: string | null;
      description: string | null;
      message_count: number;
      created_at: string;
      updated_at: string;
    }>;
    
    return rows.map(row => ({
      threadId: row.thread_id,
      name: row.name || undefined,
      description: row.description || undefined,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  updateThreadActivity(threadId: string, messageCount: number): void {
    const now = new Date().toISOString();
    
    if (this.useFallback || !this.db) {
      const thread = this.inMemoryThreads.get(threadId);
      if (thread) {
        thread.metadata.messageCount = messageCount;
        thread.metadata.updatedAt = now;
      }
      return;
    }
    
    const stmt = this.db.prepare(`
      UPDATE thread_metadata 
      SET message_count = ?, updated_at = ?
      WHERE thread_id = ?
    `);
    
    stmt.run(messageCount, now, threadId);
  }

  deleteThread(threadId: string): boolean {
    if (this.useFallback || !this.db) {
      return this.inMemoryThreads.delete(threadId);
    }
    
    const stmt = this.db.prepare(`DELETE FROM thread_metadata WHERE thread_id = ?`);
    const result = stmt.run(threadId);
    return result.changes > 0;
  }

  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}

/**
 * Persistent Checkpointer using LangGraph's SqliteSaver
 * 
 * Combines:
 * - SqliteSaver: LangGraph native checkpoint persistence with full history
 * - ThreadMetadataStore: UI-friendly session metadata
 */
export class PersistentCheckpointer {
  private sqliteSaver: SqliteSaver;
  private metadataStore: ThreadMetadataStore;
  private dbPath: string;
  private useFallback: boolean = false;
  private memorySaver: MemorySaver | null = null;

  constructor(dbPath: string = './data/checkpoints.db') {
    this.dbPath = dbPath;
    
    try {
      const path = require('path');
      const fs = require('fs');
      
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Use LangGraph's SqliteSaver for checkpoint persistence
      this.sqliteSaver = SqliteSaver.fromConnString(dbPath);
      
      // Use separate metadata store for UI session info
      const metadataPath = path.join(dir, 'thread_metadata.db');
      this.metadataStore = new ThreadMetadataStore(metadataPath);
      
      console.log('[PersistentCheckpointer] Initialized with SqliteSaver:', dbPath);
    } catch (error) {
      console.warn('[PersistentCheckpointer] SqliteSaver failed, using MemorySaver fallback:', 
        error instanceof Error ? error.message : String(error));
      this.useFallback = true;
      this.memorySaver = new MemorySaver();
      this.sqliteSaver = null as any;
      this.metadataStore = new ThreadMetadataStore();
    }
  }

  /**
   * Get the underlying checkpointer for LangGraph graph.compile()
   */
  getCheckpointer(): BaseCheckpointSaver {
    if (this.useFallback && this.memorySaver) {
      return this.memorySaver;
    }
    return this.sqliteSaver;
  }

  /**
   * Check if using fallback mode
   */
  isUsingFallback(): boolean {
    return this.useFallback;
  }

  // ============================================
  // Thread Metadata Methods (for UI)
  // ============================================

  createThread(threadId: string, name?: string, description?: string): ThreadMetadata {
    return this.metadataStore.createThread(threadId, name, description);
  }

  getThread(threadId: string): ThreadMetadata | null {
    return this.metadataStore.getThread(threadId);
  }

  listThreads(limit: number = 50): ThreadMetadata[] {
    return this.metadataStore.listThreads(limit);
  }

  updateThreadActivity(threadId: string, messageCount: number): void {
    this.metadataStore.updateThreadActivity(threadId, messageCount);
  }

  deleteThread(threadId: string): boolean {
    return this.metadataStore.deleteThread(threadId);
  }

  // ============================================
  // Checkpoint Access Methods
  // ============================================

  /**
   * Get the database path
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Close all database connections
   */
  close(): void {
    this.metadataStore.close();
    // SqliteSaver doesn't have a close method, it manages connections internally
  }
}

// ============================================
// Legacy Compatibility - SqliteCheckpointer alias
// ============================================

/**
 * @deprecated Use PersistentCheckpointer instead
 */
export class SqliteCheckpointer extends PersistentCheckpointer {
  constructor(dbPath?: string) {
    super(dbPath);
    console.warn('[SqliteCheckpointer] Deprecated: Use PersistentCheckpointer instead');
  }
}

/**
 * Creates a checkpointer based on configuration
 */
export function createCheckpointer(
  config: CheckpointerConfig = { type: 'memory' }
): BaseCheckpointSaver | PersistentCheckpointer {
  switch (config.type) {
    case 'memory':
      return new MemorySaver();
    
    case 'sqlite':
      return new PersistentCheckpointer(config.sqlitePath);
    
    default:
      return new MemorySaver();
  }
}

/**
 * Default checkpointer (in-memory)
 */
export const defaultCheckpointer = new MemorySaver();
