/**
 * Electron Main Process
 * 
 * Entry point for the Chat Browser Agent desktop application.
 * Handles window management, IPC communication, and browser control.
 * 
 * Uses the new LangGraph-based agent from @chat-agent/agent-core.
 */

import { app, BrowserWindow, ipcMain, shell } from 'electron';
import * as path from 'path';
import { 
  PlaywrightAdapter, 
  type IBrowserAdapter,
  configureBrowserLogger,
  type BrowserLogEntry,
} from '@chat-agent/browser-adapter';
import { 
  BrowserAgent, 
  PersistentCheckpointer,
  configureAgentLogger,
  type AgentState,
  type AgentConfig,
  type StructuredLogEntry,
  type ThreadMetadata,
  type CheckpointHistoryItem,
} from '@chat-agent/agent-core';
import { operationRecorder } from './operation-recorder';
import { settingsStore } from './settings-store';
import { generatePlaywrightScript } from './script-generator';
import type { Operation, Recording } from '../dsl/types';
import { createLogger, logger as electronLogger } from './utils/logger';

// Create module logger
const log = createLogger('Main');

// Configure agent-core logger to write to Electron log files
configureAgentLogger({
  level: 'debug',
  consoleOutput: false, // Electron logger already handles console output
  customHandler: (entry: StructuredLogEntry) => {
    // Route agent-core logs through Electron's file logger
    const module = `${entry.layer}:${entry.module}`;
    const traceContext = entry.traceId ? { traceId: entry.traceId, spanId: entry.spanId || '' } : undefined;
    
    switch (entry.level) {
      case 'debug':
        if (traceContext) {
          electronLogger.debugWithTrace(module, entry.message, traceContext, entry.data);
        } else {
          electronLogger.debug(module, entry.message, entry.data);
        }
        break;
      case 'info':
        if (traceContext) {
          electronLogger.infoWithTrace(module, entry.message, traceContext, entry.data, entry.duration);
        } else {
          electronLogger.info(module, entry.message, entry.data);
        }
        break;
      case 'warn':
        if (traceContext) {
          electronLogger.warnWithTrace(module, entry.message, traceContext, entry.data);
        } else {
          electronLogger.warn(module, entry.message, entry.data);
        }
        break;
      case 'error':
        if (traceContext) {
          electronLogger.errorWithTrace(module, entry.message, traceContext, entry.data);
        } else {
          electronLogger.error(module, entry.message, entry.data);
        }
        break;
    }
  },
});

// Configure browser-adapter logger to write to Electron log files
configureBrowserLogger({
  level: 'debug',
  consoleOutput: false, // Electron logger already handles console output
  customHandler: (entry: BrowserLogEntry) => {
    // Route browser-adapter logs through Electron's file logger
    const module = `${entry.layer}:${entry.module}`;
    
    switch (entry.level) {
      case 'debug':
        electronLogger.debug(module, entry.message, entry.data);
        break;
      case 'info':
        if (entry.duration !== undefined) {
          electronLogger.info(module, `${entry.message} (${entry.duration}ms)`, entry.data);
        } else {
          electronLogger.info(module, entry.message, entry.data);
        }
        break;
      case 'warn':
        electronLogger.warn(module, entry.message, entry.data);
        break;
      case 'error':
        electronLogger.error(module, entry.message, entry.data);
        break;
    }
  },
});

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // Module not available, continue normally
}

// Chromium flags to improve stability
// Prevent GPU process crashes from affecting the app
app.commandLine.appendSwitch('disable-gpu-process-crash-limit');
// Ignore GPU blocklist for compatibility
app.commandLine.appendSwitch('ignore-gpu-blocklist');
// Use in-process network service to avoid crashes
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess');

// Single instance lock
const isDevelopment = process.env.NODE_ENV === 'development' || !app.isPackaged;

if (!isDevelopment) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
}

let mainWindow: BrowserWindow | null = null;

// Browser adapter instance (replaces old browserController)
let browserAdapter: IBrowserAdapter | null = null;

// Agent instance
let agent: BrowserAgent | null = null;
let agentInitialized = false;

function createWindow() {
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
      sandbox: false
    }
  });

  if (isDevelopment) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize browser adapter
function getBrowserAdapter(): IBrowserAdapter {
  if (!browserAdapter) {
    browserAdapter = new PlaywrightAdapter({
      screenshotPath: './recordings',
    });
    
    // Setup event forwarding
    setupBrowserAdapterEvents(browserAdapter);
  }
  return browserAdapter;
}

// Persistent checkpointer instance (uses LangGraph's SqliteSaver)
let persistentCheckpointer: PersistentCheckpointer | null = null;

// Get or create persistent checkpointer
function getPersistentCheckpointer(): PersistentCheckpointer {
  if (!persistentCheckpointer) {
    const dataPath = app.getPath('userData');
    const dbPath = require('path').join(dataPath, 'data', 'checkpoints.db');
    persistentCheckpointer = new PersistentCheckpointer(dbPath);
    log.info('Persistent checkpointer initialized (LangGraph SqliteSaver)', { dbPath });
  }
  return persistentCheckpointer;
}

