/**
 * Browser IPC Handlers
 *
 * Handles browser connection, operations, and recording.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { Recording } from '../../dsl/types';
import { log } from './shared';

// Browser adapter and recording dependencies - set during initialization
let getBrowserAdapter: (() => IBrowserAdapter) | null = null;
let operationRecorder: {
    getRecording: () => Recording;
    clear: () => void;
    save: (name: string) => unknown;
    load: (filePath: string) => unknown;
} | null = null;
let restoreLastTab: (() => Promise<void>) | null = null;
let generatePlaywrightScript: ((recording: Recording) => string) | null = null;

/**
 * Initialize browser handler context
 */
export function initBrowserHandlerContext(context: {
    getBrowserAdapter: () => IBrowserAdapter;
    operationRecorder: typeof operationRecorder;
    restoreLastTab: () => Promise<void>;
    generatePlaywrightScript: (recording: Recording) => string;
}): void {
    getBrowserAdapter = context.getBrowserAdapter;
    operationRecorder = context.operationRecorder;
    restoreLastTab = context.restoreLastTab;
    generatePlaywrightScript = context.generatePlaywrightScript;
}

/**
 * Register browser IPC handlers
 */
export function registerBrowserHandlers(): void {
    if (!getBrowserAdapter || !operationRecorder || !restoreLastTab || !generatePlaywrightScript) {
        log.warn('Browser handler context not initialized, skipping registration');
        return;
    }

    const getAdapter = getBrowserAdapter;
    const recorder = operationRecorder;
    const restoreTab = restoreLastTab;
    const generateScript = generatePlaywrightScript;

    // Browser Connection
    ipcMain.handle('connect-browser', async (_event, cdpUrl: string) => {
        const adapter = getAdapter();
        const result = await adapter.connect(cdpUrl);
        if (result.success) {
            await restoreTab();
        }
        return result;
    });

    ipcMain.handle('disconnect-browser', async () => {
        const adapter = getAdapter();
        await adapter.disconnect();
    });

    ipcMain.handle('get-browser-status', async () => {
        const adapter = getAdapter();
        return adapter.getStatus();
    });

    // Browser Operations
    ipcMain.handle('run-code', async (_event, code: string) => {
        const adapter = getAdapter();
        return adapter.runCode(code);
    });

    ipcMain.handle('get-contexts-info', async () => {
        const adapter = getAdapter();
        return adapter.getContextsInfo();
    });

    ipcMain.handle('switch-context', async (_event, index: number) => {
        const adapter = getAdapter();
        return adapter.switchContext(index);
    });

    // Recording
    ipcMain.handle('get-recording', async (): Promise<Recording> => {
        return recorder.getRecording();
    });

    ipcMain.handle('clear-recording', async () => {
        recorder.clear();
    });

    ipcMain.handle('export-to-playwright', async () => {
        try {
            const recording = recorder.getRecording();
            if (recording.operations.length === 0) {
                return { success: false, error: 'No operations to export' };
            }
            const script = generateScript(recording);
            return { success: true, script };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Export failed';
            return { success: false, error: errorMessage };
        }
    });

    ipcMain.handle('save-recording', async (_event, name: string) => {
        return recorder.save(name);
    });

    ipcMain.handle('load-recording', async (_event, filePath: string) => {
        return recorder.load(filePath);
    });

    log.info('Browser IPC handlers registered');
}

