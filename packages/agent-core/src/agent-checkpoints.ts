/**
 * Agent Checkpoint Utilities
 *
 * Checkpoint-related helper functions for BrowserAgent.
 * Extracted to keep browser-agent.ts under 800 lines.
 */

import {
    HumanMessage,
    SystemMessage,
    AIMessage,
    BaseMessage,
} from '@langchain/core/messages';
import type { AgentState } from './state';
import { createAgentLogger } from './tracing';
import type { CheckpointHistoryItem } from './checkpointer';

const log = createAgentLogger('AgentCheckpoints');

/**
 * Coerce a potentially serialized message to a proper BaseMessage instance.
 * This handles messages restored from checkpoints that are plain objects.
 */
export function coerceToBaseMessage(msg: unknown): BaseMessage {
    if (msg instanceof BaseMessage) {
        return msg;
    }

    if (msg && typeof msg === 'object') {
        const obj = msg as Record<string, unknown>;

        if (obj.lc_serializable && obj.lc_kwargs) {
            const kwargs = obj.lc_kwargs as Record<string, unknown>;
            const content = (kwargs.content as string) || '';
            const namespace = obj.lc_namespace as string[] | undefined;

            if (namespace && namespace.includes('messages')) {
                if ('tool_calls' in kwargs || 'invalid_tool_calls' in kwargs) {
                    return new AIMessage({ content });
                }
            }
            return new AIMessage({ content });
        }

        if ('type' in obj || '_type' in obj) {
            const msgType = (obj.type || obj._type) as string;
            const content = (obj.content as string) || '';

            switch (msgType) {
                case 'human':
                    return new HumanMessage(content);
                case 'ai':
                    return new AIMessage(content);
                case 'system':
                    return new SystemMessage(content);
                default:
                    return new AIMessage(content);
            }
        }

        if ('content' in obj) {
            return new AIMessage((obj.content as string) || '');
        }
    }

    return new AIMessage(String(msg));
}

/**
 * Convert a LangGraph state snapshot to a CheckpointHistoryItem
 */
export function snapshotToHistoryItem(
    threadId: string,
    snapshot: any
): CheckpointHistoryItem | null {
    try {
        const config = snapshot.config?.configurable || {};
        const checkpointId = config.checkpoint_id || config.thread_ts || '';
        const parentId = snapshot.parentConfig?.configurable?.checkpoint_id;
        const metadata = snapshot.metadata || {};
        const step = metadata.step ?? 0;
        const source = metadata.source || 'unknown';
        const writes = metadata.writes;
        const values = snapshot.values || {};
        const messages = values.messages || [];
        const lastMessage = messages[messages.length - 1];
        let messagePreview = '';
        let isUserMessage = false;

        if (lastMessage) {
            isUserMessage =
                lastMessage._getType?.() === 'human' ||
                lastMessage.type === 'human' ||
                (lastMessage.lc_namespace &&
                    lastMessage.lc_namespace.includes('HumanMessage'));

            const content =
                typeof lastMessage.content === 'string'
                    ? lastMessage.content
                    : JSON.stringify(lastMessage.content);
            messagePreview = content.substring(0, 100);
        }

        const createdAt = config.checkpoint_ts
            ? new Date(config.checkpoint_ts).toISOString()
            : new Date().toISOString();

        return {
            checkpointId,
            threadId,
            parentCheckpointId: parentId,
            createdAt,
            step,
            metadata: { source, writes },
            messagePreview,
            isUserMessage,
        };
    } catch (error) {
        log.debug('Failed to convert snapshot to history item', { error });
        return null;
    }
}

/**
 * Restore state data from a snapshot, handling serialization
 */
export function restoreStateFromSnapshot(
    snapshotValues: Record<string, unknown>
): Partial<AgentState> {
    const state = { ...snapshotValues };

    // Restore Map types
    if (
        state.actionSignatures &&
        (state.actionSignatures as any).__type === 'Map'
    ) {
        state.actionSignatures = new Map(
            (state.actionSignatures as any).data
        );
    }

    // Restore BaseMessage instances from serialized format
    if (state.messages && Array.isArray(state.messages)) {
        state.messages = (state.messages as unknown[]).map(coerceToBaseMessage);
    }

    return state as Partial<AgentState>;
}

