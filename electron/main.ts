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
  createCheckpointer,
  configureAgentLogger,
  type AgentState,
  type AgentConfig,
  type StructuredLogEntry,
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
    const checkpointer = createCheckpointer({ type: 'memory' });
    
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
    });
    
    agent.compile(checkpointer);
    agentInitialized = true;
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
        result.push({ index: result.length, url, title, active: p === page });
      }
      return result;
    `);
    
    if (!listResult.success || !Array.isArray(listResult.result)) {
      log.warn('Failed to list pages for tab restoration');
      return;
    }
    
    const tabs = listResult.result as Array<{ index: number; url: string; title: string; active: boolean }>;
    
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

// Safe send to renderer
function safeSend(channel: string, data: unknown): void {
  if (!mainWindow) return;
  try {
    const serialized = safeSerialize(data);
    mainWindow.webContents.send(channel, serialized);
  } catch (e) {
    log.error('Error sending to renderer:', e);
  }
}

// Setup browser adapter event forwarding
function setupBrowserAdapterEvents(adapter: IBrowserAdapter) {
  adapter.on('operation', (...args: unknown[]) => {
    const operation = args[0] as Operation;
    operationRecorder.addOperation(operation);
    if (mainWindow) {
      mainWindow.webContents.send('operation-recorded', operation);
    }
  });

  adapter.on('connected', (...args: unknown[]) => {
    const data = args[0] as { url: string };
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'connected', data });
    }
  });

  adapter.on('disconnected', () => {
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'disconnected', data: null });
    }
  });

  adapter.on('pageLoad', (...args: unknown[]) => {
    const data = args[0] as { url: string };
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'pageLoad', data });
    }
  });

  adapter.on('console', (...args: unknown[]) => {
    const data = args[0] as { type: string; text: string };
    if (mainWindow) {
      mainWindow.webContents.send('browser-event', { type: 'console', data });
    }
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
        if (mainWindow) {
          mainWindow.webContents.send('browser-status-changed', { 
            connected: true, 
            cdpUrl 
          });
        }
        
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
  // Save current tab info before closing
  await saveCurrentTabInfo();
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Save tab info before quitting
app.on('before-quit', async (event) => {
  // Prevent immediate quit to save tab info
  event.preventDefault();
  await saveCurrentTabInfo();
  // Now actually quit
  app.exit(0);
});

process.on('SIGTERM', async () => {
  log.info('Received SIGTERM, shutting down...');
  await saveCurrentTabInfo();
  app.quit();
});

process.on('SIGINT', async () => {
  log.info('Received SIGINT, shutting down...');
  await saveCurrentTabInfo();
  app.quit();
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
// IPC Handlers - Browser Operations (via runCode)
// ============================================

ipcMain.handle('navigate', async (_event, url: string) => {
  const adapter = getBrowserAdapter();
  const fullUrl = url.startsWith('http') ? url : `https://${url}`;
  return adapter.runCode(`
    await page.goto(${JSON.stringify(fullUrl)}, { waitUntil: 'networkidle' });
    return { success: true, data: { url: page.url() } };
  `);
});

ipcMain.handle('click', async (_event, selector: string) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(`
    await page.click(${JSON.stringify(selector)});
    return { success: true };
  `);
});

ipcMain.handle('type', async (_event, selector: string, text: string) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(`
    await page.fill(${JSON.stringify(selector)}, ${JSON.stringify(text)});
    return { success: true };
  `);
});

ipcMain.handle('press', async (_event, key: string) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(`
    await page.keyboard.press(${JSON.stringify(key)});
    return { success: true };
  `);
});

ipcMain.handle('screenshot', async (_event, name?: string) => {
  const adapter = getBrowserAdapter();
  const filename = name || `screenshot_${Date.now()}`;
  return adapter.runCode(`
    const path = './recordings/${filename}.png';
    await page.screenshot({ path, fullPage: true });
    return { success: true, data: { path } };
  `);
});

ipcMain.handle('wait-for', async (_event, ms: number) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(`
    await page.waitForTimeout(${ms});
    return { success: true };
  `);
});

ipcMain.handle('get-page-info', async () => {
  const adapter = getBrowserAdapter();
  // Use getStatus() directly instead of runCode to avoid unnecessary logging
  const status = await adapter.getStatus();
  return { 
    url: status.url || '', 
    title: status.title || '' 
  };
});

