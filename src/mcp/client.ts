/**
 * MCP Client - Full Model Context Protocol Implementation
 * 
 * Implements MCP specification for Layer 3 External Tools:
 * - Server connection management (stdio, HTTP/SSE)
 * - Tool discovery and invocation
 * - Resource access
 * - Prompt handling
 * - Capability negotiation
 * 
 * @see https://modelcontextprotocol.io/specification
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  CallToolResultSchema,
  ListResourcesResultSchema,
  ListResourceTemplatesResultSchema,
  ListPromptsResultSchema,
  GetPromptResultSchema,
  ReadResourceResultSchema,
  ListToolsResultSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';

// ============================================================================
// Types
// ============================================================================

export interface MCPServerConfig {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;  // For HTTP/SSE transport
  enabled: boolean;
  description?: string;
  tools?: string[];
}

export interface MCPConnection {
  client: Client;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  config: MCPServerConfig;
  capabilities: MCPCapabilities;
  connected: boolean;
}

export interface MCPCapabilities {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
  logging: boolean;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  server: string;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  server: string;
}

export interface MCPPrompt {
  name: string;
  description?: string;
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;
  server: string;
}

// ============================================================================
// MCP Client Manager
// ============================================================================

export class MCPClientManager {
  private connections: Map<string, MCPConnection> = new Map();
  private configPath: string;
  private serverConfigs: Map<string, MCPServerConfig> = new Map();

  constructor(configPath?: string) {
    this.configPath = configPath || join(homedir(), '.summon', 'config', 'mcp-servers.yaml');
  }

  /**
   * Load MCP server configurations from YAML
   */
  async loadConfig(): Promise<void> {
    // Check for local project config first
    const localConfig = resolve('./mcp-servers.yaml');
    const globalConfig = this.configPath;
    
    let configFile = existsSync(localConfig) ? localConfig : globalConfig;
    
    if (!existsSync(configFile)) {
      // Use built-in defaults
      configFile = join(homedir(), '.openclaw', 'workspace', 'projects', 'summon', 'src', 'builtin', 'mcp', 'mcp-servers.yaml');
    }

    if (!existsSync(configFile)) {
      console.warn('No MCP server config found');
      return;
    }

    const content = readFileSync(configFile, 'utf-8');
    const config = parseYaml(content);

    if (config.mcpServers) {
      for (const server of config.mcpServers) {
        // Expand environment variables in env values
        const expandedEnv: Record<string, string> = {};
        if (server.env) {
          for (const [key, value] of Object.entries(server.env)) {
            expandedEnv[key] = this.expandEnvVars(value as string);
          }
        }
        
        this.serverConfigs.set(server.name, {
          ...server,
          env: expandedEnv,
        });
      }
    }

    console.log(`Loaded ${this.serverConfigs.size} MCP server configs`);
  }

  /**
   * Expand environment variables in config values
   */
  private expandEnvVars(value: string): string {
    return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
      return process.env[varName] || '';
    });
  }

  /**
   * Connect to all enabled MCP servers
   */
  async connectAll(): Promise<void> {
    for (const [name, config] of this.serverConfigs) {
      if (config.enabled) {
        try {
          await this.connect(name);
        } catch (error) {
          console.error(`Failed to connect to MCP server ${name}:`, error);
        }
      }
    }
  }

  /**
   * Connect to a specific MCP server
   */
  async connect(serverName: string): Promise<MCPConnection> {
    const config = this.serverConfigs.get(serverName);
    if (!config) {
      throw new Error(`MCP server ${serverName} not found in config`);
    }

    // Disconnect if already connected
    if (this.connections.has(serverName)) {
      await this.disconnect(serverName);
    }

    let transport: StdioClientTransport | StreamableHTTPClientTransport;

    if (config.url) {
      // HTTP/SSE transport
      transport = new StreamableHTTPClientTransport(new URL(config.url));
    } else if (config.command) {
      // Stdio transport
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args || [],
        env: { ...process.env, ...config.env } as Record<string, string>,
      });
    } else {
      throw new Error(`MCP server ${serverName} must have either 'command' or 'url'`);
    }

    const client = new Client({
      name: 'summon-mcp-client',
      version: '1.0.0',
    });

    await client.connect(transport);

    // Get server capabilities
    const capabilities: MCPCapabilities = {
      tools: client.getServerCapabilities()?.tools !== undefined,
      resources: client.getServerCapabilities()?.resources !== undefined,
      prompts: client.getServerCapabilities()?.prompts !== undefined,
      logging: client.getServerCapabilities()?.logging !== undefined,
    };

    const connection: MCPConnection = {
      client,
      transport,
      config,
      capabilities,
      connected: true,
    };

    this.connections.set(serverName, connection);
    console.log(`Connected to MCP server: ${serverName}`, capabilities);

    return connection;
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnect(serverName: string): Promise<void> {
    const connection = this.connections.get(serverName);
    if (connection) {
      await connection.client.close();
      this.connections.delete(serverName);
      console.log(`Disconnected from MCP server: ${serverName}`);
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnectAll(): Promise<void> {
    for (const serverName of this.connections.keys()) {
      await this.disconnect(serverName);
    }
  }

  /**
   * List all available tools from all connected MCP servers
   */
  async listAllTools(): Promise<MCPToolDefinition[]> {
    const allTools: MCPToolDefinition[] = [];

    for (const [serverName, connection] of this.connections) {
      if (!connection.capabilities.tools) continue;

      try {
        const tools = await connection.client.request(
          { method: 'tools/list' },
          ListToolsResultSchema
        );

        for (const tool of tools.tools || []) {
          allTools.push({
            name: tool.name,
            description: tool.description || '',
            inputSchema: this.jsonSchemaToZod(tool.inputSchema),
            server: serverName,
          });
        }
      } catch (error) {
        console.error(`Failed to list tools from ${serverName}:`, error);
      }
    }

    return allTools;
  }

  /**
   * List resources from all connected MCP servers
   */
  async listAllResources(): Promise<MCPResource[]> {
    const allResources: MCPResource[] = [];

    for (const [serverName, connection] of this.connections) {
      if (!connection.capabilities.resources) continue;

      try {
        const resources = await connection.client.request(
          { method: 'resources/list' },
          ListResourcesResultSchema
        );

        for (const resource of resources.resources || []) {
          allResources.push({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            server: serverName,
          });
        }
      } catch (error) {
        console.error(`Failed to list resources from ${serverName}:`, error);
      }
    }

    return allResources;
  }

  /**
   * List prompts from all connected MCP servers
   */
  async listAllPrompts(): Promise<MCPPrompt[]> {
    const allPrompts: MCPPrompt[] = [];

    for (const [serverName, connection] of this.connections) {
      if (!connection.capabilities.prompts) continue;

      try {
        const prompts = await connection.client.request(
          { method: 'prompts/list' },
          ListPromptsResultSchema
        );

        for (const prompt of prompts.prompts || []) {
          allPrompts.push({
            name: prompt.name,
            description: prompt.description,
            arguments: prompt.arguments,
            server: serverName,
          });
        }
      } catch (error) {
        console.error(`Failed to list prompts from ${serverName}:`, error);
      }
    }

    return allPrompts;
  }

  /**
   * Call an MCP tool
   */
  async callTool(serverName: string, toolName: string, args: unknown): Promise<CallToolResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    if (!connection.capabilities.tools) {
      throw new Error(`MCP server ${serverName} does not support tools`);
    }

    const result = await connection.client.request(
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      },
      CallToolResultSchema
    );

    return result as CallToolResult;
  }

  /**
   * Read an MCP resource
   */
  async readResource(serverName: string, uri: string): Promise<ReadResourceResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    if (!connection.capabilities.resources) {
      throw new Error(`MCP server ${serverName} does not support resources`);
    }

    const result = await connection.client.request(
      {
        method: 'resources/read',
        params: { uri },
      },
      ReadResourceResultSchema
    );

    return result;
  }

  /**
   * Get an MCP prompt
   */
  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<GetPromptResult> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server ${serverName} not connected`);
    }

    if (!connection.capabilities.prompts) {
      throw new Error(`MCP server ${serverName} does not support prompts`);
    }

    const result = await connection.client.request(
      {
        method: 'prompts/get',
        params: {
          name: promptName,
          arguments: args,
        },
      },
      GetPromptResultSchema
    );

    return result as GetPromptResult;
  }

  /**
   * Convert JSON Schema to Zod schema (simplified)
   */
  private jsonSchemaToZod(schema: any): z.ZodTypeAny {
    if (!schema || typeof schema !== 'object') {
      return z.any();
    }

    if (schema.type === 'object' && schema.properties) {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        shape[key] = this.jsonSchemaToZod(prop);
      }
      return z.object(shape);
    }

    if (schema.type === 'string') return z.string();
    if (schema.type === 'number') return z.number();
    if (schema.type === 'boolean') return z.boolean();
    if (schema.type === 'array') return z.array(this.jsonSchemaToZod(schema.items));

    return z.any();
  }

  /**
   * Create LangChain DynamicStructuredTool from MCP tool
   */
  createLangChainTool(toolDef: MCPToolDefinition): DynamicStructuredTool {
    return new DynamicStructuredTool({
      name: toolDef.name,
      description: `${toolDef.description} (via MCP: ${toolDef.server})`,
      schema: toolDef.inputSchema,
      func: async (args) => {
        const result = await this.callTool(toolDef.server, toolDef.name, args);
        return JSON.stringify(result);
      },
    });
  }

  /**
   * Get connection status
   */
  getStatus(): Array<{ server: string; connected: boolean; capabilities: MCPCapabilities }> {
    return Array.from(this.connections.entries()).map(([server, conn]) => ({
      server,
      connected: conn.connected,
      capabilities: conn.capabilities,
    }));
  }
}

// ============================================================================
// Types for MCP results - Compatible with MCP SDK types
// ============================================================================

export interface CallToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource' | 'audio';
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: {
      uri: string;
      mimeType?: string;
      text?: string;
      blob?: string;
    };
    annotations?: {
      audience?: ('user' | 'assistant')[];
      priority?: number;
      lastModified?: string;
    };
    _meta?: Record<string, unknown>;
  }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

export interface ReadResourceResult {
  contents: Array<{
    uri: string;
    mimeType?: string;
    text?: string;
    blob?: string;
  }>;
}

export interface GetPromptResult {
  description?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: {
      type: 'text' | 'image' | 'resource' | 'audio';
      text?: string;
      data?: string;
      mimeType?: string;
      resource?: {
        uri: string;
        mimeType?: string;
        text?: string;
        blob?: string;
      };
      annotations?: {
        audience?: ('user' | 'assistant')[];
        priority?: number;
        lastModified?: string;
      };
      _meta?: Record<string, unknown>;
    };
  }>;
}

// ============================================================================
// Singleton Export
// ============================================================================

let globalMCPManager: MCPClientManager | null = null;

export function getMCPManager(configPath?: string): MCPClientManager {
  if (!globalMCPManager) {
    globalMCPManager = new MCPClientManager(configPath);
  }
  return globalMCPManager;
}

export async function initializeMCP(): Promise<void> {
  const manager = getMCPManager();
  await manager.loadConfig();
  await manager.connectAll();
}

export async function shutdownMCP(): Promise<void> {
  if (globalMCPManager) {
    await globalMCPManager.disconnectAll();
    globalMCPManager = null;
  }
}
