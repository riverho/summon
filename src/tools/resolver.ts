import { StructuredToolInterface } from '@langchain/core/tools';
import { globalToolRegistry, RegisteredTool } from '../runtime/tools.js';
import { loadExternalTools } from '../runtime/tool-loader.js';

/**
 * Tool implementation interface
 */
export interface ToolImplementation {
  name: string;
  tool: StructuredToolInterface;
  description: string;
  source: 'builtin' | 'external' | 'registry';
}

/**
 * Tool configuration with secret placeholders
 */
export interface ToolConfig {
  name: string;
  enabled: boolean;
  secrets?: Record<string, string>;
  config?: Record<string, unknown>;
}

/**
 * Environment variables for secret injection
 */
export type ToolEnvironment = Record<string, string | undefined>;

/**
 * Error thrown when tool resolution fails
 */
export class ToolResolutionError extends Error {
  constructor(
    message: string,
    public readonly toolName: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ToolResolutionError';
  }
}

/**
 * Error thrown when a tool is not found
 */
export class ToolNotFoundError extends ToolResolutionError {
  constructor(toolName: string) {
    super(`Tool '${toolName}' not found in registry`, toolName);
    this.name = 'ToolNotFoundError';
  }
}

/**
 * Initialize the tool resolver by loading external tools
 */
export async function initializeToolResolver(): Promise<void> {
  await loadExternalTools();
}

/**
 * Resolve a tool name to its implementation
 * @param toolName - The name of the tool to resolve
 * @returns The tool implementation
 * @throws ToolNotFoundError if tool doesn't exist
 */
export function resolveTool(toolName: string): ToolImplementation {
  const registered = globalToolRegistry.get(toolName);
  
  if (!registered) {
    throw new ToolNotFoundError(toolName);
  }

  // Determine source based on internal knowledge
  const builtinTools = ['financial_search', 'web_search', 'file_read', 'file_write', 'failing_tool'];
  const source: ToolImplementation['source'] = builtinTools.includes(toolName) ? 'builtin' : 'external';

  return {
    name: registered.name,
    tool: registered.tool,
    description: registered.description,
    source,
  };
}

/**
 * Resolve multiple tools by name
 * @param toolNames - Array of tool names to resolve
 * @returns Array of tool implementations (missing tools are filtered out)
 */
export function resolveTools(toolNames: string[]): ToolImplementation[] {
  return toolNames
    .map(name => {
      try {
        return resolveTool(name);
      } catch (error) {
        if (error instanceof ToolNotFoundError) {
          return null;
        }
        throw error;
      }
    })
    .filter((tool): tool is ToolImplementation => tool !== null);
}

/**
 * Check if a tool exists in the registry
 * @param toolName - The name of the tool to check
 * @returns true if the tool exists
 */
export function hasTool(toolName: string): boolean {
  return globalToolRegistry.has(toolName);
}

/**
 * Get all available tool names
 * @returns Array of registered tool names
 */
export function getAvailableTools(): string[] {
  return globalToolRegistry.getNames();
}

/**
 * Inject secrets into a tool configuration
 * @param toolConfig - The tool configuration with secret placeholders
 * @param env - Environment variables containing secrets
 * @returns Tool configuration with injected secrets
 * 
 * Secret placeholders use the format: {{ENV_VAR_NAME}}
 * Example: { apiKey: '{{ALPHAVANTAGE_API_KEY}}' }
 *          → { apiKey: 'actual_key_value' } (from env)
 */
export function injectSecrets(
  toolConfig: Record<string, unknown>,
  env: ToolEnvironment
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(toolConfig)) {
    if (typeof value === 'string') {
      result[key] = injectSecretValue(value, env);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = injectSecrets(value as Record<string, unknown>, env);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Inject secrets into a single string value
 * @param value - The string value that may contain placeholders
 * @param env - Environment variables
 * @returns Value with secrets injected
 */
function injectSecretValue(value: string, env: ToolEnvironment): string {
  // Match {{ENV_VAR}} pattern
  const placeholderRegex = /\{\{(\w+)\}\}/g;
  
  return value.replace(placeholderRegex, (match, envVar) => {
    const secretValue = env[envVar];
    if (secretValue === undefined) {
      console.warn(`[ToolResolver] Secret placeholder {{${envVar}}} not found in environment`);
      return match; // Keep placeholder if not found
    }
    return secretValue;
  });
}

/**
 * Load secrets from environment for a specific tool
 * @param toolName - The tool to load secrets for
 * @returns Environment variables filtered for this tool
 */
export function loadToolSecrets(toolName: string): ToolEnvironment {
  const prefix = `${toolName.toUpperCase().replace(/-/g, '_')}_`;
  const secrets: ToolEnvironment = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Include variables with tool-specific prefix
    if (key.startsWith(prefix)) {
      secrets[key] = value;
    }
    // Include common API keys that might be used by this tool
    if (isCommonSecretKey(key) && value) {
      secrets[key] = value;
    }
  }

  return secrets;
}

/**
 * Check if a key is a common secret/API key
 */
function isCommonSecretKey(key: string): boolean {
  const commonPatterns = [
    /_API_KEY$/i,
    /_SECRET$/i,
    /_TOKEN$/i,
    /^ALPHAVANTAGE_/i,
    /^TAVILY_/i,
    /^EXASEARCH_/i,
    /^OPENAI_/i,
    /^ANTHROPIC_/i,
  ];
  
  return commonPatterns.some(pattern => pattern.test(key));
}

/**
 * Resolve tools required by a ritual's skills
 * @param skillRefs - Array of skill references (e.g., ['finance', 'web'])
 * @returns Map of skill to resolved tools
 */
export function resolveSkillTools(skillRefs: string[]): Map<string, ToolImplementation[]> {
  const skillToolMap = new Map<string, ToolImplementation[]>();

  // Define which tools belong to which skills
  const skillToolMapping: Record<string, string[]> = {
    'finance': ['financial_search'],
    'web': ['web_search'],
    'file': ['file_read', 'file_write'],
  };

  for (const skillRef of skillRefs) {
    const toolNames = skillToolMapping[skillRef] || [];
    const tools = resolveTools(toolNames);
    skillToolMap.set(skillRef, tools);
  }

  return skillToolMap;
}

/**
 * Get tool instances for LLM binding
 * @param toolNames - Optional array of tool names (if not provided, returns all)
 * @returns Array of StructuredToolInterface for LangChain
 */
export function getToolInstances(toolNames?: string[]): StructuredToolInterface[] {
  return globalToolRegistry.getToolInstances(toolNames);
}
