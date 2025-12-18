/**
 * LangSmith Integration
 * 
 * Optional integration with LangSmith for advanced tracing and analysis.
 * Enable by setting LANGSMITH_API_KEY environment variable.
 * 
 * LangSmith provides:
 * - Automatic tracing of LangGraph executions
 * - Prompt/Response visualization
 * - Token usage tracking
 * - Performance analysis
 */

import { createAgentLogger } from './agent-logger';

const log = createAgentLogger('LangSmith');

// ============================================
// Types
// ============================================

export interface LangSmithConfig {
  apiKey?: string;
  project?: string;
  endpoint?: string;
  enabled: boolean;
}

// ============================================
// Configuration
// ============================================

/**
 * Get LangSmith configuration from environment
 */
export function getLangSmithConfig(): LangSmithConfig {
  const apiKey = process.env.LANGSMITH_API_KEY || process.env.LANGCHAIN_API_KEY;
  const project = process.env.LANGSMITH_PROJECT || process.env.LANGCHAIN_PROJECT || 'chat-browser-agent';
  const endpoint = process.env.LANGSMITH_ENDPOINT || process.env.LANGCHAIN_ENDPOINT;
  const tracingEnabled = process.env.LANGCHAIN_TRACING_V2 === 'true';
  
  return {
    apiKey,
    project,
    endpoint,
    enabled: !!apiKey && tracingEnabled,
  };
}

/**
 * Check if LangSmith tracing is enabled
 */
export function isLangSmithEnabled(): boolean {
  const config = getLangSmithConfig();
  return config.enabled;
}

/**
 * Initialize LangSmith tracing
 * Call this at application startup if you want LangSmith integration
 */
export function initLangSmith(): boolean {
  const config = getLangSmithConfig();
  
  if (!config.enabled) {
    log.debug('LangSmith tracing is not enabled', {
      hasApiKey: !!config.apiKey,
      tracingEnabled: process.env.LANGCHAIN_TRACING_V2,
    });
    return false;
  }
  
  // LangChain/LangGraph automatically picks up these environment variables
  // Just log that it's enabled
  log.info('LangSmith tracing enabled', {
    project: config.project,
    endpoint: config.endpoint || 'default',
  });
  
  return true;
}

/**
 * Get environment variables needed for LangSmith
 * Useful for documentation or setup verification
 */
export function getLangSmithEnvVars(): Record<string, string | undefined> {
  return {
    LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY,
    LANGCHAIN_API_KEY: process.env.LANGCHAIN_API_KEY,
    LANGSMITH_PROJECT: process.env.LANGSMITH_PROJECT,
    LANGCHAIN_PROJECT: process.env.LANGCHAIN_PROJECT,
    LANGCHAIN_TRACING_V2: process.env.LANGCHAIN_TRACING_V2,
    LANGSMITH_ENDPOINT: process.env.LANGSMITH_ENDPOINT,
    LANGCHAIN_ENDPOINT: process.env.LANGCHAIN_ENDPOINT,
  };
}

/**
 * Instructions for enabling LangSmith
 */
export const LANGSMITH_SETUP_INSTRUCTIONS = `
# LangSmith Integration Setup

LangSmith provides advanced tracing, debugging, and analysis for LangGraph agents.

## Environment Variables

Set the following environment variables to enable LangSmith:

\`\`\`bash
# Required: Your LangSmith API key
export LANGSMITH_API_KEY="your-api-key-here"

# Required: Enable tracing
export LANGCHAIN_TRACING_V2="true"

# Optional: Custom project name (default: chat-browser-agent)
export LANGSMITH_PROJECT="my-project"

# Optional: Custom endpoint (for self-hosted LangSmith)
export LANGSMITH_ENDPOINT="https://api.langsmith.com"
\`\`\`

## Getting an API Key

1. Go to https://smith.langchain.com
2. Create an account or sign in
3. Navigate to Settings > API Keys
4. Create a new API key

## Viewing Traces

Once enabled, all agent executions will be traced automatically.
View them at: https://smith.langchain.com/projects

## Benefits

- Visualize the agent's decision-making process
- Debug failed actions with full context
- Track token usage and costs
- Analyze performance bottlenecks
- Share traces with team members
`;

