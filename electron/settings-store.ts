/**
 * Settings Store - Persists user settings to local file
 */

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export interface AppSettings {
  llm?: {
    apiKey?: string;
    baseUrl?: string;
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
}

// Export singleton instance
export const settingsStore = new SettingsStore();

