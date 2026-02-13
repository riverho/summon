import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { pathToFileURL } from 'url';
import { globalToolRegistry, RegisteredTool } from './tools.js';

// SUMMON_HOME: Installation directory (for portable use from any folder)
const SUMMON_HOME = process.env.SUMMON_HOME || join(homedir(), '.summon_mem');
const COMPONENTS_DIR = 'components';
const TOOLS_DIR = 'tools';

/**
 * Tool definition exported by external tool files
 */
export interface ExternalToolDefinition {
  /** Tool name (must be unique) */
  name: string;
  /** The actual tool instance (DynamicStructuredTool) */
  tool: unknown; // DynamicStructuredTool - will be cast at runtime
  /** Rich description for system prompt */
  description: string;
}

/**
 * Get the tools directory path
 */
function getToolsDir(): string {
  return join(SUMMON_HOME, COMPONENTS_DIR, TOOLS_DIR);
}

/**
 * Find all TypeScript/JavaScript files in the tools directory
 */
function findToolFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter(f => 
      f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.mjs')
    ).map(f => join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Load a single tool file
 */
async function loadToolFile(filepath: string): Promise<RegisteredTool | null> {
  try {
    // Convert path to file URL for ESM imports
    const fileUrl = pathToFileURL(filepath).href;
    const module = await import(fileUrl);
    
    // Support both default export and named export
    const toolDef: ExternalToolDefinition = module.default || module.tool;
    
    if (!toolDef) {
      console.error(`Tool file ${filepath} has no default or 'tool' export`);
      return null;
    }
    
    if (!toolDef.name || !toolDef.tool) {
      console.error(`Tool file ${filepath} missing required fields (name, tool)`);
      return null;
    }
    
    return {
      name: toolDef.name,
      tool: toolDef.tool as RegisteredTool['tool'],
      description: toolDef.description || `Tool: ${toolDef.name}`,
    };
  } catch (error) {
    console.error(`Failed to load tool from ${filepath}:`, error);
    return null;
  }
}

/**
 * Load all external tools from ~/.summon_mem/components/tools/
 * Also checks local .summon_mem/components/tools/
 */
export async function loadExternalTools(): Promise<RegisteredTool[]> {
  const loadedTools: RegisteredTool[] = [];
  
  // Load from user global ~/.summon_mem/components/tools/
  const userToolsDir = getToolsDir();
  for (const file of findToolFiles(userToolsDir)) {
    const tool = await loadToolFile(file);
    if (tool) {
      loadedTools.push(tool);
    }
  }
  
  // Load from local .summon_mem/components/tools/
  const localToolsDir = join(process.cwd(), '.summon_mem', COMPONENTS_DIR, TOOLS_DIR);
  for (const file of findToolFiles(localToolsDir)) {
    const tool = await loadToolFile(file);
    if (tool) {
      loadedTools.push(tool);
    }
  }
  
  return loadedTools;
}

/**
 * Register all external tools with the global registry
 * @param options.override - If true, external tools override existing tools
 */
export async function registerExternalTools(options: { override?: boolean } = {}): Promise<void> {
  const tools = await loadExternalTools();
  
  for (const tool of tools) {
    if (globalToolRegistry.has(tool.name)) {
      if (options.override) {
        console.log(`External tool '${tool.name}' overriding existing tool`);
        globalToolRegistry.register(tool);
      } else {
        console.log(`External tool '${tool.name}' skipped - already registered (use override: true to replace)`);
      }
      continue;
    }
    
    globalToolRegistry.register(tool);
  }
}

/**
 * List available external tool files (without loading them)
 */
export function listExternalToolFiles(): string[] {
  const files: string[] = [];
  
  const userToolsDir = getToolsDir();
  if (existsSync(userToolsDir)) {
    files.push(...findToolFiles(userToolsDir).map(f => `user:${f}`));
  }
  
  const localToolsDir = join(process.cwd(), '.summon_mem', COMPONENTS_DIR, TOOLS_DIR);
  if (existsSync(localToolsDir)) {
    files.push(...findToolFiles(localToolsDir).map(f => `local:${f}`));
  }
  
  return files;
}
