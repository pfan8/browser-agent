/**
 * Electron Main Process
 * 
 * Entry point for the Chat Browser Agent desktop application.
 * Handles window management, IPC communication, and browser control.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { browserController } from './browser-controller';
import { operationRecorder } from './operation-recorder';
import { settingsStore } from './settings-store';
import { generatePlaywrightScript } from './script-generator';
import type { Operation, Recording } from '../dsl/types';
import { getAgentCore } from './agent/agent-core';
import type { AgentEvent } from './agent/types';
import { createLogger } from './utils/logger';

// Create module logger
const log = createLogger('Main');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
// Note: electron-squirrel-startup is only needed for Windows Squirrel installer
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // Module not available, continue normally
}

// Single instance lock - ensures only one instance of the app runs at a time
// Only enabled in production to avoid issues with hot-reload during development
const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;

if (!isDevelopment) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    // Another instance is already running, quit this one
    app.quit();
  } else {
    // This is the primary instance
    app.on('second-instance', () => {
      // When another instance tries to start, focus our existing window
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0a0a0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false // Required for playwright
    }
  });

  // Load the app
  if (isDevelopment) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// App lifecycle
app.whenReady().then(() => {
  // Load saved LLM settings
  const savedLLMSettings = settingsStore.getLLMSettings();
  const hasApiKey = !!savedLLMSettings.apiKey;
  const keyPreview = savedLLMSettings.apiKey 
    ? `${savedLLMSettings.apiKey.substring(0, 10)}...${savedLLMSettings.apiKey.slice(-4)}`
    : 'none';
  log.debug(`Loaded LLM settings: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${savedLLMSettings.baseUrl || 'default'}`);
  
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Setup browser controller event listeners
  setupBrowserControllerEvents();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Handle termination signals for clean shutdown during hot-reload
// This ensures the process exits properly when vite-plugin-electron restarts
process.on('SIGTERM', () => {
  log.info('Received SIGTERM, shutting down...');
  app.quit();
});

process.on('SIGINT', () => {
  log.info('Received SIGINT, shutting down...');
  app.quit();
});

// Setup browser controller events
function setupBrowserControllerEvents() {
  browserController.on('operation', (operation: Operation) => {
    // Add to recorder
    operationRecorder.addOperation(operation);
    
    // Notify renderer
    if (mainWindow) {
      mainWindow.webContents.send('operation-recorded', operation);
    }
  });

  browserController.on('connected', (data: { url: string }) => {
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'connected', data });
    }
  });

  browserController.on('disconnected', () => {
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'disconnected', data: null });
    }
  });

  browserController.on('pageLoad', (data: { url: string }) => {
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'pageLoad', data });
    }
  });

  browserController.on('console', (data: { type: string; text: string }) => {
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'console', data });
    }
  });
}

// ============================================
// IPC Handlers
// ============================================

// Browser connection
ipcMain.handle('connect-browser', async (_event, cdpUrl: string) => {
  return browserController.connect(cdpUrl);
});

ipcMain.handle('disconnect-browser', async () => {
  await browserController.disconnect();
});

ipcMain.handle('get-browser-status', async () => {
  return browserController.getStatus();
});

// Browser operations
ipcMain.handle('navigate', async (_event, url: string) => {
  return browserController.navigate(url);
});

ipcMain.handle('click', async (_event, selector: string) => {
  return browserController.click(selector);
});

ipcMain.handle('type', async (_event, selector: string, text: string) => {
  return browserController.type(selector, text);
});

ipcMain.handle('press', async (_event, key: string) => {
  return browserController.press(key);
});

ipcMain.handle('screenshot', async (_event, name?: string) => {
  return browserController.screenshot(name);
});

ipcMain.handle('wait-for', async (_event, ms: number) => {
  return browserController.wait(ms);
});

ipcMain.handle('get-page-info', async () => {
  return browserController.getPageInfo();
});

ipcMain.handle('evaluate-selector', async (_event, description: string) => {
  return browserController.evaluateSelector(description);
});

ipcMain.handle('list-pages', async () => {
  return browserController.listPages();
});

ipcMain.handle('switch-to-page', async (_event, index: number) => {
  return browserController.switchToPage(index);
});

ipcMain.handle('run-code', async (_event, code: string) => {
  return browserController.runCode(code);
});

// Recording
ipcMain.handle('get-recording', async (): Promise<Recording> => {
  return operationRecorder.getRecording();
});

ipcMain.handle('clear-recording', async () => {
  operationRecorder.clear();
});

ipcMain.handle('export-to-playwright', async () => {
  try {
    const recording = operationRecorder.getRecording();
    if (recording.operations.length === 0) {
      return { success: false, error: 'No operations to export' };
    }
    const script = generatePlaywrightScript(recording);
    return { success: true, script };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Export failed';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('save-recording', async (_event, name: string) => {
  return operationRecorder.save(name);
});

ipcMain.handle('load-recording', async (_event, filePath: string) => {
  return operationRecorder.load(filePath);
});

// LLM Configuration (all chat now goes through agent)

// Set LLM API key (can be called from renderer to configure)
ipcMain.handle('set-llm-api-key', async (_event, apiKey: string) => {
  try {
    // Save to persistent storage (keep existing baseUrl if any)
    const existingSettings = settingsStore.getLLMSettings();
    settingsStore.setLLMSettings({
      apiKey,
      baseUrl: existingSettings.baseUrl
    });
    // Update AgentCore's planner with full config (including baseUrl)
    const agent = getAgent();
    agent.setLLMConfig({ apiKey, baseUrl: existingSettings.baseUrl });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to set API key';
    return { success: false, error: errorMessage };
  }
});

// Set LLM config (API key and base URL) and persist to storage
ipcMain.handle('set-llm-config', async (_event, config: { apiKey: string; baseUrl?: string }) => {
  try {
    const keyPreview = config.apiKey 
      ? `${config.apiKey.substring(0, 10)}...${config.apiKey.slice(-4)}`
      : 'none';
    log.debug(`set-llm-config called: keyPreview=${keyPreview}, baseUrl=${config.baseUrl || 'default'}`);
    
    // Save to persistent storage
    settingsStore.setLLMSettings({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl
    });
    // Update AgentCore's planner with full config (including baseUrl)
    const agent = getAgent();
    agent.setLLMConfig({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    log.debug('LLM config updated in settingsStore and AgentCore');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to set LLM config';
    log.error('set-llm-config failed:', error);
    return { success: false, error: errorMessage };
  }
});

// Get LLM config
ipcMain.handle('get-llm-config', async () => {
  const settings = settingsStore.getLLMSettings();
  return {
    hasApiKey: !!settings.apiKey,
    baseUrl: settings.baseUrl
  };
});

// Check if LLM is available
ipcMain.handle('is-llm-available', async () => {
  const settings = settingsStore.getLLMSettings();
  return !!settings.apiKey;
});

// ============================================
// Agent IPC Handlers (Hierarchical Agent)
// ============================================

// Get or create the agent instance (singleton)
let agentInitialized = false;
function getAgent() {
  const savedSettings = settingsStore.getLLMSettings();
  
  // Only log on first call to reduce noise
  if (!agentInitialized) {
    const hasApiKey = !!savedSettings.apiKey;
    const keyPreview = savedSettings.apiKey 
      ? `${savedSettings.apiKey.substring(0, 10)}...${savedSettings.apiKey.slice(-4)}`
      : 'none';
    log.info(`Initializing Agent: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${savedSettings.baseUrl || 'default'}`);
    agentInitialized = true;
  }
  
  return getAgentCore({
    anthropicApiKey: savedSettings.apiKey,
    anthropicBaseUrl: savedSettings.baseUrl,
  });
}

// Safely serialize data for IPC (removes non-serializable content)
function safeSerialize(data: unknown): unknown {
  try {
    // Use JSON stringify/parse to remove non-serializable content
    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    log.warn('Failed to serialize event data:', e);
    // Return a safe fallback
    if (typeof data === 'object' && data !== null) {
      const safeData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        try {
          safeData[key] = JSON.parse(JSON.stringify(value));
        } catch {
          // Skip non-serializable properties
          safeData[key] = String(value);
        }
      }
      return safeData;
    }
    return String(data);
  }
}

// Safe send to renderer with error handling
function safeSend(channel: string, data: unknown): void {
  if (!mainWindow) return;
  try {
    const serialized = safeSerialize(data);
    mainWindow.webContents.send(channel, serialized);
  } catch (e) {
    log.error('Error sending from webFrameMain:', e);
  }
}

// Setup agent event forwarding to renderer
function setupAgentEvents() {
  const agent = getAgent();
  
  agent.on('event', (event: AgentEvent) => {
    safeSend('agent-event', event);
  });

  agent.on('status_changed', (data) => {
    safeSend('agent-status-changed', data);
  });

  agent.on('plan_created', (data) => {
    safeSend('agent-plan-created', data);
  });

  agent.on('step_started', (data) => {
    safeSend('agent-step-started', data);
  });

  agent.on('step_completed', (data) => {
    safeSend('agent-step-completed', data);
  });

  agent.on('step_failed', (data) => {
    safeSend('agent-step-failed', data);
  });

  agent.on('task_completed', (data) => {
    safeSend('agent-task-completed', data);
  });

  agent.on('task_failed', (data) => {
    safeSend('agent-task-failed', data);
  });
}

// Agent Task Execution
ipcMain.handle('agent-execute-task', async (_event, task: string) => {
  log.info(`Executing task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`);
  try {
    const agent = getAgent();
    const result = await agent.executeTask(task);
    if (result.success) {
      log.info('Task completed successfully');
    } else {
      log.warn('Task failed:', result.error);
      if (result.result) {
        log.info('Task summary:', String(result.result).substring(0, 300));
      }
    }
    // Serialize result to avoid IPC cloning errors
    return safeSerialize(result);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Task failed with error:', errorMsg);
    return { success: false, error: errorMsg };
  }
});

// Stop current task
ipcMain.handle('agent-stop-task', async () => {
  try {
    const agent = getAgent();
    agent.stopTask();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Get agent status
ipcMain.handle('agent-get-status', async () => {
  const agent = getAgent();
  return {
    status: agent.getStatus(),
    isRunning: agent.isTaskRunning(),
    currentPlan: agent.getCurrentPlan(),
    progress: agent.getPlanProgress(),
  };
});

// Get agent state
ipcMain.handle('agent-get-state', async () => {
  const agent = getAgent();
  return agent.getState();
});

// Agent Sessions
ipcMain.handle('agent-create-session', async (_event, name: string, description?: string) => {
  try {
    const agent = getAgent();
    const session = agent.createSession(name, description);
    return { success: true, session };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-load-session', async (_event, sessionId: string) => {
  try {
    const agent = getAgent();
    const success = agent.loadSession(sessionId);
    return { success };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-list-sessions', async () => {
  const agent = getAgent();
  return agent.listSessions();
});

ipcMain.handle('agent-delete-session', async (_event, sessionId: string) => {
  const agent = getAgent();
  return agent.deleteSession(sessionId);
});

ipcMain.handle('agent-get-current-session', async () => {
  const agent = getAgent();
  return agent.getCurrentSessionId();
});

// Agent Checkpoints
ipcMain.handle('agent-create-checkpoint', async (_event, name: string, description?: string) => {
  try {
    const agent = getAgent();
    const checkpointId = agent.createCheckpoint(name, description);
    return { success: true, checkpointId };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-list-checkpoints', async () => {
  const agent = getAgent();
  return agent.listCheckpoints();
});

ipcMain.handle('agent-restore-checkpoint', async (_event, checkpointId: string) => {
  try {
    const agent = getAgent();
    const success = await agent.resumeFromCheckpoint(checkpointId);
    return { success };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-restore-latest', async () => {
  try {
    const agent = getAgent();
    const success = await agent.resumeFromLatest();
    return { success };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-delete-checkpoint', async (_event, checkpointId: string) => {
  const agent = getAgent();
  return agent.deleteCheckpoint(checkpointId);
});

// Agent Memory & History
ipcMain.handle('agent-get-conversation', async (_event, limit?: number) => {
  const agent = getAgent();
  return agent.getConversationHistory(limit);
});

ipcMain.handle('agent-clear-memory', async () => {
  const agent = getAgent();
  agent.clearMemory();
  return { success: true };
});

ipcMain.handle('agent-get-memory-summary', async () => {
  const agent = getAgent();
  return agent.getMemorySummary();
});

// Agent Chat (non-task conversation)
ipcMain.handle('agent-chat', async (_event, message: string) => {
  try {
    const agent = getAgent();
    const response = await agent.chat(message);
    return { success: true, response };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Agent Reset
ipcMain.handle('agent-reset', async () => {
  const agent = getAgent();
  agent.reset();
  return { success: true };
});

// Agent Configuration
ipcMain.handle('agent-update-config', async (_event, config: Record<string, unknown>) => {
  try {
    const agent = getAgent();
    agent.updateConfig(config);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-get-config', async () => {
  const agent = getAgent();
  return agent.getConfig();
});

// Initialize agent events when app is ready
app.whenReady().then(() => {
  setupAgentEvents();
});

