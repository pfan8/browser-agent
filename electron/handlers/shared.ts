/**
 * Shared Utilities for IPC Handlers
 *
 * Provides shared context and utilities used across handler modules.
 * This module is initialized from main.ts with the required dependencies.
 */

import { BrowserWindow } from 'electron';
import type { BrowserAgent, AgentState } from '@chat-agent/agent-core';
import { createLogger } from '../utils/logger';

export const log = createLogger('Handlers');

// Shared context - set by main.ts during initialization
let sharedContext: {
    getMainWindow: () => BrowserWindow | null;
    getAgent: () => BrowserAgent;
    isQuitting: () => boolean;
} | null = null;

/**
 * Initialize the shared context (called from main.ts)
 */
export function initSharedContext(context: {
    getMainWindow: () => BrowserWindow | null;
    getAgent: () => BrowserAgent;
    isQuitting: () => boolean;
}): void {
    sharedContext = context;
}

/**
 * Get the BrowserAgent instance
 */
export function getAgent(): BrowserAgent {
    if (!sharedContext) {
        throw new Error('Shared context not initialized');
    }
    return sharedContext.getAgent();
}

/**
 * Get the main window instance
 */
export function getMainWindow(): BrowserWindow | null {
    if (!sharedContext) {
        return null;
    }
    return sharedContext.getMainWindow();
}

/**
 * Check if window is valid for IPC
 */
export function isWindowValid(): boolean {
    if (!sharedContext || sharedContext.isQuitting()) {
        return false;
    }

    try {
        const mainWindow = sharedContext.getMainWindow();
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

/**
 * Safely serialize data for IPC
 */
export function safeSerialize(data: unknown): unknown {
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

/**
 * Safely send data to renderer process
 */
export function safeSend(channel: string, data: unknown): void {
    if (!isWindowValid()) return;

    try {
        const mainWindow = getMainWindow();
        if (mainWindow) {
            const serialized = safeSerialize(data);
            mainWindow.webContents.send(channel, serialized);
        }
    } catch (e) {
        if (e instanceof Error && e.message.includes('disposed')) {
            log.debug('Window disposed, skipping IPC send');
            return;
        }
        log.error('Failed to send IPC message:', e);
    }
}

// Re-export types for convenience
export type { AgentState };