// Initialize agent
function getAgent(): BrowserAgent {
  const savedSettings = settingsStore.getLLMSettings();
  const executionMode = settingsStore.getExecutionMode();
  
  if (!agent || !agentInitialized) {
    const hasApiKey = !!savedSettings.apiKey;
    const keyPreview = savedSettings.apiKey 
      ? `${savedSettings.apiKey.substring(0, 10)}...${savedSettings.apiKey.slice(-4)}`
      : 'none';
    log.info(`Initializing Agent: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${savedSettings.baseUrl || 'default'}, mode=${executionMode}`);
    
    const adapter = getBrowserAdapter();
    const checkpointer = getPersistentCheckpointer();
    
    // Memory database path
    const dataPath = app.getPath('userData');
    const memoryDbPath = require('path').join(dataPath, 'data', 'memory.db');
    
    agent = new BrowserAgent({
      browserAdapter: adapter,
      llmConfig: {
        apiKey: savedSettings.apiKey || '',
        baseUrl: savedSettings.baseUrl,
      },
      agentConfig: {
        maxIterations: 20,
        maxConsecutiveFailures: 3,
        enableScreenshots: false,
        executionMode,
      },
      memoryDbPath,
    });
    
    agent.compile(checkpointer);
    agentInitialized = true;
    log.info('Agent initialized with SQLite persistence and long-term memory');
  }
  
  return agent;
}

// Update agent LLM config
function updateAgentLLMConfig(apiKey: string, baseUrl?: string) {
  // Force re-initialization of agent with new config
  agent = null;
  agentInitialized = false;
  settingsStore.setLLMSettings({ apiKey, baseUrl });
}

// Save current tab info to settings
async function saveCurrentTabInfo(): Promise<void> {
  if (!browserAdapter || !browserAdapter.isConnected()) {
    return;
  }
  
  try {
    const result = await browserAdapter.runCode(`
      const pages = context.pages().filter(p => !p.url().startsWith('chrome://'));
      if (pages.length === 0) return null;
      const page = pages[0];
      return { url: page.url(), title: await page.title() };
    `);
    if (result.success && result.result) {
      const pageInfo = result.result as { url: string; title: string };
      if (pageInfo.url && !pageInfo.url.startsWith('chrome://')) {
        settingsStore.setLastTab({
          url: pageInfo.url,
          title: pageInfo.title || '',
        });
        log.info(`Saved last tab: ${pageInfo.url}`);
      }
    }
  } catch (error) {
    log.warn('Failed to save current tab info:', error);
  }
}

// Restore to last active tab after browser connection
async function restoreLastTab(): Promise<void> {
  const lastTab = settingsStore.getLastTab();
  if (!lastTab || !browserAdapter) {
    return;
  }
  
  try {
    log.info(`Attempting to restore last tab: ${lastTab.url}`);
    
    // Get list of pages via runCode
    const listResult = await browserAdapter.runCode(`
      const pages = context.pages();
      const result = [];
      for (let i = 0; i < pages.length; i++) {
        const p = pages[i];
        const url = p.url();
        if (url.startsWith('chrome://') || url.startsWith('about:')) continue;
        let title = 'Untitled';
        try { title = await p.title(); } catch {}
        result.push({ index: result.length, url, title });
      }
      return result;
    `);
    
    if (!listResult.success || !Array.isArray(listResult.result)) {
      log.warn('Failed to list pages for tab restoration');
      return;
    }
    
    const tabs = listResult.result as Array<{ index: number; url: string; title: string }>;
    
    // Try to find a tab that matches the saved URL
    const matchingTabIndex = tabs.findIndex(tab => tab.url === lastTab.url);
    
    if (matchingTabIndex >= 0) {
      log.info(`Found matching tab at index ${matchingTabIndex}, switching...`);
      const switchResult = await browserAdapter.runCode(`
        const pages = context.pages().filter(p => !p.url().startsWith('chrome://'));
        await pages[${matchingTabIndex}].bringToFront();
        return { success: true };
      `);
      if (switchResult.success) {
        log.info('Successfully restored to last active tab');
        return;
      }
    }
    
    // If exact URL not found, try to find a tab with the same domain
    const lastTabDomain = new URL(lastTab.url).hostname;
    const domainMatchIndex = tabs.findIndex(tab => {
      try {
        return new URL(tab.url).hostname === lastTabDomain;
      } catch {
        return false;
      }
    });
    
    if (domainMatchIndex >= 0) {
      log.info(`Found tab with same domain at index ${domainMatchIndex}, switching...`);
      await browserAdapter.runCode(`
        const pages = context.pages().filter(p => !p.url().startsWith('chrome://'));
        await pages[${domainMatchIndex}].bringToFront();
        return { success: true };
      `);
    } else {
      log.info('No matching tab found, staying on current tab');
    }
  } catch (error) {
    log.warn('Failed to restore last tab:', error);
  }
}

// Safely serialize data for IPC
function safeSerialize(data: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(data));
  } catch (e) {
    log.warn('Failed to serialize event data:', e);
    if (typeof data === 'object' && data !== null) {
      const safeData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        try {
          safeData[key] = JSON.parse(JSON.stringify(value));
        } catch {
          safeData[key] = String(value);
        }
      }
      return safeData;
    }
    return String(data);
  }
}

// Flag to track if we're already in the process of quitting
let isQuitting = false;

// Check if window is still valid and can receive messages
function isWindowValid(): boolean {
  // Skip all IPC during quit process
  if (isQuitting) return false;
  
  try {
    return !!(mainWindow && 
             !mainWindow.isDestroyed() && 
             mainWindow.webContents && 
             !mainWindow.webContents.isDestroyed());
  } catch {
    return false;
  }
}

// Safe send to renderer
function safeSend(channel: string, data: unknown): void {
  if (!isWindowValid()) return;
  try {
    const serialized = safeSerialize(data);
    mainWindow!.webContents.send(channel, serialized);
  } catch (e) {
    // Ignore errors when window is closing - this is expected behavior
    if (e instanceof Error && e.message.includes('disposed')) {
      log.debug('Window disposed, skipping IPC send');
      return;
    }
    log.error('Error sending to renderer:', e);
  }
}

