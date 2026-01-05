/**
 * Electron Main Process
 *
 * Entry point for the Chat Browser Agent desktop application.
 * Handles window management, IPC communication, and browser control.
 *
 * Uses the new LangGraph-based agent from @chat-agent/agent-core.
 */

import { app, BrowserWindow, shell } from 'electron';
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
    type StructuredLogEntry,
} from '@chat-agent/agent-core';
import { registerExtractedHandlers } from './handlers';
import { operationRecorder } from './operation-recorder';
import { settingsStore } from './settings-store';
import { generatePlaywrightScript } from './script-generator';
import type { Operation } from '../dsl/types';
import { createLogger, logger as electronLogger } from './utils/logger';
import { getBeadsClient } from './beads-handlers';

// Create module logger
const log = createLogger('Main');

// Configure agent-core logger to write to Electron log files
configureAgentLogger({
    level: 'debug',
    consoleOutput: false, // Electron logger already handles console output
    customHandler: (entry: StructuredLogEntry) => {
        // Route agent-core logs through Electron's file logger
        const module = `${entry.layer}:${entry.module}`;
        const traceContext = entry.traceId
            ? { traceId: entry.traceId, spanId: entry.spanId || '' }
            : undefined;

        switch (entry.level) {
            case 'debug':
                if (traceContext) {
                    electronLogger.debugWithTrace(
                        module,
                        entry.message,
                        traceContext,
                        entry.data
                    );
                } else {
                    electronLogger.debug(module, entry.message, entry.data);
                }
                break;
            case 'info':
                if (traceContext) {
                    electronLogger.infoWithTrace(
                        module,
                        entry.message,
                        traceContext,
                        entry.data,
                        entry.duration
                    );
                } else {
                    electronLogger.info(module, entry.message, entry.data);
                }
                break;
            case 'warn':
                if (traceContext) {
                    electronLogger.warnWithTrace(
                        module,
                        entry.message,
                        traceContext,
                        entry.data
                    );
                } else {
                    electronLogger.warn(module, entry.message, entry.data);
                }
                break;
            case 'error':
                if (traceContext) {
                    electronLogger.errorWithTrace(
                        module,
                        entry.message,
                        traceContext,
                        entry.data
                    );
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
                    electronLogger.info(
                        module,
                        `${entry.message} (${entry.duration}ms)`,
                        entry.data
                    );
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
            sandbox: false,
        },
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
        log.info(
            'Persistent checkpointer initialized (LangGraph SqliteSaver)',
            { dbPath }
        );
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
            ? `${savedSettings.apiKey.substring(
                  0,
                  10
              )}...${savedSettings.apiKey.slice(-4)}`
            : 'none';
        log.info(
            `Initializing Agent: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${
                savedSettings.baseUrl || 'default'
            }, mode=${executionMode}`
        );

        const adapter = getBrowserAdapter();
        const checkpointer = getPersistentCheckpointer();

        // Memory database path
        const dataPath = app.getPath('userData');
        const memoryDbPath = require('path').join(
            dataPath,
            'data',
            'memory.db'
        );

        const beadsClient = getBeadsClient();

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
            beadsClient,
        });

        agent.compile(checkpointer);
        agentInitialized = true;
        log.info(
            'Agent initialized with SQLite persistence and long-term memory'
        );
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

        const tabs = listResult.result as Array<{
            index: number;
            url: string;
            title: string;
        }>;

        // Try to find a tab that matches the saved URL
        const matchingTabIndex = tabs.findIndex(
            (tab) => tab.url === lastTab.url
        );

        if (matchingTabIndex >= 0) {
            log.info(
                `Found matching tab at index ${matchingTabIndex}, switching...`
            );
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
        const domainMatchIndex = tabs.findIndex((tab) => {
            try {
                return new URL(tab.url).hostname === lastTabDomain;
            } catch {
                return false;
            }
        });

        if (domainMatchIndex >= 0) {
            log.info(
                `Found tab with same domain at index ${domainMatchIndex}, switching...`
            );
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
        return !!(
            mainWindow &&
            !mainWindow.isDestroyed() &&
            mainWindow.webContents &&
            !mainWindow.webContents.isDestroyed()
        );
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
                    cdpUrl,
                });

                // Try to restore to last active tab after successful connection
                await restoreLastTab();
                return;
            }
        } catch (error) {
            log.debug(
                `Auto-connect to ${cdpUrl} failed: ${
                    error instanceof Error ? error.message : error
                }`
            );
        }
    }

    log.info(
        'Auto-connect: No browser found on common ports. User can connect manually.'
    );
}

// App lifecycle
app.whenReady().then(async () => {
    const savedLLMSettings = settingsStore.getLLMSettings();
    const hasApiKey = !!savedLLMSettings.apiKey;
    const keyPreview = savedLLMSettings.apiKey
        ? `${savedLLMSettings.apiKey.substring(
              0,
              10
          )}...${savedLLMSettings.apiKey.slice(-4)}`
        : 'none';
    log.debug(
        `Loaded LLM settings: hasApiKey=${hasApiKey}, keyPreview=${keyPreview}, baseUrl=${
            savedLLMSettings.baseUrl || 'default'
        }`
    );

    createWindow();

    // Register all extracted IPC handlers
    registerExtractedHandlers({
        getMainWindow: () => mainWindow,
        getAgent,
        isQuitting: () => isQuitting,
        getPersistentCheckpointer,
        // Browser context
        getBrowserAdapter,
        operationRecorder,
        restoreLastTab,
        generatePlaywrightScript,
        // Config context
        settingsStore,
        updateAgentLLMConfig,
        resetAgent: () => {
            agent = null;
            agentInitialized = false;
        },
    });

    // Auto-connect to browser after window is created
    setTimeout(() => {
        autoConnectBrowser().catch((err) => {
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
        exitCode: details.exitCode,
    });
    // Don't exit - Electron will restart the process automatically
});

app.on('render-process-gone', (_event, _webContents, details) => {
    log.warn('Render process gone:', {
        reason: details.reason,
        exitCode: details.exitCode,
    });
    // Don't exit - the window can be reloaded
});

// All IPC handlers are registered via registerExtractedHandlers() above
