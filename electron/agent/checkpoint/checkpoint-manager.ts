/**
 * Checkpoint Manager
 * 
 * Manages checkpoints for agent state.
 * Allows saving and restoring agent state at any point.
 */

import type {
  AgentState,
  Checkpoint,
  CheckpointInfo,
  SerializableAgentState,
  AgentConfig,
} from '../types';
import { generateId, serializeState, deserializeState } from '../types';
import { SessionStore, sessionStore } from './session-store';
import { EventEmitter } from 'events';

export interface CheckpointManagerEvents {
  'checkpoint_created': (checkpoint: CheckpointInfo) => void;
  'checkpoint_restored': (checkpoint: CheckpointInfo) => void;
  'checkpoint_deleted': (checkpointId: string) => void;
}

export class CheckpointManager extends EventEmitter {
  private sessionStore: SessionStore;
  private currentSessionId: string | null = null;
  private autoCheckpointEnabled: boolean = true;
  private stepsSinceCheckpoint: number = 0;
  private checkpointInterval: number = 1; // Auto-checkpoint every N steps

  constructor(store?: SessionStore, config?: Partial<AgentConfig>) {
    super();
    this.sessionStore = store || sessionStore;
    
    if (config) {
      this.autoCheckpointEnabled = config.autoCheckpoint ?? true;
      this.checkpointInterval = config.checkpointInterval ?? 1;
    }
  }

  /**
   * Set the current session
   */
  setSession(sessionId: string): void {
    if (!this.sessionStore.sessionExists(sessionId)) {
      throw new Error(`Session ${sessionId} does not exist`);
    }
    this.currentSessionId = sessionId;
    this.stepsSinceCheckpoint = 0;
  }

  /**
   * Get current session ID
   */
  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  /**
   * Create a manual checkpoint
   */
  createCheckpoint(
    state: AgentState,
    name: string,
    description?: string
  ): CheckpointInfo {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    const checkpointInfo: CheckpointInfo = {
      id: generateId('cp'),
      name,
      description,
      stepIndex: state.plan?.currentStepIndex ?? 0,
      createdAt: new Date().toISOString(),
      isAutoSave: false,
    };

    const checkpoint: Checkpoint = {
      info: checkpointInfo,
      state: serializeState(state),
    };

    this.sessionStore.addCheckpoint(this.currentSessionId, checkpoint);
    this.emit('checkpoint_created', checkpointInfo);
    
    return checkpointInfo;
  }

  /**
   * Create an automatic checkpoint (after step completion)
   */
  autoSave(state: AgentState): CheckpointInfo | null {
    if (!this.autoCheckpointEnabled || !this.currentSessionId) {
      return null;
    }

    this.stepsSinceCheckpoint++;

    if (this.stepsSinceCheckpoint < this.checkpointInterval) {
      return null;
    }

    this.stepsSinceCheckpoint = 0;

    const stepIndex = state.plan?.currentStepIndex ?? 0;
    const stepDesc = state.plan?.steps[stepIndex]?.description || 'unknown step';

    const checkpointInfo: CheckpointInfo = {
      id: generateId('auto_cp'),
      name: `Auto-save at step ${stepIndex + 1}`,
      description: `After: ${stepDesc.slice(0, 50)}`,
      stepIndex,
      createdAt: new Date().toISOString(),
      isAutoSave: true,
    };

    const checkpoint: Checkpoint = {
      info: checkpointInfo,
      state: serializeState(state),
    };

    this.sessionStore.addCheckpoint(this.currentSessionId, checkpoint);
    this.emit('checkpoint_created', checkpointInfo);

    return checkpointInfo;
  }

  /**
   * Restore state from a checkpoint
   */
  restoreCheckpoint(checkpointId: string): AgentState | null {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    const checkpoint = this.sessionStore.getCheckpoint(
      this.currentSessionId,
      checkpointId
    );

    if (!checkpoint) {
      return null;
    }

    const state = deserializeState(checkpoint.state);
    this.emit('checkpoint_restored', checkpoint.info);
    
    return state;
  }

  /**
   * Restore to the latest checkpoint
   */
  restoreLatest(): AgentState | null {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    const checkpoints = this.sessionStore.listCheckpoints(this.currentSessionId);
    if (checkpoints.length === 0) {
      return null;
    }

    // Sort by createdAt descending and get the latest
    const sorted = [...checkpoints].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return this.restoreCheckpoint(sorted[0].id);
  }

