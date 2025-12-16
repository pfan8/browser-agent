/**
 * Checkpointer Configuration
 * 
 * Configures LangGraph's checkpoint system for persistence.
 * Supports MemorySaver (in-memory) and can be extended for SqliteSaver.
 */

import { MemorySaver } from "@langchain/langgraph";

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
 * Creates a checkpointer based on configuration
 */
export function createCheckpointer(config: CheckpointerConfig = { type: 'memory' }) {
  switch (config.type) {
    case 'memory':
      return new MemorySaver();
    
    case 'sqlite':
      // SqliteSaver requires additional setup
      // For now, fall back to MemorySaver
      console.warn('[Checkpointer] SqliteSaver not yet implemented, using MemorySaver');
      return new MemorySaver();
    
    default:
      return new MemorySaver();
  }
}

/**
 * Default checkpointer (in-memory)
 */
export const defaultCheckpointer = new MemorySaver();