// Setup browser adapter event forwarding
function setupBrowserAdapterEvents(adapter: IBrowserAdapter) {
  adapter.on('operation', (...args: unknown[]) => {
    const operation = args[0] as Operation;
    operationRecorder.addOperation(operation);
    safeSend('operation-recorded', operation);
  });

  adapter.on('connected', (...args: unknown[]) => {
    const data = args[0] as { url: string };
    safeSend('browser-event', { type: 'connected', data });
  });

  adapter.on('disconnected', () => {
    safeSend('browser-event', { type: 'disconnected', data: null });
  });

  adapter.on('pageLoad', (...args: unknown[]) => {
    const data = args[0] as { url: string };
    safeSend('browser-event', { type: 'pageLoad', data });
  });

  adapter.on('console', (...args: unknown[]) => {
    const data = args[0] as { type: string; text: string };
    safeSend('browser-event', { type: 'console', data });
  });
}

// Auto-connect to browser on startup
async function autoConnectBrowser(): Promise<void> {
  const adapter = getBrowserAdapter();
  
  // Try common CDP ports
  const cdpPorts = [9222, 9229, 9223];
  
  for (const port of cdpPorts) {
    const cdpUrl = `http://localhost:${port}`;
    try {
      log.info(`Attempting auto-connect to browser at ${cdpUrl}...`);
      const result = await adapter.connect(cdpUrl);
      if (result.success) {
        log.info(`Auto-connected to browser at ${cdpUrl}`);
        safeSend('browser-status-changed', { 
          connected: true, 
          cdpUrl 
        });
        
        // Try to restore to last active tab after successful connection
        await restoreLastTab();
        return;
      }
    } catch (error) {
      log.debug(`Auto-connect to ${cdpUrl} failed: ${error instanceof Error ? error.message : error}`);
    }
  }
  
  log.info('Auto-connect: No browser found on common ports. User can connect manually.');
}

// App lifecycle
app.whenReady().then(async () => {
  const savedLLMSettings = settingsStore.getLLMSettings();
  const hasApiKey = !!savedLLMSettings.apiKey;
  const keyPreview = savedLLMSettings.apiKey 
    ? `${savedLLMSettings.apiKey.substring(0, 10)}...${savedLLMSettings.apiKey.slice(-4)}`
    : 'none';
  log.debug(`Loaded LLM settings: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${savedLLMSettings.baseUrl || 'default'}`);
  
  createWindow();
  
  // Auto-connect to browser after window is created
  setTimeout(() => {
    autoConnectBrowser().catch(err => {
      log.warn('Auto-connect error:', err);
    });
  }, 1000); // Wait 1s for window to be ready

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // Save current tab info before closing (only if not already quitting)
    if (!isQuitting) {
      isQuitting = true;
      await saveCurrentTabInfo().catch(() => {});
    }
    app.quit();
  }
});

// Save tab info before quitting
app.on('before-quit', async (event) => {
  // Only save once
  if (!isQuitting) {
    isQuitting = true;
    event.preventDefault();
    try {
      await saveCurrentTabInfo();
    } catch (e) {
      log.debug('Failed to save tab info during quit, continuing anyway');
    }
    // Now actually quit
    app.exit(0);
  }
});

process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down...');
  if (!isQuitting) {
    isQuitting = true;
    await saveCurrentTabInfo().catch(() => {});
  }
  app.quit();
});

process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down...');
  if (!isQuitting) {
    isQuitting = true;
    await saveCurrentTabInfo().catch(() => {});
  }
  app.quit();
});

// Handle uncaught exceptions to prevent app crashes
process.on('uncaughtException', (error) => {
  log.error('Uncaught exception:', error);
  // Don't exit - let the app continue running
});

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled rejection:', reason);
  // Don't exit - let the app continue running
});

// Handle GPU/renderer process crashes gracefully
app.on('child-process-gone', (_event, details) => {
  log.warn('Child process gone:', { 
    type: details.type, 
    reason: details.reason,
    exitCode: details.exitCode 
  });
  // Don't exit - Electron will restart the process automatically
});

app.on('render-process-gone', (_event, _webContents, details) => {
  log.warn('Render process gone:', { 
    reason: details.reason,
    exitCode: details.exitCode 
  });
  // Don't exit - the window can be reloaded
});

// ============================================
// IPC Handlers - Browser Connection
// ============================================

ipcMain.handle('connect-browser', async (_event, cdpUrl: string) => {
  const adapter = getBrowserAdapter();
  const result = await adapter.connect(cdpUrl);
  
  // Try to restore to last active tab after successful manual connection
  if (result.success) {
    await restoreLastTab();
  }
  
  return result;
});

ipcMain.handle('disconnect-browser', async () => {
  const adapter = getBrowserAdapter();
  await adapter.disconnect();
});

ipcMain.handle('get-browser-status', async () => {
  const adapter = getBrowserAdapter();
  return adapter.getStatus();
});

// ============================================
// IPC Handlers - Browser Operations
// ============================================

// Core code execution - the only way to run browser operations
ipcMain.handle('run-code', async (_event, code: string) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(code);
});

// Context management
ipcMain.handle('get-contexts-info', async () => {
  const adapter = getBrowserAdapter();
  return adapter.getContextsInfo();
});

ipcMain.handle('switch-context', async (_event, index: number) => {
  const adapter = getBrowserAdapter();
  return adapter.switchContext(index);
});

// ============================================
// IPC Handlers - Recording
// ============================================

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

// ============================================
// IPC Handlers - LLM Configuration
// ============================================

