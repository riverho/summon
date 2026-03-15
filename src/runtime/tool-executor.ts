/**
 * Tool Executor — Execute bound tools with secret injection
 * 
 * Handles tool execution with environment variable injection for API keys
 * and other secrets stored in ~/.summon/.env
 * 
 * [HARDENING] Includes enhanced timeouts, safe secret logging, execution metrics,
 * input validation, and comprehensive error boundaries.
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { config } from 'dotenv';

const ENV_FILE = join(homedir(), '.summon', '.env');

// [HARDENING] Execution configuration
const DEFAULT_TIMEOUT_MS = 60000; // 60s default timeout
const MIN_TIMEOUT_MS = 1000; // Minimum allowed timeout
const MAX_TIMEOUT_MS = 300000; // Maximum allowed timeout (5 min)
const DEFAULT_RETRIES = 0;
const MAX_RETRIES = 5;

// [HARDENING] Metrics retention
const MAX_METRICS_HISTORY = 1000;

export interface ToolExecutionOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Retry count on failure */
  retries?: number;
  /** Whether to inject secrets */
  injectSecrets?: boolean;
  /** [HARDENING] Whether to validate input before execution */
  validateInput?: boolean;
  /** [HARDENING] Custom validation function */
  inputValidator?: (args: Record<string, unknown>) => { valid: boolean; error?: string };
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  toolName: string;
  executionTimeMs: number;
  error?: string;
  /** [HARDENING] Retry count used */
  retryCount?: number;
  /** [HARDENING] Whether result came from cache */
  cached?: boolean;
}

export interface SecretMapping {
  /** Environment variable name in .env file */
  envVar: string;
  /** Key in the tool's config where the secret should be injected */
  toolKey: string;
}

/**
 * SECURITY FIX: Explicit secret mappings for known tools
 * Replaces auto-detection that could grab wrong values by pattern matching
 */
export function getSecretMapping(toolName: string): SecretMapping[] {
  const normalizedName = toolName.toLowerCase();

  // Explicit mappings for known tools - never guess based on key names
  const mappings: Record<string, SecretMapping[]> = {
    // OpenAI tools
    openai: [
      { envVar: 'OPENAI_API_KEY', toolKey: 'api_key' },
      { envVar: 'OPENAI_API_KEY', toolKey: 'openai_api_key' },
    ],
    // Anthropic tools
    anthropic: [
      { envVar: 'ANTHROPIC_API_KEY', toolKey: 'api_key' },
      { envVar: 'ANTHROPIC_API_KEY', toolKey: 'anthropic_api_key' },
    ],
    // Google/Gemini tools
    gemini: [
      { envVar: 'GOOGLE_API_KEY', toolKey: 'api_key' },
      { envVar: 'GEMINI_API_KEY', toolKey: 'api_key' },
    ],
    // GitHub tools
    github: [
      { envVar: 'GITHUB_TOKEN', toolKey: 'token' },
      { envVar: 'GITHUB_TOKEN', toolKey: 'github_token' },
      { envVar: 'GITHUB_API_TOKEN', toolKey: 'token' },
    ],
    // SerpAPI tools
    serpapi: [
      { envVar: 'SERPAPI_API_KEY', toolKey: 'api_key' },
      { envVar: 'SERPAPI_KEY', toolKey: 'api_key' },
    ],
    // Weather/OpenWeather tools
    weather: [
      { envVar: 'OPENWEATHER_API_KEY', toolKey: 'api_key' },
      { envVar: 'WEATHER_API_KEY', toolKey: 'api_key' },
    ],
    // Pinecone tools
    pinecone: [
      { envVar: 'PINECONE_API_KEY', toolKey: 'api_key' },
      { envVar: 'PINECONE_API_KEY', toolKey: 'pinecone_api_key' },
    ],
    // AWS tools
    aws: [
      { envVar: 'AWS_ACCESS_KEY_ID', toolKey: 'aws_access_key_id' },
      { envVar: 'AWS_SECRET_ACCESS_KEY', toolKey: 'aws_secret_access_key' },
    ],
    // Slack tools
    slack: [
      { envVar: 'SLACK_BOT_TOKEN', toolKey: 'token' },
      { envVar: 'SLACK_TOKEN', toolKey: 'token' },
    ],
    // Discord tools
    discord: [
      { envVar: 'DISCORD_BOT_TOKEN', toolKey: 'token' },
      { envVar: 'DISCORD_TOKEN', toolKey: 'token' },
    ],
    // Twitter/X tools
    twitter: [
      { envVar: 'TWITTER_API_KEY', toolKey: 'api_key' },
      { envVar: 'TWITTER_BEARER_TOKEN', toolKey: 'bearer_token' },
    ],
    // Notion tools
    notion: [
      { envVar: 'NOTION_TOKEN', toolKey: 'token' },
      { envVar: 'NOTION_API_KEY', toolKey: 'api_key' },
    ],
  };

  // Return mappings for the specific tool, or empty array if unknown
  return mappings[normalizedName] || [];
}

