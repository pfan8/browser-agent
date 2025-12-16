/**
 * LLM Configuration Loader
 * 
 * Loads LLM configuration from local file with support for:
 * - Optional fields with sensible defaults
 * - Environment variable overrides
 * - Multiple config file locations
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import _ from 'lodash';
/**
 * LLM provider type
 */
export type LLMProvider = 'anthropic' | 'openai' | 'custom';

/**
 * Full LLM configuration interface
 */
export interface LLMConfig {
  // Provider settings
  provider?: LLMProvider;
  apiKey?: string;
  baseUrl?: string;
  
  // Model settings
  model?: string;
  
  // Generation parameters (all optional)
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  
  // Timeout settings
  timeout?: number;
  maxRetries?: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_LLM_CONFIG: Required<Omit<LLMConfig, 'apiKey' | 'baseUrl' | 'topK' | 'maxTokens'>> & Pick<LLMConfig, 'apiKey' | 'baseUrl' | 'topK' | 'maxTokens'> = {
  provider: 'anthropic',
  apiKey: undefined,
  baseUrl: undefined,
  model: 'claude-3-haiku-20240307',
  temperature: 0,
  topP: 1,
  topK: undefined,
  maxTokens: undefined,
  timeout: 60000,
  maxRetries: 3,
};

/**
 * Config file search paths (in priority order)
 */
const CONFIG_PATHS = [
  // Project-level config
  './llm.config.json',
  './.llm.config.json',
  // User-level config
  path.join(os.homedir(), '.chat-agent', 'llm.config.json'),
  path.join(os.homedir(), '.config', 'chat-agent', 'llm.config.json'),
];

/**
 * Environment variable mappings
 */
const ENV_MAPPINGS: Record<keyof LLMConfig, string> = {
  provider: 'LLM_PROVIDER',
  apiKey: 'ANTHROPIC_API_KEY',
  baseUrl: 'ANTHROPIC_API_URL',
  model: 'LLM_MODEL',
  temperature: 'LLM_TEMPERATURE',
  topP: 'LLM_TOP_P',
  topK: 'LLM_TOP_K',
  maxTokens: 'LLM_MAX_TOKENS',
  timeout: 'LLM_TIMEOUT',
  maxRetries: 'LLM_MAX_RETRIES',
};

/**
 * Find the first existing config file
 */
function findConfigFile(customPath?: string): string | null {
  const paths = customPath ? [customPath, ...CONFIG_PATHS] : CONFIG_PATHS;
  
  for (const configPath of paths) {
    const absolutePath = path.isAbsolute(configPath) 
      ? configPath 
      : path.resolve(process.cwd(), configPath);
    
    if (fs.existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  
  return null;
}

/**
 * Load config from JSON file
 */
function loadConfigFile(filePath: string): Partial<LLMConfig> {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const config = JSON.parse(content);
    
    // Validate and sanitize
    const validated: Partial<LLMConfig> = {};
    
    if (typeof config.provider === 'string') {
      validated.provider = config.provider as LLMProvider;
    }
    if (typeof config.apiKey === 'string') {
      validated.apiKey = config.apiKey;
    }
    if (typeof config.baseUrl === 'string') {
      validated.baseUrl = config.baseUrl;
    }
    if (typeof config.model === 'string') {
      validated.model = config.model;
    }
    if (typeof config.temperature === 'number') {
      validated.temperature = Math.max(0, Math.min(2, config.temperature));
    }
    if (typeof config.topP === 'number') {
      validated.topP = Math.max(0, Math.min(1, config.topP));
    }
    if (typeof config.topK === 'number' && config.topK > 0) {
      validated.topK = config.topK;
    }
    if (typeof config.maxTokens === 'number' && config.maxTokens > 0) {
      validated.maxTokens = config.maxTokens;
    }
    if (typeof config.timeout === 'number' && config.timeout > 0) {
      validated.timeout = config.timeout;
    }
    if (typeof config.maxRetries === 'number' && config.maxRetries >= 0) {
      validated.maxRetries = config.maxRetries;
    }
    
    return validated;
  } catch (error) {
    console.warn(`[LLMConfig] Failed to load config from ${filePath}:`, error);
    return {};
  }
}

/**
 * Load config from environment variables
 */
function loadEnvConfig(): Partial<LLMConfig> {
  const config: Partial<LLMConfig> = {};
  
  // String values
  if (process.env[ENV_MAPPINGS.provider]) {
    config.provider = process.env[ENV_MAPPINGS.provider] as LLMProvider;
  }
  if (process.env[ENV_MAPPINGS.apiKey]) {
    config.apiKey = process.env[ENV_MAPPINGS.apiKey];
  }
  if (process.env[ENV_MAPPINGS.baseUrl]) {
    config.baseUrl = process.env[ENV_MAPPINGS.baseUrl];
  }
  if (process.env[ENV_MAPPINGS.model]) {
    config.model = process.env[ENV_MAPPINGS.model];
  }
  
  // Numeric values
  const tempStr = process.env[ENV_MAPPINGS.temperature];
  if (tempStr) {
    const temp = parseFloat(tempStr);
    if (!isNaN(temp)) config.temperature = temp;
  }
  
  const topPStr = process.env[ENV_MAPPINGS.topP];
  if (topPStr) {
    const topP = parseFloat(topPStr);
    if (!isNaN(topP)) config.topP = topP;
  }
  
  const topKStr = process.env[ENV_MAPPINGS.topK];
  if (topKStr) {
    const topK = parseInt(topKStr, 10);
    if (!isNaN(topK)) config.topK = topK;
  }
  
  const maxTokensStr = process.env[ENV_MAPPINGS.maxTokens];
  if (maxTokensStr) {
    const maxTokens = parseInt(maxTokensStr, 10);
    if (!isNaN(maxTokens)) config.maxTokens = maxTokens;
  }
  
  const timeoutStr = process.env[ENV_MAPPINGS.timeout];
  if (timeoutStr) {
    const timeout = parseInt(timeoutStr, 10);
    if (!isNaN(timeout)) config.timeout = timeout;
  }
  
  const maxRetriesStr = process.env[ENV_MAPPINGS.maxRetries];
  if (maxRetriesStr) {
    const maxRetries = parseInt(maxRetriesStr, 10);
    if (!isNaN(maxRetries)) config.maxRetries = maxRetries;
  }
  
  return config;
}

/**
 * Cached config instance
 */
let cachedConfig: LLMConfig | null = null;
let cachedConfigPath: string | null = null;

/**
 * Model-specific configuration constraints
 */
interface ModelConstraint {
  /** Pattern to match model names */
  pattern: RegExp;
  /** Description for logging */
  description: string;
  /** Validation and auto-fix function */
  validate: (config: LLMConfig) => { fixed: LLMConfig; warnings: string[] };
}

/**
 * Claude 4.5 models cannot have both temperature and top_p set
 * When both are present, we keep temperature and remove top_p
 */
function validateClaude45Config(config: LLMConfig): { fixed: LLMConfig; warnings: string[] } {
  const warnings: string[] = [];
  const fixed = { ...config };
  
  const hasTemperature = fixed.temperature !== undefined;
  const hasTopP = fixed.topP !== undefined;
  
  if (hasTemperature && hasTopP) {
    warnings.push(
      `Claude 4.5 models cannot use both temperature and top_p. ` +
      `Keeping temperature=${fixed.temperature}, removing top_p=${fixed.topP}`
    );
    delete fixed.topP;
  }
  
  return { fixed, warnings };
}

/**
 * Model constraints registry
 */
const MODEL_CONSTRAINTS: ModelConstraint[] = [
  {
    pattern: /^claude-(sonnet|opus)-4-5-/i,
    description: 'Claude 4.5 models',
    validate: validateClaude45Config,
  },
];

/**
 * Validate and auto-fix model-specific configuration
 * 
 * @param config The merged LLM config to validate
 * @returns Fixed config with any necessary adjustments
 */
function validateAndFixConfig(config: LLMConfig): LLMConfig {
  if (!config.model) {
    return config;
  }
  
  let currentConfig = { ...config };
  
  for (const constraint of MODEL_CONSTRAINTS) {
    if (constraint.pattern.test(config.model)) {
      const { fixed, warnings } = constraint.validate(currentConfig);
      
      for (const warning of warnings) {
        console.warn(`[LLMConfig] Auto-fix (${constraint.description}): ${warning}`);
      }
      
      currentConfig = fixed;
    }
  }
  
  return currentConfig;
}

/**
 * Load LLM configuration
 * 
 * Priority (highest to lowest):
 * 1. Runtime overrides (passed as parameter)
 * 2. Environment variables
 * 3. Config file
 * 4. Default values
 * 
 * @param overrides Runtime configuration overrides
 * @param customConfigPath Custom path to config file
 * @param forceReload Force reload config (ignore cache)
 */
export function loadLLMConfig(
  overrides?: Partial<LLMConfig>,
  customConfigPath?: string,
  forceReload = false
): LLMConfig {
  // Return cached config if available and not forcing reload
  if (cachedConfig && !forceReload && !overrides && !customConfigPath) {
    return cachedConfig;
  }
  
  // Load from file
  const configPath = findConfigFile(customConfigPath);
  const fileConfig = configPath ? loadConfigFile(configPath) : {};
  
  if (configPath) {
    console.log(`[LLMConfig] Loaded config from: ${configPath}`);
    cachedConfigPath = configPath;
  }
  
  // Load from environment
  const envConfig = loadEnvConfig();
  
  // Merge configs (priority: overrides > env > file > defaults)
  // Helper to filter out undefined keys from a config object (shallow)

  function filterUndefined<T extends object>(obj: T): Partial<T> {
    return _.omitBy(obj, _.isNil) as Partial<T>;
  }

  const mergedConfig: LLMConfig = {
    ...filterUndefined(DEFAULT_LLM_CONFIG),
    ...filterUndefined(fileConfig),
    ...filterUndefined(envConfig),
    ...filterUndefined(overrides ?? {}),
  };
  
  // Validate and auto-fix model-specific configurations
  const validatedConfig = validateAndFixConfig(mergedConfig);

  console.log("================================================")
  console.log("[LLMConfig] Default Config:", DEFAULT_LLM_CONFIG);
  console.log("[LLMConfig] File Config:", fileConfig);
  console.log("[LLMConfig] Env Config:", envConfig);
  console.log("[LLMConfig] Overrides:", overrides);
  console.log("[LLMConfig] Merged Config:", mergedConfig);
  console.log("[LLMConfig] Validated Config:", validatedConfig);
  console.log("================================================");
  
  // Cache the config
  if (!overrides && !customConfigPath) {
    cachedConfig = validatedConfig;
  }
  
  return validatedConfig;
}

/**
 * Get the path of the currently loaded config file
 */
export function getConfigPath(): string | null {
  return cachedConfigPath;
}

/**
 * Clear cached config (useful for testing or hot-reload)
 */
export function clearConfigCache(): void {
  cachedConfig = null;
  cachedConfigPath = null;
}

/**
 * Create a sample config file
 */
export function createSampleConfig(outputPath?: string): string {
  const sampleConfig = {
    // LLM Provider: "anthropic" | "openai" | "custom"
    provider: "anthropic",
    
    // API Key (can also use ANTHROPIC_API_KEY env var)
    // apiKey: "your-api-key-here",
    
    // Custom API endpoint (optional)
    // baseUrl: "https://api.anthropic.com",
    
    // Model name
    model: "claude-3-haiku-20240307",
    
    // Generation parameters
    temperature: 0,
    topP: 1,
    // topK: 40,
    // maxTokens: 4096,
    
    // Timeout settings
    timeout: 60000,
    maxRetries: 3,
  };
  
  const configJson = JSON.stringify(sampleConfig, null, 2);
  const targetPath = outputPath || './llm.config.json';
  
  fs.writeFileSync(targetPath, configJson, 'utf-8');
  console.log(`[LLMConfig] Sample config created at: ${targetPath}`);
  
  return targetPath;
}

