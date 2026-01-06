/**
 * SubAgents V3 Module
 *
 * New SubAgent implementations for the multimodal orchestrator architecture.
 */

// CodeAct SubAgent
export type { CodeActSubAgentConfig } from './codeact-subagent';
export { CodeActSubAgentV3, createCodeActSubAgentV3 } from './codeact-subagent';

// Vision SubAgent
export type { VisionSubAgentConfig } from './vision-subagent';
export { VisionSubAgentV3, createVisionSubAgentV3 } from './vision-subagent';