/**
 * SECURITY FIX: Sanitize error messages to remove any secret values
 * Prevents accidental leakage of injected secrets in error output
 */
export function sanitizeErrorMessage(message: string, secrets: Record<string, string>): string {
  let sanitized = message;

  // Replace all secret values with [REDACTED]
  for (const [, value] of Object.entries(secrets)) {
    if (value && value.length > 4) {
      // Use regex to replace all occurrences, escape special regex chars
      const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'g');
      sanitized = sanitized.replace(regex, '[REDACTED]');
    }
  }

  return sanitized;
}

/**
 * [HARDENING] Tool execution metrics for monitoring
 */
interface ToolMetrics {
  toolName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTimeMs: number;
  lastExecutionAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
}

/**
 * [HARDENING] Global metrics store
 */
const toolMetrics = new Map<string, ToolMetrics>();

/**
 * [HARDENING] Execution history for debugging
 */
interface ExecutionRecord {
  timestamp: Date;
  toolName: string;
  success: boolean;
  executionTimeMs: number;
  error?: string;
}

const executionHistory: ExecutionRecord[] = [];

/**
 * [HARDENING] Input validation helpers
 */
export const InputValidators = {
  /** Validate string is non-empty */
  nonEmptyString: (value: unknown, fieldName: string): { valid: boolean; error?: string } => {
    if (typeof value !== 'string') {
      return { valid: false, error: `${fieldName} must be a string` };
    }
    if (value.trim().length === 0) {
      return { valid: false, error: `${fieldName} cannot be empty` };
    }
    return { valid: true };
  },

  /** Validate URL format */
  url: (value: unknown, fieldName: string): { valid: boolean; error?: string } => {
    if (typeof value !== 'string') {
      return { valid: false, error: `${fieldName} must be a string` };
    }
    try {
      new URL(value);
      return { valid: true };
    } catch {
      return { valid: false, error: `${fieldName} must be a valid URL` };
    }
  },

  /** Validate email format */
  email: (value: unknown, fieldName: string): { valid: boolean; error?: string } => {
    if (typeof value !== 'string') {
      return { valid: false, error: `${fieldName} must be a string` };
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) {
      return { valid: false, error: `${fieldName} must be a valid email` };
    }
    return { valid: true };
  },

  /** Validate number is in range */
  numberRange: (
    value: unknown,
    fieldName: string,
    min: number,
    max: number
  ): { valid: boolean; error?: string } => {
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, error: `${fieldName} must be a number` };
    }
    if (value < min || value > max) {
      return { valid: false, error: `${fieldName} must be between ${min} and ${max}` };
    }
    return { valid: true };
  },

  /** Validate array is non-empty */
  nonEmptyArray: (value: unknown, fieldName: string): { valid: boolean; error?: string } => {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${fieldName} must be an array` };
    }
    if (value.length === 0) {
      return { valid: false, error: `${fieldName} cannot be empty` };
    }
    return { valid: true };
  },

  /** Validate one of allowed values */
  oneOf: (
    value: unknown,
    fieldName: string,
    allowed: unknown[]
  ): { valid: boolean; error?: string } => {
    if (!allowed.includes(value)) {
      return { valid: false, error: `${fieldName} must be one of: ${allowed.join(', ')}` };
    }
    return { valid: true };
  },

  /** Combine multiple validators */
  all: (...validators: { valid: boolean; error?: string }[]): { valid: boolean; error?: string } => {
    for (const validator of validators) {
      if (!validator.valid) return validator;
    }
    return { valid: true };
  },
};

/**
 * Load secrets from ~/.summon/.env
 */
export async function loadSecrets(): Promise<Record<string, string>> {
  if (!existsSync(ENV_FILE)) {
    return {};
  }
  
  try {
    // Use dotenv to parse
    const result = config({ path: ENV_FILE, override: false });
    return result.parsed || {};
  } catch {
    // Fallback: manual parse
    const content = await readFile(ENV_FILE, 'utf-8');
    const secrets: Record<string, string> = {};
    
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      
      secrets[key] = value;
    }
    
    return secrets;
  }
}

/**
 * Inject secrets into tool arguments
 */
export function injectSecrets(
  args: Record<string, unknown>,
  secretMappings: SecretMapping[],
  secrets: Record<string, string>
): Record<string, unknown> {
  const injected = { ...args };
  
  for (const mapping of secretMappings) {
    const secretValue = secrets[mapping.envVar];
    if (secretValue !== undefined) {
      injected[mapping.toolKey] = secretValue;
    }
  }
  
  return injected;
}

/**
 * [HARDENING] Log secret injection safely (without revealing values)
 */
function logSecretInjection(
  toolName: string,
  mappings: SecretMapping[],
  success: boolean
): void {
  // Log which secrets were injected without revealing values
  const envVarNames = mappings.map(m => m.envVar);
  const toolKeys = mappings.map(m => m.toolKey);
  
  if (success) {
    console.log(
      `[TOOL_EXECUTOR] Injected ${mappings.length} secrets into ${toolName}: ` +
      `env vars [${envVarNames.join(', ')}] → tool keys [${toolKeys.join(', ')}]`
    );
  } else {
    console.warn(
      `[TOOL_EXECUTOR] Failed to inject secrets into ${toolName}: ` +
      `attempted env vars [${envVarNames.join(', ')}]`
    );
  }
}

/**
 * Validate tool output
 */
export function validateToolOutput(output: unknown): { valid: boolean; error?: string } {
  if (output === undefined || output === null) {
    return { valid: false, error: 'Tool returned null or undefined' };
  }
  
  if (typeof output === 'string') {
    if (output.trim().length === 0) {
      return { valid: false, error: 'Tool returned empty string' };
    }
    return { valid: true };
  }
  
  if (typeof output === 'object') {
    // Check for error field
    if ('error' in output && output.error) {
      return { valid: false, error: String(output.error) };
    }
    return { valid: true };
  }
  
  return { valid: true };
}

/**
 * [HARDENING] Sanitize timeout value
 */
function sanitizeTimeout(timeout: number): number {
  if (isNaN(timeout) || timeout <= 0) {
    console.warn(`[TOOL_EXECUTOR] Invalid timeout ${timeout}, using default ${DEFAULT_TIMEOUT_MS}`);
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(MIN_TIMEOUT_MS, Math.min(timeout, MAX_TIMEOUT_MS));
}

/**
 * [HARDENING] Sanitize retry count
 */
function sanitizeRetries(retries: number): number {
  if (isNaN(retries) || retries < 0) {
    return DEFAULT_RETRIES;
  }
  return Math.min(retries, MAX_RETRIES);
}

/**
 * [HARDENING] Update metrics for a tool execution
 */
function updateMetrics(
  toolName: string,
  success: boolean,
  executionTimeMs: number,
  error?: string
): void {
  let metrics = toolMetrics.get(toolName);
  
  if (!metrics) {
    metrics = {
      toolName,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTimeMs: 0,
      lastExecutionAt: null,
      lastError: null,
      consecutiveFailures: 0,
    };
    toolMetrics.set(toolName, metrics);
  }
  
  metrics.totalExecutions += 1;
  metrics.lastExecutionAt = new Date();
  
  // Update consecutive failures counter
  if (success) {
    metrics.successfulExecutions += 1;
    metrics.consecutiveFailures = 0;
  } else {
    metrics.failedExecutions += 1;
    metrics.consecutiveFailures += 1;
    metrics.lastError = error || 'Unknown error';
  }
  
  // Update running average
  metrics.averageExecutionTimeMs = 
    (metrics.averageExecutionTimeMs * (metrics.totalExecutions - 1) + executionTimeMs) / 
    metrics.totalExecutions;
  
  // Record in history
  executionHistory.push({
    timestamp: new Date(),
    toolName,
    success,
    executionTimeMs,
    error,
  });
  
  // Trim history if too large
  if (executionHistory.length > MAX_METRICS_HISTORY) {
    executionHistory.shift();
  }
}

/**
 * Execute a tool with timeout and retry logic
 */
export async function executeTool(
  tool: DynamicStructuredTool,
  args: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  
  // [HARDENING] Validate tool object
  if (!tool || !tool.name || typeof tool.invoke !== 'function') {
    return {
      success: false,
      output: '',
      toolName: tool?.name || 'unknown',
      executionTimeMs: Date.now() - startTime,
      error: 'Invalid tool object provided',
    };
  }
  
  // [HARDENING] Sanitize options
  const timeout = sanitizeTimeout(options.timeout ?? DEFAULT_TIMEOUT_MS);
  const retries = sanitizeRetries(options.retries ?? DEFAULT_RETRIES);
  const shouldInject = options.injectSecrets ?? true;
  const shouldValidate = options.validateInput ?? true;
  
  // [HARDENING] Custom input validation
  if (shouldValidate && options.inputValidator) {
    const validation = options.inputValidator(args);
    if (!validation.valid) {
      updateMetrics(tool.name, false, Date.now() - startTime, validation.error);
      return {
        success: false,
        output: '',
        toolName: tool.name,
        executionTimeMs: Date.now() - startTime,
        error: `Input validation failed: ${validation.error}`,
      };
    }
  }
  
  let lastError: string | undefined;
  let retryCount = 0;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const attemptStartTime = Date.now();
    let secrets: Record<string, string> = {};

    try {
      // Load and inject secrets if enabled
      let finalArgs = args;
      if (shouldInject) {
        secrets = await loadSecrets();

        // SECURITY FIX: Use explicit secret mappings instead of auto-detection
        // Auto-detection could grab wrong values by matching key names
        const secretMappings = getSecretMapping(tool.name);

        if (secretMappings.length > 0) {
          finalArgs = injectSecrets(args, secretMappings, secrets);
          logSecretInjection(tool.name, secretMappings, true);
        }
      }
      
      // [HARDENING] Execute with timeout using AbortController pattern if supported
      let result: unknown;
      
      // Check if tool supports abort signal
      if ('func' in tool && typeof (tool as { func?: Function }).func === 'function') {
        // LangChain tools may not support AbortController, use Promise.race
        result = await Promise.race([
          tool.invoke(finalArgs),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout)
          ),
        ]);
      } else {
        // Fallback to Promise.race
        result = await Promise.race([
          tool.invoke(finalArgs),
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout)
          ),
        ]);
      }
      
      // Validate output
      const validation = validateToolOutput(result);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      const executionTimeMs = Date.now() - startTime;
      
      updateMetrics(tool.name, true, executionTimeMs);
      
      return {
        success: true,
        output,
        toolName: tool.name,
        executionTimeMs,
        retryCount: attempt > 0 ? attempt : undefined,
      };
      
    } catch (error) {
      // SECURITY FIX: Sanitize error messages to prevent secret leakage
      let errorMessage = error instanceof Error ? error.message : String(error);
      if (shouldInject && Object.keys(secrets).length > 0) {
        errorMessage = sanitizeErrorMessage(errorMessage, secrets);
      }
      lastError = errorMessage;
      retryCount = attempt;

      // [HARDENING] Log execution failure with context
      console.warn(
        `[TOOL_EXECUTOR] Tool ${tool.name} failed (attempt ${attempt + 1}/${retries + 1}): ${lastError}`
      );
      
      if (attempt < retries) {
        // [HARDENING] Exponential backoff with jitter
        const baseDelay = Math.min(1000 * Math.pow(2, attempt), 10000);
        const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
        const delay = Math.max(100, baseDelay + jitter);
        
        console.log(`[TOOL_EXECUTOR] Retrying ${tool.name} in ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  const executionTimeMs = Date.now() - startTime;
  updateMetrics(tool.name, false, executionTimeMs, lastError);
  
  return {
    success: false,
    output: '',
    toolName: tool.name,
    executionTimeMs,
    error: lastError || 'Unknown error',
    retryCount: retries > 0 ? retryCount : undefined,
  };
}

