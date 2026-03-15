/**
 * MCP Tool Resolver - Integration with summon ToolResolver v2
 * 
 * Bridges MCP Client Manager with summon runtime:
 * - Auto-discovers MCP tools during ritual loading
 * - Converts MCP tools to LangChain DynamicStructuredTool
 * - Handles Layer 3 external tool resolution
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import {
  MCPClientManager,
  MCPToolDefinition,
  initializeMCP,
  shutdownMCP,
  getMCPManager,
} from './client.js';
import { ToolResolver, ResolvedTool, ToolLayer } from '../tools/resolver-v2.js';

// Re-export from client for convenience
export { MCPClientManager, initializeMCP, shutdownMCP, getMCPManager };
export type { MCPToolDefinition };
export type { MCPServerConfig, MCPConnection, MCPCapabilities, MCPResource, MCPPrompt, CallToolResult, ReadResourceResult, GetPromptResult } from './client.js';

// ============================================================================
// MCP Tool Resolver Extension
// ============================================================================

export class MCPToolResolver {
  private manager: MCPClientManager;
  private toolCache: Map<string, MCPToolDefinition> = new Map();
  private initialized = false;

  constructor() {
    this.manager = getMCPManager();
  }

  /**
   * Initialize MCP connections
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await initializeMCP();
    await this.discoverTools();
    this.initialized = true;
    
    console.log(`MCP Tool Resolver initialized with ${this.toolCache.size} tools`);
  }

  /**
   * Discover all available MCP tools from connected servers
   */
  async discoverTools(): Promise<void> {
    const tools = await this.manager.listAllTools();
    
    for (const tool of tools) {
      // Prefix tool name with server to avoid collisions
      const qualifiedName = `${tool.server}__${tool.name}`;
      this.toolCache.set(qualifiedName, tool);
      
      // Also cache with simple name for convenience
      this.toolCache.set(tool.name, tool);
    }
  }

  /**
   * Resolve an MCP tool by name
   */
  async resolveTool(toolName: string): Promise<ResolvedTool | null> {
    await this.initialize();

    // Try qualified name first (server__tool)
    let toolDef = this.toolCache.get(toolName);
    
    // Try simple name
    if (!toolDef) {
      toolDef = this.toolCache.get(toolName);
    }

    if (!toolDef) {
      return null;
    }

    const langChainTool = this.manager.createLangChainTool(toolDef);

    return {
      name: toolDef.name,
      tool: langChainTool,
      layer: 'external' as ToolLayer,
      source: `mcp:${toolDef.server}`,
      version: '1.0.0',
    };
  }

  /**
   * Resolve multiple MCP tools
   */
  async resolveTools(toolNames: string[]): Promise<ResolvedTool[]> {
    await this.initialize();

    const resolved: ResolvedTool[] = [];
    
    for (const name of toolNames) {
      const tool = await this.resolveTool(name);
      if (tool) {
        resolved.push(tool);
      }
    }

    return resolved;
  }

  /**
   * Get all available MCP tools (for discovery/UI)
   */
  async getAllTools(): Promise<MCPToolDefinition[]> {
    await this.initialize();
    return Array.from(this.toolCache.values());
  }

  /**
   * Check if a tool is available via MCP
   */
  async hasTool(toolName: string): Promise<boolean> {
    await this.initialize();
    return this.toolCache.has(toolName) || this.toolCache.has(toolName);
  }

  /**
   * Get MCP connection status
   */
  getStatus(): ReturnType<MCPClientManager['getStatus']> {
    return this.manager.getStatus();
  }

  /**
   * Shutdown MCP connections
   */
  async shutdown(): Promise<void> {
    await shutdownMCP();
    this.initialized = false;
    this.toolCache.clear();
  }
}

// ============================================================================
// Integration with ToolResolver v2
// ============================================================================

/**
 * Extend ToolResolver with MCP support
 */
export function extendToolResolverWithMCP(toolResolver: ToolResolver): void {
  const mcpResolver = new MCPToolResolver();
  
  // Store reference for later use
  (toolResolver as any)._mcpResolver = mcpResolver;
  
  // Override resolveExternalTools to include MCP
  const originalResolveExternal = (toolResolver as any).resolveExternalTools?.bind(toolResolver);
  
  (toolResolver as any).resolveExternalTools = async function(toolNames: string[]) {
    const resolved: ResolvedTool[] = [];
    const unresolved: string[] = [];

    // First try original external resolution if it exists
    if (originalResolveExternal) {
      const originalResult = await originalResolveExternal(toolNames);
      resolved.push(...originalResult.resolved);
      unresolved.push(...originalResult.unresolved);
    } else {
      unresolved.push(...toolNames);
    }

    // Then try MCP resolution
    await mcpResolver.initialize();
    
    const mcpResolved = await mcpResolver.resolveTools(unresolved);
    resolved.push(...mcpResolved);

    // Remove resolved from unresolved
    const resolvedNames = new Set(mcpResolved.map(r => r.name));
    const stillUnresolved = unresolved.filter(name => !resolvedNames.has(name));

    return {
      resolved,
      unresolved: stillUnresolved,
    };
  };
}

// ============================================================================
// Standalone MCP Tool Provider
// ============================================================================

let globalMCPResolver: MCPToolResolver | null = null;

export function getMCPToolResolver(): MCPToolResolver {
  if (!globalMCPResolver) {
    globalMCPResolver = new MCPToolResolver();
  }
  return globalMCPResolver;
}

export async function initializeMCPTools(): Promise<void> {
  const resolver = getMCPToolResolver();
  await resolver.initialize();
}

export async function shutdownMCPTools(): Promise<void> {
  if (globalMCPResolver) {
    await globalMCPResolver.shutdown();
    globalMCPResolver = null;
  }
}

// ============================================================================
// CLI Commands for MCP Management
// ============================================================================

export async function listMCPServers(): Promise<void> {
  const resolver = getMCPToolResolver();
  await resolver.initialize();
  
  const status = resolver.getStatus();
  
  console.log('\n📡 MCP Servers:\n');
  for (const s of status) {
    const caps = Object.entries(s.capabilities)
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    
    console.log(`  ${s.connected ? '🟢' : '🔴'} ${s.server}`);
    console.log(`     Capabilities: ${caps || 'none'}`);
  }
}

export async function listMCPTools(): Promise<void> {
  const resolver = getMCPToolResolver();
  await resolver.initialize();
  
  const tools = await resolver.getAllTools();
  
  console.log('\n🔧 MCP Tools:\n');
  for (const tool of tools) {
    console.log(`  • ${tool.name} (via ${tool.server})`);
    console.log(`    ${tool.description.substring(0, 60)}${tool.description.length > 60 ? '...' : ''}`);
  }
  
  console.log(`\nTotal: ${tools.length} tools`);
}

export async function testMCPTool(server: string, tool: string, args: string): Promise<void> {
  const manager = getMCPManager();
  
  const result = await manager.callTool(server, tool, JSON.parse(args));
  
  console.log('\n📤 Result:\n');
  console.log(JSON.stringify(result, null, 2));
}
