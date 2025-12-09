/**
 * Operation Recorder - Records browser operations as DSL
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import type { 
  Operation, 
  Recording, 
  RecordingMetadata
} from '../dsl/types';

// Helper function to create new recording
function createRecording(): Recording {
  return {
    version: '1.0',
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    operations: []
  };
}

export class OperationRecorder extends EventEmitter {
  private recording: Recording;
  private recordingsDir: string;

  constructor(recordingsDir?: string) {
    super();
    this.recording = createRecording();
    this.recordingsDir = recordingsDir || path.join(process.cwd(), 'recordings');
    this.ensureRecordingsDir();
  }

  /**
   * Ensure recordings directory exists
   */
  private ensureRecordingsDir(): void {
    if (!fs.existsSync(this.recordingsDir)) {
      fs.mkdirSync(this.recordingsDir, { recursive: true });
    }
  }

  /**
   * Add an operation to the recording
   */
  addOperation(operation: Operation): void {
    this.recording.operations.push(operation);
    this.recording.metadata.updatedAt = new Date().toISOString();
    this.emit('operationAdded', operation);
  }

  /**
   * Get the current recording
   */
  getRecording(): Recording {
    return { ...this.recording };
  }

  /**
   * Get all operations
   */
  getOperations(): Operation[] {
    return [...this.recording.operations];
  }

  /**
   * Clear all operations
   */
  clear(): void {
    this.recording = createRecording();
    this.emit('cleared');
  }

  /**
   * Update recording metadata
   */
  updateMetadata(metadata: Partial<RecordingMetadata>): void {
    this.recording.metadata = {
      ...this.recording.metadata,
      ...metadata,
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Save recording to file
   */
  async save(name?: string): Promise<{ success: boolean; path?: string; error?: string }> {
    try {
      const filename = name || `recording_${Date.now()}`;
      const filePath = path.join(this.recordingsDir, `${filename}.json`);
      
      this.recording.metadata.name = filename;
      this.recording.metadata.updatedAt = new Date().toISOString();

      fs.writeFileSync(filePath, JSON.stringify(this.recording, null, 2), 'utf-8');
      
      this.emit('saved', { path: filePath });
      return { success: true, path: filePath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Save failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * Load recording from file
   */
  async load(filePath: string): Promise<{ success: boolean; recording?: Recording; error?: string }> {
    try {
      const fullPath = path.isAbsolute(filePath) 
        ? filePath 
        : path.join(this.recordingsDir, filePath);

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: `File not found: ${fullPath}` };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const recording = JSON.parse(content) as Recording;

      // Validate recording structure
      if (!recording.version || !recording.operations || !Array.isArray(recording.operations)) {
        return { success: false, error: 'Invalid recording format' };
      }

      this.recording = recording;
      this.emit('loaded', { path: fullPath, recording });
      
      return { success: true, recording };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Load failed';
      return { success: false, error: errorMessage };
    }
  }

  /**
   * List all saved recordings
   */
  listRecordings(): { name: string; path: string; createdAt?: string }[] {
    try {
      const files = fs.readdirSync(this.recordingsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const filePath = path.join(this.recordingsDir, f);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const recording = JSON.parse(content) as Recording;
            return {
              name: f.replace('.json', ''),
              path: filePath,
              createdAt: recording.metadata.createdAt
            };
          } catch {
            return {
              name: f.replace('.json', ''),
              path: filePath
            };
          }
        });
    } catch {
      return [];
    }
  }

  /**
   * Remove an operation by ID
   */
  removeOperation(operationId: string): boolean {
    const index = this.recording.operations.findIndex(op => op.id === operationId);
    if (index >= 0) {
      this.recording.operations.splice(index, 1);
      this.recording.metadata.updatedAt = new Date().toISOString();
      this.emit('operationRemoved', operationId);
      return true;
    }
    return false;
  }

  /**
   * Get operation count
   */
  getOperationCount(): number {
    return this.recording.operations.length;
  }

  /**
   * Check if recording is empty
   */
  isEmpty(): boolean {
    return this.recording.operations.length === 0;
  }

  /**
   * Get the last operation
   */
  getLastOperation(): Operation | undefined {
    return this.recording.operations[this.recording.operations.length - 1];
  }

  /**
   * Undo last operation
   */
  undoLastOperation(): Operation | undefined {
    const removed = this.recording.operations.pop();
    if (removed) {
      this.recording.metadata.updatedAt = new Date().toISOString();
      this.emit('operationRemoved', removed.id);
    }
    return removed;
  }

  /**
   * Export recording as JSON string
   */
  exportAsJson(): string {
    return JSON.stringify(this.recording, null, 2);
  }

  /**
   * Import recording from JSON string
   */
  importFromJson(jsonString: string): { success: boolean; error?: string } {
    try {
      const recording = JSON.parse(jsonString) as Recording;
      
      if (!recording.version || !recording.operations || !Array.isArray(recording.operations)) {
        return { success: false, error: 'Invalid recording format' };
      }

      this.recording = recording;
      this.emit('imported', recording);
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Import failed';
      return { success: false, error: errorMessage };
    }
  }
}

// Export singleton instance
export const operationRecorder = new OperationRecorder();