/**
 * Execute multiple tools in parallel
 */
export async function executeToolsParallel(
  toolCalls: Array<{
    tool: DynamicStructuredTool;
    args: Record<string, unknown>;
  }>,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult[]> {
  // [HARDENING] Validate input
  if (!Array.isArray(toolCalls)) {
    throw new Error('toolCalls must be an array');
  }
  
  return Promise.all(
    toolCalls.map(({ tool, args }) => executeTool(tool, args, options))
  );
}

/**
 * Execute tools sequentially
 */
export async function executeToolsSequential(
  toolCalls: Array<{
    tool: DynamicStructuredTool;
    args: Record<string, unknown>;
  }>,
  options?: ToolExecutionOptions
): Promise<ToolExecutionResult[]> {
  // [HARDENING] Validate input
  if (!Array.isArray(toolCalls)) {
    throw new Error('toolCalls must be an array');
  }
  
  const results: ToolExecutionResult[] = [];
  
  for (const { tool, args } of toolCalls) {
    const result = await executeTool(tool, args, options);
    results.push(result);
    
    // [HARDENING] Stop on first failure - fail closed
    if (!result.success) {
      console.warn(`[TOOL_EXECUTOR] Stopping sequential execution due to failure in ${tool.name}`);
      break;
    }
  }
  
  return results;
}

/**
 * Check if secrets file exists and has content
 */
export async function hasSecretsConfigured(): Promise<boolean> {
  if (!existsSync(ENV_FILE)) {
    return false;
  }
  
  try {
    const content = await readFile(ENV_FILE, 'utf-8');
    return content.trim().length > 0 && 
           content.split('\n').some(line => line.includes('=') && !line.startsWith('#'));
  } catch {
    return false;
  }
}

/**
 * Get list of available secrets (names only, not values)
 */
export async function listSecretNames(): Promise<string[]> {
  const secrets = await loadSecrets();
  return Object.keys(secrets).sort();
}

/**
 * [HARDENING] Get metrics for a specific tool or all tools
 */
export function getToolMetrics(toolName?: string): ToolMetrics | Map<string, ToolMetrics> | null {
  if (toolName) {
    return toolMetrics.get(toolName) || null;
  }
  return new Map(toolMetrics);
}

/**
 * [HARDENING] Get execution history
 */
export function getExecutionHistory(
  filter?: { toolName?: string; success?: boolean; since?: Date }
): ExecutionRecord[] {
  let filtered = [...executionHistory];
  
  if (filter?.toolName) {
    filtered = filtered.filter(r => r.toolName === filter.toolName);
  }
  
  if (filter?.success !== undefined) {
    filtered = filtered.filter(r => r.success === filter.success);
  }
  
  if (filter?.since) {
    filtered = filtered.filter(r => r.timestamp >= filter.since!);
  }
  
  return filtered;
}

/**
 * [HARDENING] Get execution summary statistics
 */
export function getExecutionSummary(): {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  averageExecutionTimeMs: number;
  uniqueTools: number;
} {
  let totalExecutions = 0;
  let successfulExecutions = 0;
  let failedExecutions = 0;
  let totalExecutionTime = 0;
  
  for (const metrics of toolMetrics.values()) {
    totalExecutions += metrics.totalExecutions;
    successfulExecutions += metrics.successfulExecutions;
    failedExecutions += metrics.failedExecutions;
    totalExecutionTime += metrics.averageExecutionTimeMs * metrics.totalExecutions;
  }
  
  const averageExecutionTimeMs = totalExecutions > 0 
    ? totalExecutionTime / totalExecutions 
    : 0;
  
  return {
    totalExecutions,
    successfulExecutions,
    failedExecutions,
    successRate: totalExecutions > 0 ? (successfulExecutions / totalExecutions) * 100 : 0,
    averageExecutionTimeMs,
    uniqueTools: toolMetrics.size,
  };
}

/**
 * [HARDENING] Reset metrics (for testing)
 */
export function resetToolMetrics(): void {
  toolMetrics.clear();
  executionHistory.length = 0;
}

/**
 * [HARDENING] Check if tool is healthy (not failing consecutively)
 */
export function isToolHealthy(toolName: string, maxConsecutiveFailures = 3): boolean {
  const metrics = toolMetrics.get(toolName);
  if (!metrics) return true; // No history means healthy
  return metrics.consecutiveFailures < maxConsecutiveFailures;
}
