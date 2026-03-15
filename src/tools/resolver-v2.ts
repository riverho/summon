/**
 * Tool Resolver v2.0 - Three Layer Architecture
 * 
 * Resolves tools from:
 * 1. Built-in (Layer 1): Ships with summon
 * 2. CF-Hosted (Layer 2): Fetched from R2, runs on CF Workers
 * 3. External (Layer 3): MCP, user-managed
 * 
 * Usage:
 *   const resolver = new ToolResolver();
 *   await resolver.initialize();
 *   const tools = await resolver.resolveFromRitual(ritual);
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { DynamicStructuredTool, StructuredToolInterface } from '@langchain/core/tools';
import { globalToolRegistry, RegisteredTool } from '../runtime/tools.js';
import { loadExternalTools } from '../runtime/tool-loader.js';
import { getMCPToolResolver, initializeMCPTools } from '../mcp/resolver.js';

// ============================================================================
// Types
// ============================================================================

export type ToolLayer = 'builtin' | 'cf_hosted' | 'external';

export interface ResolvedTool {
  name: string;
  tool: DynamicStructuredTool | StructuredToolInterface;
  layer: ToolLayer;
  source: string;  // Path or URL
  version: string;
  manifest?: ToolManifest;
}

export interface ToolManifest {
  name: string;
  version: string;
  layer: ToolLayer;
  description: string;
  parameters: z.ZodTypeAny;
  returns?: unknown;
  endpoint?: string;  // For CF-hosted
  actions?: string[];  // Available actions
}

export interface RitualToolDeclaration {
  name: string;
  version?: string;
  alias?: string;
  optional?: boolean;
}

export interface RitualManifest {
  builtin_tools?: RitualToolDeclaration[];
  cf_tools?: RitualToolDeclaration[];
  external_tools?: RitualToolDeclaration[];
}

// ============================================================================
// Tool Resolver
// ============================================================================

export class ToolResolver {
  private builtinCatalog: Map<string, any> = new Map();
  private cfCatalog: Map<string, any> = new Map();
  private cacheDir: string;
  private jwtToken?: string;
  private mcpResolver?: any;

  constructor(options: { jwtToken?: string } = {}) {
    this.cacheDir = join(homedir(), '.summon', 'cache', 'tools');
    this.jwtToken = options.jwtToken;
  }

  /**
   * Initialize: Load catalogs and MCP
   */
  async initialize(): Promise<void> {
    await this.loadBuiltinCatalog();
    await this.loadCFCatalog();
    await loadExternalTools();
    
    // Initialize MCP resolver for Layer 3
    this.mcpResolver = getMCPToolResolver();
    await this.mcpResolver.initialize();
  }

  /**
   * Load built-in tool catalog
   */
  private async loadBuiltinCatalog(): Promise<void> {
    const catalogPath = join(__dirname, 'catalog', 'builtin.yaml');
    if (!existsSync(catalogPath)) {
      console.warn('Built-in catalog not found:', catalogPath);
      return;
    }

    const yaml = readFileSync(catalogPath, 'utf-8');
    const catalog = parseYaml(yaml);
    
    for (const [name, def] of Object.entries(catalog.tools || {})) {
      this.builtinCatalog.set(name, def);
    }
  }

  /**
   * Load CF-hosted tool catalog
   */
  private async loadCFCatalog(): Promise<void> {
    const catalogPath = join(__dirname, 'catalog', 'cf-hosted.yaml');
    if (!existsSync(catalogPath)) {
      console.warn('CF catalog not found:', catalogPath);
      return;
    }

    const yaml = readFileSync(catalogPath, 'utf-8');
    const catalog = parseYaml(yaml);
    
    for (const [name, def] of Object.entries(catalog.tools || {})) {
      this.cfCatalog.set(name, def);
    }
  }

  /**
   * Main entry: Resolve all tools from ritual manifest
   */
  async resolveFromRitual(manifest: RitualManifest): Promise<ResolvedTool[]> {
    const tools: ResolvedTool[] = [];
    const errors: string[] = [];

    // Layer 1: Built-in
    if (manifest.builtin_tools) {
      for (const decl of manifest.builtin_tools) {
        try {
          const tool = await this.resolveBuiltinTool(decl);
          tools.push(tool);
        } catch (error) {
          errors.push(`Built-in ${decl.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Layer 2: CF-hosted
    if (manifest.cf_tools) {
      for (const decl of manifest.cf_tools) {
        try {
          const tool = await this.resolveCFTool(decl);
          tools.push(tool);
        } catch (error) {
          if (decl.optional) {
            console.warn(`Optional CF tool ${decl.name} failed:`, error);
          } else {
            errors.push(`CF-hosted ${decl.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    // Layer 3: External (MCP)
    if (manifest.external_tools) {
      for (const decl of manifest.external_tools) {
        try {
          const tool = await this.resolveExternalTool(decl);
          tools.push(tool);
        } catch (error) {
          if (decl.optional) {
            console.warn(`Optional external tool ${decl.name} failed:`, error);
          } else {
            errors.push(`External ${decl.name}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    if (errors.length > 0) {
      throw new ToolResolutionError(
        `Failed to resolve ${errors.length} tool(s):\n${errors.join('\n')}`
      );
    }

    return tools;
  }

  /**
   * Resolve built-in tool
   */
  private async resolveBuiltinTool(decl: RitualToolDeclaration): Promise<ResolvedTool> {
    const def = this.builtinCatalog.get(decl.name);
    if (!def) {
      throw new Error(`Built-in tool '${decl.name}' not found in catalog`);
    }

    // Check if already registered
    const registered = globalToolRegistry.get(decl.name);
    if (!registered) {
      throw new Error(`Built-in tool '${decl.name}' not registered`);
    }

    return {
      name: decl.alias || decl.name,
      tool: registered.tool,
      layer: 'builtin',
      source: `builtin:${decl.name}`,
      version: def.version || '1.0.0',
      manifest: {
        name: decl.name,
        version: def.version,
        layer: 'builtin',
        description: def.description,
        parameters: def.parameters,
      },
    };
  }

  /**
   * Resolve CF-hosted tool
   */
  private async resolveCFTool(decl: RitualToolDeclaration): Promise<ResolvedTool> {
    const catalogDef = this.cfCatalog.get(decl.name);
    if (!catalogDef) {
      throw new Error(`CF tool '${decl.name}' not found in catalog`);
    }

    // Resolve version (semver range)
    const version = this.resolveVersion(decl.version || '^1.0.0', catalogDef.versions);
    
    // Check local cache
    const cacheKey = `${catalogDef.owner}@${decl.name}@${version}`;
    const cachePath = join(this.cacheDir, cacheKey);
    
    let manifest: ToolManifest;
    
    if (existsSync(join(cachePath, 'tool.yaml'))) {
      // Use cached
      const yaml = readFileSync(join(cachePath, 'tool.yaml'), 'utf-8');
      manifest = parseYaml(yaml);
    } else {
      // Fetch from R2
      const manifestUrl = catalogDef.manifest_url.replace('{version}', version);
      const response = await fetch(manifestUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to fetch tool manifest: ${response.status}`);
      }
      
      const yaml = await response.text();
      manifest = parseYaml(yaml);
      
      // Cache locally
      this.cacheToolManifest(cacheKey, yaml, manifest);
    }

    // Create wrapper that calls CF Worker
    const wrapper = this.createCFWrapper(decl.name, catalogDef, version);

    return {
      name: decl.alias || decl.name,
      tool: wrapper,
      layer: 'cf_hosted',
      source: `cf:${catalogDef.endpoint}`,
      version,
      manifest,
    };
  }

  /**
   * Create CF Worker wrapper as LangChain tool
   */
  private createCFWrapper(
    name: string,
    catalogDef: any,
    version: string
  ): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: name,
      description: `${catalogDef.description}\n\nEndpoint: ${catalogDef.endpoint}`,
      schema: z.object({
        action: z.enum(catalogDef.actions.map((a: any) => a.name)),
        parameters: z.any(),
      }),
      func: async ({ action, parameters }) => {
        if (!this.jwtToken) {
          throw new Error('JWT token required for CF tool access');
        }

        const response = await fetch(`${catalogDef.endpoint}/execute`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.jwtToken}`,
          },
          body: JSON.stringify({
            action,
            parameters,
            requestId: crypto.randomUUID(),
          }),
        });

        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error?.message || `HTTP ${response.status}`);
        }

        const result = await response.json();
        return JSON.stringify(result.data);
      },
    });
  }

  /**
   * Resolve external tool (MCP)
   */
  private async resolveExternalTool(decl: RitualToolDeclaration): Promise<ResolvedTool> {
    // Try MCP resolver first (Layer 3 full spec)
    if (this.mcpResolver) {
      const mcpTool = await this.mcpResolver.resolveTool(decl.name);
      if (mcpTool) {
        return {
          name: decl.alias || mcpTool.name,
          tool: mcpTool.tool,
          layer: 'external',
          source: mcpTool.source,
          version: mcpTool.version,
        };
      }
    }
    
    // Fallback to legacy external tool registry
    const registered = globalToolRegistry.get(decl.name);
    if (!registered) {
      throw new Error(`External tool '${decl.name}' not available. Check MCP configuration.`);
    }

    return {
      name: decl.alias || decl.name,
      tool: registered.tool,
      layer: 'external',
      source: `external:${decl.name}`,
      version: 'mcp',
    };
  }

  /**
   * Resolve semver version from available versions
   */
  private resolveVersion(range: string, versions: any[]): string {
    // Simplified: just use current_version for now
    // Full semver resolution can be added later
    if (range === '*' || range === 'latest') {
      return versions.find((v: any) => v.status === 'stable')?.version || versions[0]?.version;
    }
    
    // Strip ^ prefix for now
    const targetVersion = range.replace('^', '');
    const match = versions.find((v: any) => v.version === targetVersion);
    if (match) {
      return match.version;
    }
    
    throw new Error(`Version ${range} not found. Available: ${versions.map((v: any) => v.version).join(', ')}`);
  }

  /**
   * Cache tool manifest locally
   */
  private cacheToolManifest(key: string, yaml: string, manifest: ToolManifest): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }

    const toolDir = join(this.cacheDir, key);
    if (!existsSync(toolDir)) {
      mkdirSync(toolDir, { recursive: true });
    }

    writeFileSync(join(toolDir, 'tool.yaml'), yaml, 'utf-8');
    writeFileSync(join(toolDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
  }

  /**
   * List available tools
   */
  async listAvailable(): Promise<{ name: string; layer: ToolLayer; description: string }[]> {
    const tools: { name: string; layer: ToolLayer; description: string }[] = [];

    for (const [name, def] of this.builtinCatalog) {
      tools.push({ name, layer: 'builtin', description: def.description });
    }

    for (const [name, def] of this.cfCatalog) {
      tools.push({ name, layer: 'cf_hosted', description: def.description });
    }

    // Add MCP tools
    if (this.mcpResolver) {
      const mcpTools = await this.mcpResolver.getAllTools();
      for (const tool of mcpTools) {
        tools.push({
          name: tool.name,
          layer: 'external',
          description: tool.description,
        });
      }
    }

    return tools;
  }
}

// ============================================================================
// Error
// ============================================================================

export class ToolResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolResolutionError';
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export async function resolveToolsFromRitual(
  manifest: RitualManifest,
  options: { jwtToken?: string } = {}
): Promise<ResolvedTool[]> {
  const resolver = new ToolResolver(options);
  await resolver.initialize();
  return resolver.resolveFromRitual(manifest);
}
