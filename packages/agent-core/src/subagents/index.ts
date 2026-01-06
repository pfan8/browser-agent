/**
 * SubAgents Module
 *
 * SubAgent implementations for the multimodal orchestrator architecture.
 */

// CodeAct SubAgent
export type { CodeActSubAgentConfig } from './codeact-subagent';
export { CodeActSubAgent, createCodeActSubAgent } from './codeact-subagent';

// Vision SubAgent
export type { VisionSubAgentConfig } from './vision-subagent';
export { VisionSubAgent, createVisionSubAgent } from './vision-subagent';

