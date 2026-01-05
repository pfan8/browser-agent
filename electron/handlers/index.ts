/**
 * IPC Handler Registration
 *
 * Central entry point for registering all IPC handlers.
 * Import and call registerAllHandlers() from main.ts.
 */

import { initSharedContext } from './shared';
import { registerAgentHandlers } from './agent-handlers';
import { registerCheckpointHandlers } from './checkpoint-handlers';
import { registerSessionHandlers } from './session-handlers';
import { registerMemoryHandlers, initMemoryHandlerContext } from './memory-handlers';
import {
    registerBrowserHandlers,
    initBrowserHandlerContext,
} from './browser-handlers';
import {
    registerConfigHandlers,
    initConfigHandlerContext,
} from './config-handlers';
import { registerBeadsHandlers } from '../beads-handlers';
import type { BrowserWindow } from 'electron';
import type { BrowserAgent } from '@chat-agent/agent-core';
import type { IBrowserAdapter } from '@chat-agent/browser-adapter';
import type { Recording } from '../../dsl/types';

interface HandlerContext {
    getMainWindow: () => BrowserWindow | null;
    getAgent: () => BrowserAgent;
    isQuitting: () => boolean;
    getPersistentCheckpointer?: () => any;
    // Browser context
    getBrowserAdapter?: () => IBrowserAdapter;
    operationRecorder?: {
        getRecording: () => Recording;
        clear: () => void;
        save: (name: string) => unknown;
        load: (filePath: string) => unknown;
    };
    restoreLastTab?: () => Promise<void>;
    generatePlaywrightScript?: (recording: Recording) => string;
    // Config context
    settingsStore?: {
        getLLMSettings: () => { apiKey?: string; baseUrl?: string };
        getExecutionMode: () => 'iterative' | 'script';
        setExecutionMode: (mode: 'iterative' | 'script') => void;
    };
    updateAgentLLMConfig?: (apiKey: string, baseUrl?: string) => void;
    resetAgent?: () => void;
}

/**
 * Register all extracted IPC handlers
 */
export function registerExtractedHandlers(context: HandlerContext): void {
    // Initialize shared context first
    initSharedContext(context);

    // Initialize memory handler context if checkpointer provided
    if (context.getPersistentCheckpointer) {
        initMemoryHandlerContext({
            getPersistentCheckpointer: context.getPersistentCheckpointer,
        });
    }

    // Initialize browser handler context if provided
    if (
        context.getBrowserAdapter &&
        context.operationRecorder &&
        context.restoreLastTab &&
        context.generatePlaywrightScript
    ) {
        initBrowserHandlerContext({
            getBrowserAdapter: context.getBrowserAdapter,
            operationRecorder: context.operationRecorder,
            restoreLastTab: context.restoreLastTab,
            generatePlaywrightScript: context.generatePlaywrightScript,
        });
    }

    // Initialize config handler context if provided
    if (context.settingsStore && context.updateAgentLLMConfig && context.resetAgent) {
        initConfigHandlerContext({
            settingsStore: context.settingsStore,
            updateAgentLLMConfig: context.updateAgentLLMConfig,
            resetAgent: context.resetAgent,
        });
    }

    // Register handler groups
    registerAgentHandlers();
    registerCheckpointHandlers();
    registerSessionHandlers();
    registerMemoryHandlers();
    registerBrowserHandlers();
    registerConfigHandlers();
    registerBeadsHandlers();
}

// Re-export individual registration functions for selective use
export { registerAgentHandlers } from './agent-handlers';
export { registerCheckpointHandlers } from './checkpoint-handlers';
export { registerSessionHandlers } from './session-handlers';
export { registerMemoryHandlers } from './memory-handlers';
export { registerBrowserHandlers } from './browser-handlers';
export { registerConfigHandlers } from './config-handlers';
export { registerBeadsHandlers } from '../beads-handlers';
export { initSharedContext } from './shared';

