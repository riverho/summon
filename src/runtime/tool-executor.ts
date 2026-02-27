/**
 * Tool Executor — Execute bound tools with secret injection
 * 
 * Handles tool execution with environment variable injection for API keys
 * and other secrets stored in ~/.summon/.env
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { config } from 'dotenv';

const ENV_FILE = join(homedir(), '.summon', '.env');

export interface ToolExecutionOptions {
  /** Timeout in milliseconds */
  timeout?: number;
  /** Retry count on failure */
  retries?: number;
  /** Whether to inject secrets */
  injectSecrets?: boolean;
}

export interface ToolExecutionResult {
  success: boolean;
  output: string;
  toolName: string;
  executionTimeMs: number;
  error?: string;
}

export interface SecretMapping {
  /** Environment variable name in .env file */
  envVar: string;
  /** Key in the tool's config where the secret should be injected */
  toolKey: string;
}

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
 * Execute a tool with timeout and retry logic
 */
export async function executeTool(
  tool: DynamicStructuredTool,
  args: Record<string, unknown>,
  options: ToolExecutionOptions = {}
): Promise<ToolExecutionResult> {
  const startTime = Date.now();
  const { timeout = 60000, retries = 0, injectSecrets: shouldInject = true } = options;
  
  let lastError: string | undefined;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Load and inject secrets if enabled
      let finalArgs = args;
      if (shouldInject) {
        const secrets = await loadSecrets();
        
        // Auto-detect secret mappings based on arg names
        const secretMappings: SecretMapping[] = [];
        for (const key of Object.keys(args)) {
          if (key.toLowerCase().includes('api_key') || 
              key.toLowerCase().includes('apikey') ||
              key.toLowerCase().includes('token') ||
              key.toLowerCase().includes('secret')) {
            // Map from env var with common prefixes
            const envVars = [
              `${tool.name.toUpperCase()}_${key.toUpperCase()}`,
              key.toUpperCase(),
              `${key.toUpperCase().replace(/_KEY$/, '')}_API_KEY`,
            ];
            
            for (const envVar of envVars) {
              if (secrets[envVar]) {
                secretMappings.push({ envVar, toolKey: key });
                break;
              }
            }
          }
        }
        
        if (secretMappings.length > 0) {
          finalArgs = injectSecrets(args, secretMappings, secrets);
        }
      }
      
      // Execute with timeout
      const result = await Promise.race([
        tool.invoke(finalArgs),
        new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error(`Tool execution timed out after ${timeout}ms`)), timeout)
        ),
      ]);
      
      // Validate output
      const validation = validateToolOutput(result);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      
      return {
        success: true,
        output,
        toolName: tool.name,
        executionTimeMs: Date.now() - startTime,
      };
      
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      
      if (attempt < retries) {
        // Exponential backoff
        const delay = Math.min(1000 * Math.pow(2, attempt), 10000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  return {
    success: false,
    output: '',
    toolName: tool.name,
    executionTimeMs: Date.now() - startTime,
    error: lastError || 'Unknown error',
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
  const results: ToolExecutionResult[] = [];
  
  for (const { tool, args } of toolCalls) {
    const result = await executeTool(tool, args, options);
    results.push(result);
    
    // Stop on first failure if not configured otherwise
    if (!result.success && !options?.retries) {
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
