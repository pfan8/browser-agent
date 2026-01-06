/**
 * Multimodal Types
 *
 * Core type definitions for the unified multimodal agent architecture.
 * Supports bidirectional multimodal I/O (input and output).
 */

// ============================================================
// Content Blocks - Atomic units of multimodal content
// ============================================================

/**
 * Text content block
 */
export interface TextBlock {
    type: 'text';
    text: string;
}

/**
 * Image content block
 */
export interface ImageBlock {
    type: 'image';
    /** Image path or base64 data URL */
    source: string;
    /** Image description (if analyzed) */
    description?: string;
    /** MIME type */
    mimeType?: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
    /** Dimensions */
    width?: number;
    height?: number;
}

/**
 * Audio content block
 */
export interface AudioBlock {
    type: 'audio';
    /** Audio file path or URL */
    source: string;
    /** Transcribed text (if transcribed) */
    transcript?: string;
    /** Duration in seconds */
    duration?: number;
    /** MIME type */
    mimeType?: 'audio/wav' | 'audio/mp3' | 'audio/ogg' | 'audio/webm';
}

/**
 * Video content block
 */
export interface VideoBlock {
    type: 'video';
    /** Video file path or URL */
    source: string;
    /** Keyframe image paths (if extracted) */
    keyframes?: string[];
    /** Video description */
    description?: string;
    /** Duration in seconds */
    duration?: number;
    /** MIME type */
    mimeType?: 'video/mp4' | 'video/webm';
}

/**
 * File content block (for arbitrary files)
 */
export interface FileBlock {
    type: 'file';
    /** File path */
    path: string;
    /** MIME type */
    mimeType: string;
    /** File name */
    name: string;
    /** File size in bytes */
    size?: number;
}

/**
 * Code content block
 */
export interface CodeBlock {
    type: 'code';
    /** Programming language */
    language: string;
    /** Code content */
    code: string;
    /** Associated file path (if saved to disk) */
    filePath?: string;
}

/**
 * Union of all content block types
 */
export type ContentBlock =
    | TextBlock
    | ImageBlock
    | AudioBlock
    | VideoBlock
    | FileBlock
    | CodeBlock;

/**
 * Content block type discriminator
 */
export type ContentBlockType = ContentBlock['type'];

// ============================================================
// Multimodal Message - Container for content blocks
// ============================================================

/**
 * A multimodal message containing multiple content blocks
 */
export interface MultimodalMessage {
    /** Unique message ID */
    id: string;

    /** Primary text content (convenience accessor) */
    text?: string;

    /** All content blocks */
    content: ContentBlock[];

    /** Creation timestamp */
    timestamp: Date;

    /** Source of the message */
    source: 'user' | 'agent' | 'subagent' | 'system';

    /** Metadata */
    metadata?: Record<string, unknown>;
}

// ============================================================
// Artifact References - Pointers to generated artifacts
// ============================================================

/**
 * Types of artifacts that can be generated
 */
export type ArtifactType =
    | 'screenshot'
    | 'video'
    | 'audio'
    | 'code'
    | 'report'
    | 'log'
    | 'data';

/**
 * Reference to a generated artifact
 */
export interface ArtifactRef {
    /** Unique artifact ID */
    id: string;
    /** Artifact type */
    type: ArtifactType;
    /** File path */
    path: string;
    /** Creation timestamp */
    createdAt: Date;
    /** File size in bytes */
    size?: number;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create a text-only multimodal message
 */
export function createTextMessage(
    text: string,
    source: MultimodalMessage['source'] = 'agent'
): MultimodalMessage {
    return {
        id: generateMessageId(),
        text,
        content: [{ type: 'text', text }],
        timestamp: new Date(),
        source,
    };
}

/**
 * Create a multimodal message with mixed content
 */
export function createMultimodalMessage(
    content: ContentBlock[],
    source: MultimodalMessage['source'] = 'agent'
): MultimodalMessage {
    const textBlocks = content.filter(
        (b): b is TextBlock => b.type === 'text'
    );
    const text = textBlocks.map((b) => b.text).join('\n');

    return {
        id: generateMessageId(),
        text: text || undefined,
        content,
        timestamp: new Date(),
        source,
    };
}

/**
 * Extract text content from a multimodal message
 */
export function extractText(message: MultimodalMessage): string {
    if (message.text) return message.text;

    return message.content
        .filter((b): b is TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
}

/**
 * Extract content blocks of a specific type
 */
export function extractBlocks<T extends ContentBlock>(
    message: MultimodalMessage,
    type: T['type']
): T[] {
    return message.content.filter((b): b is T => b.type === type);
}

/**
 * Check if a message contains a specific content type
 */
export function hasContentType(
    message: MultimodalMessage,
    type: ContentBlockType
): boolean {
    return message.content.some((b) => b.type === type);
}

/**
 * Get all content types present in a message
 */
export function getContentTypes(message: MultimodalMessage): ContentBlockType[] {
    const types = new Set<ContentBlockType>();
    for (const block of message.content) {
        types.add(block.type);
    }
    return Array.from(types);
}

/**
 * Generate a unique message ID
 */
function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Generate a unique artifact ID
 */
export function generateArtifactId(): string {
    return `artifact_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

