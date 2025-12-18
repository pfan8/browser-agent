/**
 * Settings Store - Persists user settings to local file
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Information about the last active tab
 */
export interface LastTabInfo {
  url: string;
  title: string;
  savedAt: string;
}

/**
 * Execution mode for CodeAct agent
 */
export type ExecutionMode = 'iterative' | 'script';

export interface AppSettings {
  llm?: {
    apiKey?: string;
    baseUrl?: string;
  };
  lastTab?: LastTabInfo;
  agent?: {
    executionMode?: ExecutionMode;
  };
}

class SettingsStore {
  private settingsPath: string;
  private settings: AppSettings;

  constructor() {
    // Use userData directory for settings (e.g., ~/Library/Application Support/chat-browser-agent/)
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'settings.json');
    this.settings = this.load();
  }

  /**
   * Load settings from file
   */
  private load(): AppSettings {
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return {};
  }

  /**
   * Save settings to file
   */
  private save(): void {
    try {
      const dir = path.dirname(this.settingsPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  /**
   * Get all settings
   */
  getAll(): AppSettings {
    return { ...this.settings };
  }

  /**
   * Get LLM settings
   */
  getLLMSettings(): { apiKey?: string; baseUrl?: string } {
    return this.settings.llm || {};
  }

  /**
   * Set LLM settings
   */
  setLLMSettings(config: { apiKey?: string; baseUrl?: string }): void {
    this.settings.llm = {
      ...this.settings.llm,
      ...config
    };
    this.save();
  }

  /**
   * Clear all settings
   */
  clear(): void {
    this.settings = {};
    this.save();
  }

  /**
   * Get settings file path (for debugging)
   */
  getSettingsPath(): string {
    return this.settingsPath;
  }

  /**
   * Save the last active tab info
   */
  setLastTab(tabInfo: { url: string; title: string }): void {
    this.settings.lastTab = {
      url: tabInfo.url,
      title: tabInfo.title,
      savedAt: new Date().toISOString(),
    };
    this.save();
  }

  /**
   * Get the last active tab info
   */
  getLastTab(): LastTabInfo | undefined {
    return this.settings.lastTab;
  }

  /**
   * Clear the last tab info
   */
  clearLastTab(): void {
    delete this.settings.lastTab;
    this.save();
  }

  /**
   * Get agent settings
   */
  getAgentSettings(): { executionMode: ExecutionMode } {
    return {
      executionMode: this.settings.agent?.executionMode || 'iterative',
    };
  }

  /**
   * Set agent settings
   */
  setAgentSettings(config: { executionMode?: ExecutionMode }): void {
    this.settings.agent = {
      ...this.settings.agent,
      ...config,
    };
    this.save();
  }

  /**
   * Get execution mode
   */
  getExecutionMode(): ExecutionMode {
    return this.settings.agent?.executionMode || 'iterative';
  }

  /**
   * Set execution mode
   */
  setExecutionMode(mode: ExecutionMode): void {
    this.settings.agent = {
      ...this.settings.agent,
      executionMode: mode,
    };
    this.save();
  }
}

// Export singleton instance
export const settingsStore = new SettingsStore();

