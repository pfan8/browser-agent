/**
 * Memory Module
 * 
 * Long-term memory system for the browser automation agent.
 * Provides persistent storage of user preferences, facts, and task summaries
 * across sessions.
 */

// Types
export * from './types';

// SQLite Store Implementation
export { SqliteMemoryStore } from './sqlite-store';

// Memory Manager
export { MemoryManager } from './memory-manager';

