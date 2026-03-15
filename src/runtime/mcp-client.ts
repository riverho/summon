/**
 * MCP Client Runtime — Full Model Context Protocol
 * 
 * Re-exports from src/mcp/ for runtime usage.
 * This replaces the legacy basic implementation.
 * 
 * Full spec support:
 * - Transports: stdio, HTTP, SSE
 * - Capabilities: Tools, Resources, Prompts
 * - Protocol: JSON-RPC with capability negotiation
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
} from '../mcp/resolver.js';

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
} from '../mcp/client.js';
