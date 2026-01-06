/**
 * Multimodal Module
 *
 * Unified multimodal support for the agent architecture.
 */

// Core types
export type {
    ContentBlock,
    ContentBlockType,
    TextBlock,
    ImageBlock,
    AudioBlock,
    VideoBlock,
    FileBlock,
    CodeBlock,
    MultimodalMessage,
    ArtifactType,
    ArtifactRef,
} from './types';

export {
    createTextMessage,
    createMultimodalMessage,
    extractText,
    extractBlocks,
    hasContentType,
    getContentTypes,
    generateArtifactId,
} from './types';

// Artifact Manager
export type { ArtifactManagerConfig } from './artifact-manager';
export { ArtifactManager, createArtifactManager } from './artifact-manager';

// SubAgent types
export type {
    SubAgentRequest,
    SubAgentOptions,
    SubAgentResult,
    StreamEvent,
    ThinkingEvent,
    ProgressEvent,
    ArtifactEvent,
    PartialResultEvent,
    SubAgentContext,
    ISubAgent,
    ISubAgentRegistry,
} from './subagent-types';

export {
    BaseSubAgent,
    SubAgentRegistry,
    createSubAgentRegistry,
} from './subagent-types';

