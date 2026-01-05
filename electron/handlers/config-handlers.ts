/**
 * Configuration IPC Handlers
 *
 * Handles LLM configuration, agent config, execution mode, and chat.
 * Extracted from main.ts to maintain file size under 800 lines.
 */

import { ipcMain } from 'electron';
import type { AgentConfig } from '@chat-agent/agent-core';
import { getAgent, log } from './shared';

// Settings dependencies - set during initialization
let settingsStore: {
    getLLMSettings: () => { apiKey?: string; baseUrl?: string };
    getExecutionMode: () => 'iterative' | 'script';
    setExecutionMode: (mode: 'iterative' | 'script') => void;
} | null = null;
let updateAgentLLMConfig: ((apiKey: string, baseUrl?: string) => void) | null = null;
let resetAgent: (() => void) | null = null;

/**
 * Initialize config handler context
 */
export function initConfigHandlerContext(context: {
    settingsStore: typeof settingsStore;
    updateAgentLLMConfig: (apiKey: string, baseUrl?: string) => void;
    resetAgent: () => void;
}): void {
    settingsStore = context.settingsStore;
    updateAgentLLMConfig = context.updateAgentLLMConfig;
    resetAgent = context.resetAgent;
}

/**
 * Register configuration IPC handlers
 */
export function registerConfigHandlers(): void {
    if (!settingsStore || !updateAgentLLMConfig || !resetAgent) {
        log.warn('Config handler context not initialized, skipping registration');
        return;
    }

    const settings = settingsStore;
    const updateLLMConfig = updateAgentLLMConfig;
    const reset = resetAgent;

    // LLM Configuration
    ipcMain.handle('set-llm-api-key', async (_event, apiKey: string) => {
        try {
            const existingSettings = settings.getLLMSettings();
            updateLLMConfig(apiKey, existingSettings.baseUrl);
            return { success: true };
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : 'Failed to set API key';
            return { success: false, error: errorMessage };
        }
    });

    ipcMain.handle(
        'set-llm-config',
        async (_event, config: { apiKey: string; baseUrl?: string }) => {
            try {
                const keyPreview = config.apiKey
                    ? `${config.apiKey.substring(0, 10)}...${config.apiKey.slice(-4)}`
                    : 'none';
                log.debug(
                    `set-llm-config called: keyPreview=${keyPreview}, baseUrl=${config.baseUrl || 'default'}`
                );

                updateLLMConfig(config.apiKey, config.baseUrl);
                log.debug('LLM config updated');
                return { success: true };
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : 'Failed to set LLM config';
                log.error('set-llm-config failed:', error);
                return { success: false, error: errorMessage };
            }
        }
    );

    ipcMain.handle('get-llm-config', async () => {
        const llmSettings = settings.getLLMSettings();
        return {
            hasApiKey: !!llmSettings.apiKey,
            baseUrl: llmSettings.baseUrl,
        };
    });

    ipcMain.handle('is-llm-available', async () => {
        const llmSettings = settings.getLLMSettings();
        return !!llmSettings.apiKey;
    });

    // Chat & Agent Configuration
    ipcMain.handle('agent-chat', async (_event, message: string) => {
        try {
            const agentInstance = getAgent();
            const result = await agentInstance.executeTask(message);
            return {
                success: true,
                response: result.result || 'Task processed',
            };
        } catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    });

    ipcMain.handle('agent-reset', async () => {
        reset();
        return { success: true };
    });

    ipcMain.handle(
        'agent-update-config',
        async (_event, config: Record<string, unknown>) => {
            try {
                const agentInstance = getAgent();
                agentInstance.updateConfig(config as Partial<AgentConfig>);
                return { success: true };
            } catch (error) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        }
    );

    ipcMain.handle('agent-get-config', async () => {
        const agentInstance = getAgent();
        return agentInstance.getConfig();
    });

    // Trace log
    ipcMain.handle('agent-get-trace', async () => {
        const fs = require('fs/promises');
        const pathModule = require('path');

        try {
            const today = new Date().toISOString().split('T')[0];
            const logFile = pathModule.join(
                process.cwd(),
                'logs',
                `agent-${today}.log`
            );

            try {
                const content = await fs.readFile(logFile, 'utf-8');
                const lines = content.split('\n');
                const lastLines = lines.slice(-500).join('\n');
                return lastLines;
            } catch {
                return `No trace log found for today (${today})`;
            }
        } catch (error) {
            const errorMsg =
                error instanceof Error ? error.message : 'Unknown error';
            return `Error reading trace: ${errorMsg}`;
        }
    });

    // Execution Mode
    ipcMain.handle('agent-get-execution-mode', async () => {
        return settings.getExecutionMode();
    });

    ipcMain.handle(
        'agent-set-execution-mode',
        async (_event, mode: 'iterative' | 'script') => {
            try {
                settings.setExecutionMode(mode);
                const agentInstance = getAgent();
                agentInstance.setExecutionMode(mode);
                log.info('Execution mode updated', { mode });
                return { success: true };
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : 'Unknown error';
                log.error('Failed to set execution mode', { error: errorMessage });
                return { success: false, error: errorMessage };
            }
        }
    );

    log.info('Config IPC handlers registered');
}

