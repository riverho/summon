/**
 * CF Tool Resolver
 * 
 * Resolves CF-hosted tools from R2 Registry and executes via HTTP.
 * 
 * Flow:
 * 1. Parse tool reference: owner@tool-name@version
 * 2. Fetch manifest from R2: tools/{owner}/{name}/{version}/tool.yaml
 * 3. Cache locally: ~/.summon/cache/tools/{owner}@{name}@{version}/
 * 4. Execute: POST https://tools.summon-ai.com/{name}/execute
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

// ============================================================================
// Types
// ============================================================================

export interface CFToolManifest {
  name: string;
  version: string;
  owner: string;
  description: string;
  runtime: {
    type: 'cf-worker';
    network: {
      allowlist: string[];
    };
  };
  actions: Record<string, {
    description: string;
    parameters: unknown; // JSON schema
    returns: unknown; // JSON schema
  }>;
  auth: {
    access: {
      type: 'jwt';
      audience: string;
      issuer: string;
    };
  };
  billing: {
    base_cost: number;
    quotas: {
      free_tier: number;
      builder_tier: number;
      mastermind_tier: number;
    };
  };
}

export interface CFToolReference {
  owner: string;
  name: string;
  version?: string; // defaults to 'latest'
}

// ============================================================================
// Paths
// ============================================================================

const SUMMON_DIR = join(homedir(), '.summon');
const TOOLS_CACHE_DIR = join(SUMMON_DIR, 'cache', 'tools');
const R2_REGISTRY_URL = 'https://r2.summon-ai.com/tools';
const CF_TOOLS_BASE_URL = 'https://tools.summon-ai.com';

// ============================================================================
// Parse Tool Reference
// ============================================================================

export function parseCFToolRef(ref: string): CFToolReference {
  // Formats:
  // owner@tool-name
  // owner@tool-name@1.0.0
  // @owner/tool-name (npm-style)
  
  let cleanRef = ref;
  
  // Handle @owner/name format
  if (cleanRef.startsWith('@')) {
    cleanRef = cleanRef.slice(1).replace('/', '@');
  }
  
  const parts = cleanRef.split('@');
  
  if (parts.length === 2) {
    return { owner: parts[0], name: parts[1], version: 'latest' };
  }
  
  if (parts.length === 3) {
    return { owner: parts[0], name: parts[1], version: parts[2] };
  }
  
  throw new Error(`Invalid tool reference: ${ref}. Expected: owner@tool-name[@version]`);
}

// ============================================================================
// Fetch Manifest from R2
// ============================================================================

export async function fetchToolManifest(
  ref: CFToolReference
): Promise<{ manifest: CFToolManifest; yaml: string }> {
  const version = ref.version || 'latest';
  const url = `${R2_REGISTRY_URL}/${ref.owner}/${ref.name}/${version}/tool.yaml`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Tool not found: ${ref.owner}@${ref.name}@${version}`);
    }
    throw new Error(`Failed to fetch tool manifest: ${response.status} ${response.statusText}`);
  }
  
  const yaml = await response.text();
  const manifest = parseYaml(yaml) as CFToolManifest;
  
  // Validate required fields
  if (!manifest.name || !manifest.version || !manifest.runtime) {
    throw new Error(`Invalid tool manifest: missing required fields`);
  }
  
  return { manifest, yaml };
}

// ============================================================================
// Cache Management
// ============================================================================

export function getToolCachePath(ref: CFToolReference): string {
  const version = ref.version || 'latest';
  return join(TOOLS_CACHE_DIR, `${ref.owner}@${ref.name}@${version}`);
}

export function isToolCached(ref: CFToolReference): boolean {
  const cachePath = getToolCachePath(ref);
  return existsSync(join(cachePath, 'tool.yaml'));
}

export function saveToolToCache(
  ref: CFToolReference,
  manifest: CFToolManifest,
  yaml: string
): void {
  const cachePath = getToolCachePath(ref);
  
  if (!existsSync(cachePath)) {
    mkdirSync(cachePath, { recursive: true });
  }
  
  writeFileSync(join(cachePath, 'tool.yaml'), yaml, 'utf-8');
  writeFileSync(join(cachePath, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');
}

export function loadToolFromCache(ref: CFToolReference): CFToolManifest {
  const cachePath = getToolCachePath(ref);
  const manifestPath = join(cachePath, 'manifest.json');
  
  if (!existsSync(manifestPath)) {
    throw new Error(`Tool not in cache: ${ref.owner}@${ref.name}@${ref.version || 'latest'}`);
  }
  
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as CFToolManifest;
}

// ============================================================================
// Resolve Tool (Fetch or Cache)
// ============================================================================

export async function resolveCFTool(
  ref: string | CFToolReference,
  options: { skipCache?: boolean } = {}
): Promise<CFToolManifest> {
  const parsedRef = typeof ref === 'string' ? parseCFToolRef(ref) : ref;
  
  // Check cache first
  if (!options.skipCache && isToolCached(parsedRef)) {
    try {
      return loadToolFromCache(parsedRef);
    } catch {
      // Cache miss or corrupt, fetch fresh
    }
  }
  
  // Fetch from R2
  const { manifest, yaml } = await fetchToolManifest(parsedRef);
  
  // Save to cache
  saveToolToCache(parsedRef, manifest, yaml);
  
  return manifest;
}

// ============================================================================
// Execute Tool Action
// ============================================================================

export interface ToolExecuteOptions {
  action: string;
  parameters: Record<string, unknown>;
  jwtToken: string; // For auth
  requestId?: string;
}

export interface ToolExecuteResult {
  success: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
  metadata: {
    durationMs: number;
    requestId: string;
  };
}

export async function executeCFTool(
  toolName: string,
  options: ToolExecuteOptions
): Promise<ToolExecuteResult> {
  const url = `${CF_TOOLS_BASE_URL}/${toolName}/execute`;
  const requestId = options.requestId || crypto.randomUUID();
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${options.jwtToken}`,
    },
    body: JSON.stringify({
      action: options.action,
      parameters: options.parameters,
      requestId,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    return {
      success: false,
      error: {
        code: error.error?.code || 'HTTP_ERROR',
        message: error.error?.message || `HTTP ${response.status}`,
      },
      metadata: {
        durationMs: 0,
        requestId,
      },
    };
  }
  
  return await response.json() as ToolExecuteResult;
}

// ============================================================================
// Convert Manifest to LangChain Tool
// ============================================================================

export function manifestToLangChainTool(
  manifest: CFToolManifest,
  jwtToken: string
): DynamicStructuredTool {
  // Build Zod schema from manifest actions
  // For simplicity, we'll create a unified tool that dispatches to actions
  
  const actionNames = Object.keys(manifest.actions);
  
  return new DynamicStructuredTool({
    name: manifest.name,
    description: `${manifest.description}\n\nAvailable actions: ${actionNames.join(', ')}`,
    schema: z.object({
      action: z.enum(actionNames as [string, ...string[]]).describe('Action to execute'),
      parameters: z.record(z.string(), z.unknown()).describe('Action parameters'),
    }),
    func: async ({ action, parameters }) => {
      const result = await executeCFTool(manifest.name, {
        action,
        parameters,
        jwtToken,
      });
      
      if (!result.success) {
        throw new Error(result.error?.message || 'Tool execution failed');
      }
      
      return JSON.stringify(result.data);
    },
  });
}

// ============================================================================
// Resolve Multiple Tools
// ============================================================================

export async function resolveCFTools(
  refs: string[],
  jwtToken: string
): Promise<DynamicStructuredTool[]> {
  const tools: DynamicStructuredTool[] = [];
  
  for (const ref of refs) {
    const manifest = await resolveCFTool(ref);
    tools.push(manifestToLangChainTool(manifest, jwtToken));
  }
  
  return tools;
}