ipcMain.handle('set-llm-api-key', async (_event, apiKey: string) => {
  try {
    const existingSettings = settingsStore.getLLMSettings();
    updateAgentLLMConfig(apiKey, existingSettings.baseUrl);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to set API key';
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('set-llm-config', async (_event, config: { apiKey: string; baseUrl?: string }) => {
  try {
    const keyPreview = config.apiKey 
      ? `${config.apiKey.substring(0, 10)}...${config.apiKey.slice(-4)}`
      : 'none';
    log.debug(`set-llm-config called: keyPreview=${keyPreview}, baseUrl=${config.baseUrl || 'default'}`);
    
    updateAgentLLMConfig(config.apiKey, config.baseUrl);
    log.debug('LLM config updated');
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to set LLM config';
    log.error('set-llm-config failed:', error);
    return { success: false, error: errorMessage };
  }
});

ipcMain.handle('get-llm-config', async () => {
  const settings = settingsStore.getLLMSettings();
  return {
    hasApiKey: !!settings.apiKey,
    baseUrl: settings.baseUrl
  };
});

ipcMain.handle('is-llm-available', async () => {
  const settings = settingsStore.getLLMSettings();
  return !!settings.apiKey;
});

// ============================================
// IPC Handlers - Agent
// ============================================

// Agent Task Execution
ipcMain.handle('agent-execute-task', async (_event, task: string, options?: { threadId?: string; continueSession?: boolean }) => {
  log.info(`Executing task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`, { 
    threadId: options?.threadId,
    continueSession: options?.continueSession,
  });
  try {
    const agentInstance = getAgent();
    
    // Stream execution and send events to renderer
    let finalState: AgentState | null = null;
    let stepCounter = 0;
    const stepStartTimes = new Map<string, number>();
    let lastActionCount = 0;
    let lastObservationTimestamp = '';
    let pendingPlannerStepId: string | null = null;
    let pendingCodeActStepId: string | null = null;
    let lastPlannerThought = '';
    let lastInstruction = '';
    
    // Use provided threadId or continue existing session
    const threadId = options?.threadId;
    const continueSession = options?.continueSession ?? false;
    
    for await (const event of agentInstance.streamTask(task, threadId, continueSession)) {
      // Check if task was aborted
      if (event.node === '__abort__') {
        log.info('Task was stopped by user');
        safeSend('agent-task-stopped', { message: '任务已被用户停止' });
        return safeSerialize({ 
          success: false, 
          error: 'Task stopped by user',
          result: event.state.result || '任务已被用户停止',
        });
      }
      
      // Update status
      if (event.state.status) {
        safeSend('agent-status-changed', { status: event.state.status });
      }
      
      // Track observe node events
      if (event.node === 'observe' && event.state.observation) {
        const obs = event.state.observation;
        // Only emit if observation changed (new timestamp)
        if (obs.timestamp !== lastObservationTimestamp) {
          lastObservationTimestamp = obs.timestamp;
          const stepId = `step-${++stepCounter}-observe`;
          
          // Send observe step with page info
          safeSend('agent-step-started', { 
            step: { 
              id: stepId, 
              description: `正在观察页面状态...`
            }, 
            node: 'observe',
            observation: {
              url: obs.url,
              title: obs.title,
            }
          });
          
          safeSend('agent-step-completed', { 
            step: { 
              id: stepId, 
              description: `📍 ${obs.title || obs.url}`.substring(0, 60)
            }, 
            node: 'observe',
            duration: 100,
            observation: {
              url: obs.url,
              title: obs.title,
            }
          });
        }
      }
      
      // Track planner node events - planner decides next step
      if (event.node === 'planner') {
        const state = event.state as unknown as { 
          plannerThought?: string; 
          currentInstruction?: string;
          isComplete?: boolean;
          result?: string;
        };
        
        // Complete pending planner step if any
        if (pendingPlannerStepId) {
          const duration = Date.now() - (stepStartTimes.get(pendingPlannerStepId) || Date.now());
          safeSend('agent-step-completed', { 
            step: { id: pendingPlannerStepId, description: lastPlannerThought || '分析完成' }, 
            node: 'planner',
            duration,
            thought: lastPlannerThought,
            instruction: lastInstruction,
          });
          pendingPlannerStepId = null;
        }
        
        // If task is complete, don't start new steps (but still merge state below)
        
        // Start new planner step if there's a new instruction
        if (state.currentInstruction && state.currentInstruction !== lastInstruction) {
          lastInstruction = state.currentInstruction;
          lastPlannerThought = state.plannerThought || '';
          
          const stepId = `step-${++stepCounter}-planner`;
          stepStartTimes.set(stepId, Date.now());
          pendingPlannerStepId = stepId;
          
          // Emit thinking started with streaming effect
          safeSend('agent-step-started', { 
            step: { 
              id: stepId, 
              description: '🧠 正在思考...',
            }, 
            node: 'planner',
          });
          
          // Emit thinking content progressively (simulate streaming)
          if (lastPlannerThought) {
            safeSend('agent-thinking-update', {
              stepId,
              thought: lastPlannerThought,
              instruction: lastInstruction,
            });
          }
        }
      }
      
      // Track codeact node events - codeact generates and executes code
      if (event.node === 'codeact') {
        // Complete pending planner step first
        if (pendingPlannerStepId) {
          const duration = Date.now() - (stepStartTimes.get(pendingPlannerStepId) || Date.now());
          safeSend('agent-step-completed', { 
            step: { 
              id: pendingPlannerStepId, 
              description: lastPlannerThought 
                ? `💭 ${lastPlannerThought.substring(0, 50)}${lastPlannerThought.length > 50 ? '...' : ''}`
                : '分析完成'
            }, 
            node: 'planner',
            duration: Math.max(duration, 100),
            thought: lastPlannerThought,
            instruction: lastInstruction,
          });
          pendingPlannerStepId = null;
        }
        
        const currentActionCount = event.state.actionHistory?.length || 0;
        
        // New action was added
        if (currentActionCount > lastActionCount) {
          const newAction = event.state.actionHistory![currentActionCount - 1];
          
          if (newAction) {
            // Complete pending codeact step if any
            if (pendingCodeActStepId) {
              const duration = Date.now() - (stepStartTimes.get(pendingCodeActStepId) || Date.now());
              const prevAction = event.state.actionHistory![currentActionCount - 2];
              
              if (prevAction?.result?.success) {
                safeSend('agent-step-completed', { 
                  step: { id: pendingCodeActStepId, description: `✅ 执行成功` }, 
                  node: 'codeact',
                  duration,
                  action: prevAction,
                });
              } else {
                safeSend('agent-step-failed', { 
                  step: { id: pendingCodeActStepId, description: `执行失败` }, 
                  node: 'codeact',
                  duration,
                  action: prevAction,
                  error: prevAction?.result?.error || 'Unknown error',
                });
              }
              pendingCodeActStepId = null;
            }
            
            // Start new codeact step
            const stepId = `step-${++stepCounter}-codeact`;
            stepStartTimes.set(stepId, Date.now());
            pendingCodeActStepId = stepId;
            
            // Extract code from action args
            const codeSnippet = newAction.args?.code as string || '';
            const instruction = newAction.args?.instruction as string || newAction.reasoning || '';
            
            safeSend('agent-step-started', { 
              step: { 
                id: stepId, 
                description: `⚡ ${instruction.substring(0, 50)}${instruction.length > 50 ? '...' : ''}`,
                tool: 'codeact',
              }, 
              node: 'codeact',
              action: {
                instruction,
                thought: newAction.thought,
              },
            });
            
            // Emit code execution details
            if (codeSnippet) {
              safeSend('agent-code-update', {
                stepId,
                code: codeSnippet,
                instruction,
              });
            }
            
            lastActionCount = currentActionCount;
          }
        }
        
        // Check if the last action has a result now (execution completed)
        if (event.state.actionHistory && event.state.actionHistory.length > 0) {
          const lastAction = event.state.actionHistory[event.state.actionHistory.length - 1];
          
          if (lastAction.result && pendingCodeActStepId) {
            const duration = Date.now() - (stepStartTimes.get(pendingCodeActStepId) || Date.now());
            
            if (lastAction.result.success) {
              safeSend('agent-step-completed', { 
                step: { 
                  id: pendingCodeActStepId, 
                  description: `✅ ${lastAction.reasoning?.substring(0, 40) || '执行成功'}` 
                }, 
                node: 'codeact',
                action: lastAction,
                duration 
              });
            } else {
              safeSend('agent-step-failed', { 
                step: { 
                  id: pendingCodeActStepId, 
                  description: `❌ ${lastAction.reasoning?.substring(0, 40) || '执行失败'}`,
                  tool: 'codeact',
                }, 
                node: 'codeact',
                action: lastAction, 
                error: lastAction.result.error || 'Unknown error',
                duration 
              });
            }
            
            pendingCodeActStepId = null;
          }
        }
      }
      
      // Merge partial state updates into finalState instead of overwriting
      // This ensures isComplete and other fields are not lost between events
      if (finalState) {
        finalState = { ...finalState, ...event.state } as AgentState;
      } else {
        finalState = event.state as AgentState;
      }
    }
    
    // Complete any pending steps
    if (pendingPlannerStepId) {
      safeSend('agent-step-completed', { 
        step: { id: pendingPlannerStepId, description: '分析完成' }, 
        node: 'planner',
        duration: Date.now() - (stepStartTimes.get(pendingPlannerStepId) || Date.now()),
      });
    }
    if (pendingCodeActStepId) {
      safeSend('agent-step-completed', { 
        step: { id: pendingCodeActStepId, description: '执行完成' }, 
        node: 'codeact',
        duration: Date.now() - (stepStartTimes.get(pendingCodeActStepId) || Date.now()),
      });
    }
    
    if (finalState) {
      if (finalState.isComplete && !finalState.error) {
        log.info('Task completed successfully');
        safeSend('agent-task-completed', { result: finalState.result });
        return safeSerialize({ 
          success: true, 
          result: finalState.result,
        });
      } else {
        log.warn('Task failed:', finalState.error);
        safeSend('agent-task-failed', { error: finalState.error });
        return safeSerialize({ 
          success: false, 
          error: finalState.error,
          result: finalState.result,
        });
      }
    }
    
    return { success: false, error: 'No final state' };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('Task failed with error:', errorMsg);
    safeSend('agent-task-failed', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
});

// Stop current task
ipcMain.handle('agent-stop-task', async () => {
  try {
    const agentInstance = getAgent();
    agentInstance.stop();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

// Get agent status
ipcMain.handle('agent-get-status', async () => {
  const agentInstance = getAgent();
  return {
    status: agentInstance.isTaskRunning() ? 'running' : 'idle',
    isRunning: agentInstance.isTaskRunning(),
    currentPlan: null, // LangGraph doesn't use explicit plans in the same way
    progress: null,
  };
});

// Get agent state (simplified for LangGraph)
ipcMain.handle('agent-get-state', async () => {
  return {
    sessionId: 'default',
    status: 'idle',
    currentTask: null,
    plan: null,
    memory: { conversation: [], workingMemory: {}, facts: [] },
    checkpoints: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
});

// ============================================
// IPC Handlers - Sessions (SQLite persistence)
// ============================================

ipcMain.handle('agent-create-session', async (_event, name: string, description?: string) => {
  try {
    const agentInstance = getAgent();
    const session = agentInstance.createSession(name, description);
    if (session) {
      return { 
        success: true, 
        session: { 
          id: session.threadId, 
          name: session.name || name,
          description: session.description,
          createdAt: session.createdAt,
        } 
      };
    }
    // Fallback if no SQLite checkpointer
    const sessionId = `session_${Date.now()}`;
    return { 
      success: true, 
      session: { id: sessionId, name } 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-load-session', async (_event, sessionId: string) => {
  try {
    const agentInstance = getAgent();
    const state = await agentInstance.loadSessionState(sessionId);
    if (state) {
      log.info('Session loaded', { sessionId, messageCount: state.messages?.length || 0 });
      return { success: true, hasState: true };
    }
    return { success: true, hasState: false };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-list-sessions', async () => {
  try {
    const agentInstance = getAgent();
    const sessions = agentInstance.listSessions();
    return sessions.map((s: ThreadMetadata) => ({
      id: s.threadId,
      name: s.name || `Session ${s.threadId.substring(0, 8)}`,
      description: s.description,
      messageCount: s.messageCount,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  } catch (error) {
    log.warn('Failed to list sessions:', error);
    return [];
  }
});

ipcMain.handle('agent-delete-session', async (_event, sessionId: string) => {
  try {
    const agentInstance = getAgent();
    return agentInstance.deleteSession(sessionId);
  } catch (error) {
    log.warn('Failed to delete session:', error);
    return false;
  }
});

ipcMain.handle('agent-get-current-session', async () => {
  const agentInstance = getAgent();
  return agentInstance.getCurrentThreadId();
});

// ============================================
// IPC Handlers - Checkpoints (LangGraph Native)
// ============================================

ipcMain.handle('agent-create-checkpoint', async (_event, _name: string, _description?: string) => {
  // LangGraph automatically creates checkpoints during graph execution
  // This is kept for API compatibility
  return { success: true, checkpointId: `checkpoint_${Date.now()}` };
});

ipcMain.handle('agent-list-checkpoints', async (_event, threadId?: string) => {
  try {
    const agentInstance = getAgent();
    const currentThreadId = threadId || agentInstance.getCurrentThreadId();
    
    if (!currentThreadId) {
  return [];
    }
    
    const history = await agentInstance.getCheckpointHistory(currentThreadId);
    return history.map((h: CheckpointHistoryItem) => ({
      id: h.checkpointId,
      threadId: h.threadId,
      createdAt: h.createdAt,
      step: h.step,
      messagePreview: h.messagePreview,
      isUserMessage: h.isUserMessage,
      parentCheckpointId: h.parentCheckpointId,
    }));
  } catch (error) {
    log.warn('Failed to list checkpoints:', error);
    return [];
  }
});

ipcMain.handle('agent-get-checkpoint-history', async (_event, threadId: string) => {
  try {
    const agentInstance = getAgent();
    const history = await agentInstance.getCheckpointHistory(threadId);
    return history.map((h: CheckpointHistoryItem) => ({
      id: h.checkpointId,
      threadId: h.threadId,
      createdAt: h.createdAt,
      step: h.step,
      messagePreview: h.messagePreview,
      isUserMessage: h.isUserMessage,
      parentCheckpointId: h.parentCheckpointId,
      metadata: h.metadata,
    }));
  } catch (error) {
    log.warn('Failed to get checkpoint history:', error);
    return [];
  }
});

/**
 * Extract user goal from a planner HumanMessage content
 * The content format is: "## Task\n{goal}\n\n## Current Page..."
 */
function extractGoalFromPlannerMessage(content: string): string | null {
  // Match the goal after "## Task\n" and before the next section
  const match = content.match(/##\s*Task\s*\n([\s\S]*?)(?:\n##|\n\n##|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return null;
}

/**
 * Extract completion message from AI response JSON
 */
function extractCompletionFromAIMessage(content: string): string | null {
  if (!content.trim().startsWith('{')) return null;
  
  try {
    const parsed = JSON.parse(content);
    if (parsed.isComplete && parsed.completionMessage) {
      return parsed.completionMessage;
    }
    // For final response, use completionMessage
    if (parsed.completionMessage) {
      return parsed.completionMessage;
    }
  } catch {
    // Not JSON
  }
  return null;
}

/**
 * Convert LangGraph state to UI-friendly messages
 * 
 * Strategy:
 * 1. Parse internal LangGraph messages to find user goals and completions
 * 2. LangGraph HumanMessages contain planner prompts with "## Task\n{goal}"
 * 3. LangGraph AIMessages contain JSON responses with "completionMessage"
 */
function formatStateToUIMessages(state: Record<string, unknown>): Array<{ id: string; role: string; content: string; timestamp: string }> {
  const uiMessages: Array<{ id: string; role: string; content: string; timestamp: string }> = [];
  const now = new Date().toISOString();
  
  const messages = state.messages as unknown[] | undefined;
  const result = state.result as string | undefined;
  const goal = state.goal as string | undefined;
  const isComplete = state.isComplete as boolean | undefined;
  
  log.debug('formatStateToUIMessages', {
    messageCount: messages?.length || 0,
    hasResult: !!result,
    hasGoal: !!goal,
    isComplete,
  });
  
  // Track seen goals to avoid duplicates
  const seenGoals = new Set<string>();
  let lastGoalIdx = -1;
  
  if (messages && Array.isArray(messages)) {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i] as Record<string, unknown>;
      if (!msg) continue;
      
      // Detect message type
      let isHuman = false;
      if (typeof (msg as any)._getType === 'function') {
        isHuman = (msg as any)._getType() === 'human';
      } else if (msg.type === 'human' || msg._type === 'human') {
        isHuman = true;
      } else if (msg.lc_id && Array.isArray(msg.lc_id)) {
        isHuman = (msg.lc_id as string[]).some(s => s.includes('HumanMessage'));
      } else if (typeof msg.id === 'string') {
        isHuman = (msg.id as string).includes('HumanMessage');
      }
      
      const content = (msg.content ?? (msg.lc_kwargs as any)?.content ?? '') as string;
      
      if (isHuman) {
        // Extract goal from planner prompt
        const extractedGoal = extractGoalFromPlannerMessage(content);
        if (extractedGoal && !seenGoals.has(extractedGoal)) {
          seenGoals.add(extractedGoal);
          lastGoalIdx = uiMessages.length;
          uiMessages.push({
            id: msg.id as string || `user_${i}`,
            role: 'user',
            content: extractedGoal,
            timestamp: now,
          });
        }
      } else {
        // Check if this is a completion message
        const completion = extractCompletionFromAIMessage(content);
        if (completion) {
          uiMessages.push({
            id: msg.id as string || `agent_${i}`,
            role: 'assistant',
            content: completion,
            timestamp: now,
          });
        }
      }
    }
  }
  
  // If no messages extracted but we have goal/result from state, use those
  if (uiMessages.length === 0 && goal) {
    uiMessages.push({
      id: 'user_goal',
      role: 'user',
      content: goal,
      timestamp: now,
    });
    
    if (result) {
      uiMessages.push({
        id: 'agent_result',
        role: 'assistant',
        content: result,
        timestamp: now,
      });
    }
  }
  
  // If we have a final result that wasn't captured, add it
  if (result && isComplete) {
    const lastMsg = uiMessages[uiMessages.length - 1];
    if (!lastMsg || lastMsg.role !== 'assistant' || lastMsg.content !== result) {
      // Check if result is already in messages (avoid duplicate)
      const hasResult = uiMessages.some(m => m.role === 'assistant' && m.content === result);
      if (!hasResult) {
        uiMessages.push({
          id: 'final_result',
          role: 'assistant',
          content: result,
          timestamp: now,
        });
      }
    }
  }
  
  log.debug('formatStateToUIMessages result', {
    extractedCount: uiMessages.length,
    userMessages: uiMessages.filter(m => m.role === 'user').length,
    agentMessages: uiMessages.filter(m => m.role === 'assistant').length,
  });
  
  return uiMessages;
}

/**
 * Legacy: Format individual LangGraph message (for backward compatibility)
 */
function formatLangGraphMessage(msg: any, idx: number): { id: string; role: string; content: string; timestamp: string } | null {
  if (!msg) return null;
  
  // Detect message type
  let isHuman = false;
  
  if (typeof msg._getType === 'function') {
    isHuman = msg._getType() === 'human';
  } else if (msg.type === 'human' || msg._type === 'human') {
    isHuman = true;
  } else if (msg.lc_id && Array.isArray(msg.lc_id)) {
    isHuman = msg.lc_id.some((s: string) => s.includes('HumanMessage'));
  } else if (typeof msg.id === 'string') {
    isHuman = msg.id.includes('HumanMessage');
  }
  
  // Extract content
  const rawContent = msg.content ?? msg.lc_kwargs?.content ?? '';
  let content = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
  
  // Try to extract readable message from JSON
  if (!isHuman && content.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      content = parsed.completionMessage || parsed.message || parsed.thought || content;
    } catch { /* keep original */ }
  }
  
  if (!content?.trim()) return null;
  
  return {
    id: msg.id || `msg_${idx}`,
    role: isHuman ? 'user' : 'assistant',
    content,
    timestamp: new Date().toISOString(),
  };
}

ipcMain.handle('agent-restore-checkpoint', async (_event, threadId: string, checkpointId: string) => {
  try {
    const agentInstance = getAgent();
    const state = await agentInstance.restoreToCheckpoint(threadId, checkpointId);
    
    if (state) {
      log.info('Restored to checkpoint', { threadId, checkpointId });
      
      // Convert state to UI-friendly messages (goal -> user msg, result -> agent msg)
      const formattedMessages = formatStateToUIMessages(state as Record<string, unknown>);
      
      return { 
        success: true, 
        state: {
          messages: formattedMessages,
          goal: state.goal,
          status: state.status,
          isComplete: state.isComplete,
        }
      };
    }
    
    return { success: false, error: 'Checkpoint not found' };
  } catch (error) {
    log.error('Failed to restore checkpoint:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-get-state-at-checkpoint', async (_event, threadId: string, checkpointId: string) => {
  try {
    const agentInstance = getAgent();
    const state = await agentInstance.getStateAtCheckpoint(threadId, checkpointId);
    
    if (state) {
      // Convert state to UI-friendly messages
      const formattedMessages = formatStateToUIMessages(state as Record<string, unknown>);
      
      return {
        messages: formattedMessages,
        goal: state.goal,
        status: state.status,
        isComplete: state.isComplete,
        actionHistory: state.actionHistory,
      };
    }
    
    return null;
  } catch (error) {
    log.warn('Failed to get state at checkpoint:', error);
    return null;
  }
});

ipcMain.handle('agent-restore-latest', async (_event, threadId?: string) => {
  try {
    const agentInstance = getAgent();
    const targetThreadId = threadId || agentInstance.getCurrentThreadId();
    
    if (!targetThreadId) {
      return { success: false, error: 'No thread ID provided' };
    }
    
    const state = await agentInstance.loadSessionState(targetThreadId);
    
    if (state) {
      const formattedMessages = formatStateToUIMessages(state as Record<string, unknown>);
      
      return { 
        success: true, 
        state: {
          messages: formattedMessages,
          goal: state.goal,
          status: state.status,
        }
      };
    }
    
    return { success: true, state: null };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-delete-checkpoint', async (_event, _checkpointId: string) => {
  // LangGraph manages checkpoints internally
  // Deleting individual checkpoints is not directly supported
  log.info('Checkpoint deletion requested (not supported with LangGraph SqliteSaver)');
  return true;
});

// ============================================
// IPC Handlers - Memory & History
// ============================================

ipcMain.handle('agent-get-conversation', async (_event, sessionIdOrLimit?: string | number, limit?: number) => {
  try {
    const agentInstance = getAgent();
    
    // Determine if first arg is sessionId or limit
    let sessionId: string | undefined;
    let messageLimit: number | undefined;
    
    if (typeof sessionIdOrLimit === 'string') {
      sessionId = sessionIdOrLimit;
      messageLimit = limit;
    } else if (typeof sessionIdOrLimit === 'number') {
      messageLimit = sessionIdOrLimit;
    }
    
    // If sessionId provided, load from that session's state
    if (sessionId) {
      const state = await agentInstance.loadSessionState(sessionId);
      
      // Check if state exists and has messages
      const hasMessages = state && state.messages && Array.isArray(state.messages) && state.messages.length > 0;
      
      if (hasMessages) {
        // Convert state to UI conversation format
        const messages = formatStateToUIMessages(state as Record<string, unknown>);
        
        // Apply limit if specified
        if (messageLimit && messageLimit > 0) {
          return messages.slice(-messageLimit);
        }
        return messages;
      } else {
        // State is empty or has no messages - sync metadata to reflect reality
        // This handles the case where MemorySaver fallback lost data but metadata still shows old count
        const checkpointer = getPersistentCheckpointer();
        const isFallback = checkpointer.isUsingFallback();
        checkpointer.updateThreadActivity(sessionId, 0);
        log.info('Synced thread metadata - checkpoint data was empty', { sessionId, isFallbackMode: isFallback });
      }
    }
    
    // No session or no messages found
    return [];
  } catch (error) {
    log.error('Failed to get conversation', { error });
    return [];
  }
});

ipcMain.handle('agent-clear-memory', async () => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      await memoryManager.runCleanup();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-get-memory-summary', async () => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      const stats = await memoryManager.getStats();
      return `Total memories: ${stats.totalMemories}, Tasks: ${stats.byNamespace.task_summary || 0}, Facts: ${stats.byNamespace.facts || 0}`;
    }
    return 'Memory not configured';
  } catch (error) {
    return 'Error getting memory summary';
  }
});

ipcMain.handle('agent-get-memory-stats', async () => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      return await memoryManager.getStats();
    }
    return null;
  } catch (error) {
    log.warn('Failed to get memory stats:', error);
    return null;
  }
});

ipcMain.handle('agent-get-recent-tasks', async (_event, limit: number = 10) => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      const tasks = await memoryManager.getRecentTasks(limit);
      return tasks;
    }
    return [];
  } catch (error) {
    log.warn('Failed to get recent tasks:', error);
    return [];
  }
});

ipcMain.handle('agent-save-fact', async (_event, fact: { content: string; category?: string }) => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      await memoryManager.saveFact({
        content: fact.content,
        category: fact.category,
        source: 'user',
        confidence: 1.0,
      });
      return { success: true };
    }
    return { success: false, error: 'Memory not configured' };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-get-facts', async (_event, category?: string) => {
  try {
    const agentInstance = getAgent();
    const memoryManager = agentInstance.getMemoryManager();
    if (memoryManager) {
      return await memoryManager.getFacts({ category });
    }
    return [];
  } catch (error) {
    log.warn('Failed to get facts:', error);
    return [];
  }
});

// ============================================
// IPC Handlers - Chat & Configuration
// ============================================

ipcMain.handle('agent-chat', async (_event, message: string) => {
  try {
    // Use the agent to process the message
    const agentInstance = getAgent();
    const result = await agentInstance.executeTask(message);
    return { 
      success: true, 
      response: result.result || 'Task processed' 
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-reset', async () => {
  agent = null;
  agentInitialized = false;
  return { success: true };
});

ipcMain.handle('agent-update-config', async (_event, config: Record<string, unknown>) => {
  try {
    const agentInstance = getAgent();
    agentInstance.updateConfig(config as Partial<AgentConfig>);
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
});

ipcMain.handle('agent-get-config', async () => {
  const agentInstance = getAgent();
  return agentInstance.getConfig();
});

// Get today's trace log
ipcMain.handle('agent-get-trace', async () => {
  const fs = await import('fs/promises');
  const pathModule = await import('path');
  
  try {
    const today = new Date().toISOString().split('T')[0];
    const logFile = pathModule.join(process.cwd(), 'logs', `agent-${today}.log`);
    
    try {
      const content = await fs.readFile(logFile, 'utf-8');
      // Return the last 500 lines (most recent activity)
      const lines = content.split('\n');
      const lastLines = lines.slice(-500).join('\n');
      return lastLines;
    } catch {
      // If today's log doesn't exist, return a message
      return `No trace log found for today (${today})`;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return `Error reading trace: ${errorMsg}`;
  }
});

// Execution Mode handlers
ipcMain.handle('agent-get-execution-mode', async () => {
  return settingsStore.getExecutionMode();
});

ipcMain.handle('agent-set-execution-mode', async (_event, mode: 'iterative' | 'script') => {
  try {
    settingsStore.setExecutionMode(mode);
    // Update the agent config if it exists
    const agentInstance = getAgent();
    agentInstance.setExecutionMode(mode);
    log.info('Execution mode updated', { mode });
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log.error('Failed to set execution mode', { error: errorMessage });
    return { success: false, error: errorMessage };
  }
});
