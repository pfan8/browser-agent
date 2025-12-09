/**
 * Session Store
 * 
 * Persistent storage for agent sessions.
 * Sessions are stored in ~/.chat-browser-agent/sessions/
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import type { Session, Checkpoint, SerializableAgentState } from '../types';
import { generateId } from '../types';

export interface SessionListItem {
  id: string;
  name: string;
  description?: string;
  checkpointCount: number;
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  private sessionsDir: string;

  constructor(baseDir?: string) {
    // Use app.getPath for Electron, or fallback to home directory
    const userDataPath = baseDir || (
      typeof app !== 'undefined' && app.getPath 
        ? app.getPath('userData') 
        : path.join(process.env.HOME || process.env.USERPROFILE || '.', '.chat-browser-agent')
    );
    
    this.sessionsDir = path.join(userDataPath, 'sessions');
    this.ensureDirectory();
  }

  /**
   * Ensure the sessions directory exists
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Get the file path for a session
   */
  private getSessionPath(sessionId: string): string {
    return path.join(this.sessionsDir, `${sessionId}.json`);
  }

  /**
   * Create a new session
   */
  createSession(name: string, description?: string, initialState?: SerializableAgentState): Session {
    const now = new Date().toISOString();
    const sessionId = generateId('session');

    const defaultState: SerializableAgentState = {
      sessionId,
      status: 'idle',
      currentTask: null,
      plan: null,
      memory: {
        conversation: [],
        workingMemory: {},
        facts: [],
        maxConversationLength: 50,
        maxWorkingMemoryItems: 100,
      },
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };

    const session: Session = {
      id: sessionId,
      name,
      description,
      state: initialState || defaultState,
      checkpoints: [],
      createdAt: now,
      updatedAt: now,
    };

    this.saveSession(session);
    return session;
  }

  /**
   * Save a session to disk
   */
  saveSession(session: Session): void {
    const filePath = this.getSessionPath(session.id);
    session.updatedAt = new Date().toISOString();
    
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Load a session from disk
   */
  loadSession(sessionId: string): Session | null {
    const filePath = this.getSessionPath(sessionId);
    
    if (!fs.existsSync(filePath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as Session;
    } catch (error) {
      console.error(`Failed to load session ${sessionId}:`, error);
      return null;
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): boolean {
    const filePath = this.getSessionPath(sessionId);
    
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      fs.unlinkSync(filePath);
      return true;
    } catch (error) {
      console.error(`Failed to delete session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * List all sessions
   */
  listSessions(): SessionListItem[] {
    this.ensureDirectory();
    
    const files = fs.readdirSync(this.sessionsDir);
    const sessions: SessionListItem[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const sessionId = file.replace('.json', '');
      const session = this.loadSession(sessionId);
      
      if (session) {
        sessions.push({
          id: session.id,
          name: session.name,
          description: session.description,
          checkpointCount: session.checkpoints.length,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        });
      }
    }

    // Sort by updatedAt (most recent first)
    sessions.sort((a, b) => 
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return sessions;
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId: string, state: SerializableAgentState): boolean {
    const session = this.loadSession(sessionId);
    if (!session) return false;

    session.state = state;
    session.state.updatedAt = new Date().toISOString();
    this.saveSession(session);
    return true;
  }

  /**
   * Add a checkpoint to a session
   */
  addCheckpoint(sessionId: string, checkpoint: Checkpoint): boolean {
    const session = this.loadSession(sessionId);
    if (!session) return false;

    // Remove old auto-save checkpoints if there are too many (keep last 10)
    const autoSaves = session.checkpoints.filter(cp => cp.info.isAutoSave);
    if (autoSaves.length >= 10 && checkpoint.info.isAutoSave) {
      // Remove oldest auto-save
      const oldestAutoSaveIndex = session.checkpoints.findIndex(cp => 
        cp.info.id === autoSaves[0].info.id
      );
      if (oldestAutoSaveIndex >= 0) {
        session.checkpoints.splice(oldestAutoSaveIndex, 1);
      }
    }

    session.checkpoints.push(checkpoint);
    
    // Also update checkpoint list in state
    session.state.checkpoints = session.checkpoints.map(cp => cp.info);
    
    this.saveSession(session);
    return true;
  }

  /**
   * Get a specific checkpoint from a session
   */
  getCheckpoint(sessionId: string, checkpointId: string): Checkpoint | null {
    const session = this.loadSession(sessionId);
    if (!session) return null;

    return session.checkpoints.find(cp => cp.info.id === checkpointId) || null;
  }

  /**
   * List checkpoints for a session
   */
  listCheckpoints(sessionId: string): Checkpoint['info'][] {
    const session = this.loadSession(sessionId);
    if (!session) return [];

    return session.checkpoints.map(cp => cp.info);
  }

  /**
   * Delete a checkpoint from a session
   */
  deleteCheckpoint(sessionId: string, checkpointId: string): boolean {
    const session = this.loadSession(sessionId);
    if (!session) return false;

    const index = session.checkpoints.findIndex(cp => cp.info.id === checkpointId);
    if (index < 0) return false;

    session.checkpoints.splice(index, 1);
    session.state.checkpoints = session.checkpoints.map(cp => cp.info);
    this.saveSession(session);
    return true;
  }

  /**
   * Rename a session
   */
  renameSession(sessionId: string, newName: string, newDescription?: string): boolean {
    const session = this.loadSession(sessionId);
    if (!session) return false;

    session.name = newName;
    if (newDescription !== undefined) {
      session.description = newDescription;
    }
    this.saveSession(session);
    return true;
  }

  /**
   * Export a session to a file
   */
  exportSession(sessionId: string, exportPath: string): boolean {
    const session = this.loadSession(sessionId);
    if (!session) return false;

    try {
      fs.writeFileSync(exportPath, JSON.stringify(session, null, 2), 'utf-8');
      return true;
    } catch (error) {
      console.error(`Failed to export session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Import a session from a file
   */
  importSession(importPath: string): Session | null {
    try {
      const content = fs.readFileSync(importPath, 'utf-8');
      const session = JSON.parse(content) as Session;
      
      // Generate new ID to avoid conflicts
      const newId = generateId('session');
      session.id = newId;
      session.state.sessionId = newId;
      session.name = `${session.name} (imported)`;
      
      this.saveSession(session);
      return session;
    } catch (error) {
      console.error('Failed to import session:', error);
      return null;
    }
  }

  /**
   * Get sessions directory path
   */
  getSessionsDirectory(): string {
    return this.sessionsDir;
  }

  /**
   * Check if a session exists
   */
  sessionExists(sessionId: string): boolean {
    return fs.existsSync(this.getSessionPath(sessionId));
  }

  /**
   * Get the most recent session
   */
  getMostRecentSession(): Session | null {
    const sessions = this.listSessions();
    if (sessions.length === 0) return null;
    
    return this.loadSession(sessions[0].id);
  }

  /**
   * Clear all sessions (dangerous!)
   */
  clearAllSessions(): void {
    const files = fs.readdirSync(this.sessionsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(this.sessionsDir, file));
      }
    }
  }
}

// Export singleton instance
export const sessionStore = new SessionStore();