  /**
   * Restore to the latest manual (non-auto-save) checkpoint
   */
  restoreLatestManual(): AgentState | null {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    const checkpoints = this.sessionStore.listCheckpoints(this.currentSessionId);
    const manualCheckpoints = checkpoints.filter(cp => !cp.isAutoSave);
    
    if (manualCheckpoints.length === 0) {
      return null;
    }

    const sorted = [...manualCheckpoints].sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return this.restoreCheckpoint(sorted[0].id);
  }

  /**
   * Restore to a specific step
   */
  restoreToStep(stepIndex: number): AgentState | null {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    const checkpoints = this.sessionStore.listCheckpoints(this.currentSessionId);
    
    // Find checkpoint at or before the specified step
    const validCheckpoints = checkpoints.filter(cp => cp.stepIndex <= stepIndex);
    
    if (validCheckpoints.length === 0) {
      return null;
    }

    // Get the one closest to the target step
    const sorted = [...validCheckpoints].sort((a, b) => b.stepIndex - a.stepIndex);
    
    return this.restoreCheckpoint(sorted[0].id);
  }

  /**
   * Delete a checkpoint
   */
  deleteCheckpoint(checkpointId: string): boolean {
    if (!this.currentSessionId) {
      return false;
    }

    const success = this.sessionStore.deleteCheckpoint(
      this.currentSessionId,
      checkpointId
    );

    if (success) {
      this.emit('checkpoint_deleted', checkpointId);
    }

    return success;
  }

  /**
   * List all checkpoints for current session
   */
  listCheckpoints(): CheckpointInfo[] {
    if (!this.currentSessionId) {
      return [];
    }

    return this.sessionStore.listCheckpoints(this.currentSessionId);
  }

  /**
   * Get checkpoint count
   */
  getCheckpointCount(): number {
    return this.listCheckpoints().length;
  }

  /**
   * Enable/disable auto-checkpoint
   */
  setAutoCheckpoint(enabled: boolean): void {
    this.autoCheckpointEnabled = enabled;
  }

  /**
   * Set checkpoint interval
   */
  setCheckpointInterval(steps: number): void {
    this.checkpointInterval = Math.max(1, steps);
  }

  /**
   * Reset step counter (call when starting a new task)
   */
  resetStepCounter(): void {
    this.stepsSinceCheckpoint = 0;
  }

  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(checkpointId: string): Checkpoint | null {
    if (!this.currentSessionId) {
      return null;
    }

    return this.sessionStore.getCheckpoint(this.currentSessionId, checkpointId);
  }

  /**
   * Save current state to session (not as checkpoint)
   */
  saveState(state: AgentState): void {
    if (!this.currentSessionId) {
      throw new Error('No session set. Call setSession() first.');
    }

    this.sessionStore.updateSessionState(
      this.currentSessionId,
      serializeState(state)
    );
  }

  /**
   * Load current state from session
   */
  loadState(): AgentState | null {
    if (!this.currentSessionId) {
      return null;
    }

    const session = this.sessionStore.loadSession(this.currentSessionId);
    if (!session) {
      return null;
    }

    return deserializeState(session.state);
  }

  /**
   * Compare two checkpoint states
   */
  compareCheckpoints(checkpointId1: string, checkpointId2: string): {
    stepDifference: number;
    timeDifference: number;
    statusChange: boolean;
  } | null {
    const cp1 = this.getCheckpoint(checkpointId1);
    const cp2 = this.getCheckpoint(checkpointId2);

    if (!cp1 || !cp2) {
      return null;
    }

    return {
      stepDifference: cp2.info.stepIndex - cp1.info.stepIndex,
      timeDifference: new Date(cp2.info.createdAt).getTime() - new Date(cp1.info.createdAt).getTime(),
      statusChange: cp1.state.status !== cp2.state.status,
    };
  }

  /**
   * Clean up old auto-save checkpoints, keeping only the most recent N
   */
  cleanupAutoSaves(keepCount: number = 5): number {
    if (!this.currentSessionId) {
      return 0;
    }

    const checkpoints = this.sessionStore.listCheckpoints(this.currentSessionId);
    const autoSaves = checkpoints
      .filter(cp => cp.isAutoSave)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    let deleted = 0;
    for (let i = keepCount; i < autoSaves.length; i++) {
      if (this.deleteCheckpoint(autoSaves[i].id)) {
        deleted++;
      }
    }

    return deleted;
  }
}

// Export singleton instance
export const checkpointManager = new CheckpointManager();

