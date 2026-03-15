/**
 * MCP Module for Summon
 * 
 * Full Model Context Protocol implementation for Layer 3 External Tools.
 * 
 * @example
 * ```typescript
 * import { initializeMCP, getMCPToolResolver } from 'summon/mcp';
 * 
 * // Initialize MCP connections
 * await initializeMCP();
 * 
 * // Get tool resolver
 * const resolver = getMCPToolResolver();
 * 
 * // Resolve an MCP tool
 * const tool = await resolver.resolveTool('context7_search');
 * ```
 */

export {
  MCPClientManager,
  MCPToolResolver,
  initializeMCP,
  shutdownMCP,
  getMCPManager,
  getMCPToolResolver,
  initializeMCPTools,
  shutdownMCPTools,
  extendToolResolverWithMCP,
  listMCPServers,
  listMCPTools,
  testMCPTool,
} from './resolver.js';

export type {
  MCPServerConfig,
  MCPConnection,
  MCPCapabilities,
  MCPToolDefinition,
  MCPResource,
  MCPPrompt,
  CallToolResult,
  ReadResourceResult,
  GetPromptResult,
} from './client.js';