ipcMain.handle('evaluate-selector', async (_event, description: string) => {
  const adapter = getBrowserAdapter();
  const result = await adapter.runCode(`
    const desc = ${JSON.stringify(description)}.toLowerCase();
    const selectors = [];
    const allElements = document.querySelectorAll('button, a, input, [role="button"], [data-testid]');
    for (const el of allElements) {
      const text = (el.textContent || '').trim().toLowerCase();
      const testId = el.getAttribute('data-testid');
      const ariaLabel = el.getAttribute('aria-label');
      if (text && text.includes(desc)) {
        if (testId) selectors.push('[data-testid="' + testId + '"]');
      }
      if (ariaLabel && ariaLabel.toLowerCase().includes(desc)) {
        selectors.push('[aria-label="' + ariaLabel + '"]');
      }
    }
    return { selector: selectors[0] || '', alternatives: selectors.slice(1, 5) };
  `);
  if (result.success && result.result) {
    return result.result;
  }
  return { selector: '', alternatives: [] };
});

ipcMain.handle('list-pages', async () => {
  const adapter = getBrowserAdapter();
  const result = await adapter.runCode(`
    const pages = context.pages();
    const result = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const url = p.url();
      if (url.startsWith('chrome://') || url.startsWith('about:')) continue;
      let title = 'Untitled';
      try { title = await p.title(); } catch {}
      result.push({ index: result.length, url, title, active: p === page });
    }
    return result;
  `);
  if (result.success && Array.isArray(result.result)) {
    return result.result;
  }
  return [];
});

ipcMain.handle('switch-to-page', async (_event, index: number) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(`
    const pages = context.pages().filter(p => !p.url().startsWith('chrome://'));
    if (${index} < 0 || ${index} >= pages.length) {
      return { success: false, error: 'Invalid page index' };
    }
    const targetPage = pages[${index}];
    await targetPage.bringToFront();
    return { success: true, data: { index: ${index}, url: targetPage.url(), title: await targetPage.title() } };
  `);
});

ipcMain.handle('run-code', async (_event, code: string) => {
  const adapter = getBrowserAdapter();
  return adapter.runCode(code);
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
ipcMain.handle('agent-execute-task', async (_event, task: string) => {
  log.info(`Executing task: "${task.substring(0, 100)}${task.length > 100 ? '...' : ''}"`);
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
    
    for await (const event of agentInstance.streamTask(task)) {
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
// IPC Handlers - Sessions (Simplified for LangGraph)
// ============================================

ipcMain.handle('agent-create-session', async (_event, name: string, _description?: string) => {
  // LangGraph uses thread_id for sessions
  const sessionId = `session_${Date.now()}`;
  return { 
    success: true, 
    session: { id: sessionId, name } 
  };
});

ipcMain.handle('agent-load-session', async (_event, _sessionId: string) => {
  // LangGraph sessions are managed by the checkpointer
  return { success: true };
});

ipcMain.handle('agent-list-sessions', async () => {
  // Return empty list for now - would need checkpointer integration
  return [];
});

ipcMain.handle('agent-delete-session', async (_event, _sessionId: string) => {
  return true;
});

ipcMain.handle('agent-get-current-session', async () => {
  const agentInstance = getAgent();
  return agentInstance.getCurrentThreadId();
});

// ============================================
// IPC Handlers - Checkpoints (Managed by LangGraph)
// ============================================

ipcMain.handle('agent-create-checkpoint', async (_event, _name: string, _description?: string) => {
  // LangGraph automatically creates checkpoints
  return { success: true, checkpointId: `checkpoint_${Date.now()}` };
});

ipcMain.handle('agent-list-checkpoints', async () => {
  // Would need to query the checkpointer
  return [];
});

ipcMain.handle('agent-restore-checkpoint', async (_event, _checkpointId: string) => {
  // Would need checkpointer integration
  return { success: true };
});

ipcMain.handle('agent-restore-latest', async () => {
  return { success: true };
});

ipcMain.handle('agent-delete-checkpoint', async (_event, _checkpointId: string) => {
  return true;
});

// ============================================
// IPC Handlers - Memory & History
// ============================================

ipcMain.handle('agent-get-conversation', async (_event, _limit?: number) => {
  return [];
});

ipcMain.handle('agent-clear-memory', async () => {
  return { success: true };
});

ipcMain.handle('agent-get-memory-summary', async () => {
  return 'Memory managed by LangGraph checkpointer';
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
