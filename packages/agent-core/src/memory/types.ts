/**
 * Memory Types
 * 
 * Type definitions for the long-term memory system.
 * Supports cross-session storage of user preferences, facts, and task summaries.
 */

/**
 * Memory namespace for categorizing memories
 */
export type MemoryNamespace = 
  | 'user_prefs'     // User preferences (e.g., preferred language, sites)
  | 'facts'          // Important facts about the user or context
  | 'task_summary'   // Summaries of completed tasks
  | 'learned_paths'  // Learned navigation paths/patterns
  | 'custom';        // Custom namespace

/**
 * Memory importance level
 */
export type MemoryImportance = 'low' | 'medium' | 'high' | 'critical';

/**
 * Memory metadata
 */
export interface MemoryMetadata {
  /** When the memory was created */
  createdAt: string;
  /** When the memory was last updated */
  updatedAt: string;
  /** When the memory was last accessed */
  lastAccessedAt: string;
  /** Number of times this memory has been accessed */
  accessCount: number;
  /** Importance score (0-1), used for cleanup decisions */
  importance: number;
  /** Importance level category */
  importanceLevel: MemoryImportance;
  /** Source of the memory (e.g., 'user', 'agent', 'system') */
  source: string;
  /** Optional tags for categorization */
  tags?: string[];
  /** Optional expiry date */
  expiresAt?: string;
}

/**
 * A single memory entry
 */
export interface Memory {
  /** Unique identifier */
  id: string;
  /** Namespace for categorization */
  namespace: MemoryNamespace;
  /** Key for lookup within namespace */
  key: string;
  /** The actual memory content */
  value: unknown;
  /** Memory metadata */
  metadata: MemoryMetadata;
}

/**
 * Input for creating a new memory
 */
export interface CreateMemoryInput {
  namespace: MemoryNamespace;
  key: string;
  value: unknown;
  importance?: number;
  importanceLevel?: MemoryImportance;
  source?: string;
  tags?: string[];
  expiresAt?: string;
}

/**
 * Input for updating a memory
 */
export interface UpdateMemoryInput {
  value?: unknown;
  importance?: number;
  importanceLevel?: MemoryImportance;
  tags?: string[];
  expiresAt?: string;
}

/**
 * Search options for querying memories
 */
export interface MemorySearchOptions {
  /** Filter by namespace */
  namespace?: MemoryNamespace;
  /** Filter by tags (any match) */
  tags?: string[];
  /** Minimum importance score */
  minImportance?: number;
  /** Maximum number of results */
  limit?: number;
  /** Order by field */
  orderBy?: 'createdAt' | 'updatedAt' | 'lastAccessedAt' | 'accessCount' | 'importance';
  /** Order direction */
  order?: 'asc' | 'desc';
  /** Include expired memories */
  includeExpired?: boolean;
}

/**
 * User preferences memory structure
 */
export interface UserPreferencesMemory {
  /** Preferred language */
  language?: string;
  /** Frequently visited sites */
  frequentSites?: string[];
  /** Default behaviors */
  defaultBehaviors?: Record<string, unknown>;
  /** UI preferences */
  uiPreferences?: Record<string, unknown>;
}

/**
 * Fact memory structure
 */
export interface FactMemory {
  /** The fact content */
  content: string;
  /** Category of the fact */
  category?: string;
  /** Confidence level (0-1) */
  confidence?: number;
  /** Source of the fact */
  source?: string;
}

/**
 * Task summary memory structure
 */
export interface TaskSummaryMemory {
  /** Original task goal */
  goal: string;
  /** Summary of what was accomplished */
  summary: string;
  /** Was the task successful */
  success: boolean;
  /** Key actions taken */
  keyActions?: string[];
  /** URLs visited */
  urlsVisited?: string[];
  /** Duration in milliseconds */
  duration?: number;
  /** Thread ID for reference */
  threadId?: string;
}

/**
 * Learned path memory structure
 */
export interface LearnedPathMemory {
  /** Name/identifier of the path */
  name: string;
  /** Description of what the path accomplishes */
  description: string;
  /** Starting URL pattern */
  startUrl?: string;
  /** Ending URL pattern */
  endUrl?: string;
  /** Sequence of actions */
  actions: Array<{
    type: string;
    selector?: string;
    value?: string;
    description?: string;
  }>;
  /** Number of times this path was used successfully */
  successCount: number;
  /** Number of times this path failed */
  failureCount: number;
}

/**
 * Memory store interface
 */
export interface IMemoryStore {
  // CRUD operations
  create(input: CreateMemoryInput): Promise<Memory>;
  get(id: string): Promise<Memory | null>;
  getByKey(namespace: MemoryNamespace, key: string): Promise<Memory | null>;
  update(id: string, input: UpdateMemoryInput): Promise<Memory | null>;
  delete(id: string): Promise<boolean>;
  
  // Search and query
  search(options?: MemorySearchOptions): Promise<Memory[]>;
  searchByText(query: string, options?: MemorySearchOptions): Promise<Memory[]>;
  
  // Namespace operations
  listByNamespace(namespace: MemoryNamespace, limit?: number): Promise<Memory[]>;
  clearNamespace(namespace: MemoryNamespace): Promise<number>;
  
  // Utility operations
  recordAccess(id: string): Promise<void>;
  cleanup(options?: { maxAge?: number; minImportance?: number }): Promise<number>;
  getStats(): Promise<MemoryStoreStats>;
  
  // Lifecycle
  close(): Promise<void>;
}

/**
 * Memory store statistics
 */
export interface MemoryStoreStats {
  totalMemories: number;
  byNamespace: Record<MemoryNamespace, number>;
  oldestMemory?: string;
  newestMemory?: string;
  averageImportance: number;
}

/**
 * Memory extraction result
 */
export interface MemoryExtractionResult {
  /** Extracted memories */
  memories: CreateMemoryInput[];
  /** Confidence in the extraction */
  confidence: number;
  /** Any notes about the extraction */
  notes?: string;
}

/**
 * Memory manager configuration
 */
export interface MemoryManagerConfig {
  /** Maximum memories per namespace */
  maxMemoriesPerNamespace?: number;
  /** Auto-cleanup expired memories */
  autoCleanup?: boolean;
  /** Cleanup interval in milliseconds */
  cleanupInterval?: number;
  /** Default memory expiry in days */
  defaultExpiryDays?: number;
}

