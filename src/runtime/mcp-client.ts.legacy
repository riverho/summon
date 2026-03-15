import { ChildProcess, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'builtin', 'mcp', 'mcp-servers.yaml');

// ============================================================================
// Types
// ============================================================================

export interface MCPServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
  description?: string;
  tools?: string[];
}

export interface MCPServerStatus {
  name: string;
  enabled: boolean;
  running: boolean;
  pid?: number;
  tools: string[];
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ============================================================================
// MCP Client
// ============================================================================

export class MCPClient {
  private serverConfig: MCPServerConfig;
  private process: ChildProcess | null = null;
  private connected: boolean = false;
  private tools: Map<string, MCPTool> = new Map();

  constructor(serverConfig: MCPServerConfig) {
    this.serverConfig = serverConfig;
  }

  get name(): string {
    return this.serverConfig.name;
  }

  isConnected(): boolean {
    return this.connected && this.process !== null && !this.process.killed;
  }

  async connect(): Promise<void> {
    if (this.isConnected()) {
      return;
    }

    const { command, args, env = {} } = this.serverConfig;

    // Prepare environment
    const processEnv = { ...process.env, ...env };
    // Expand environment variable placeholders
    for (const [key, value] of Object.entries(processEnv)) {
      if (typeof value === 'string') {
        processEnv[key] = value.replace(/\$\{(\w+)\}/g, (_, envVar) => process.env[envVar] || '');
      }
    }

    // Spawn the MCP server process
    this.process = spawn(command, args, {
      env: processEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data) => {
      console.log(`[MCP ${this.name}] ${data.toString().trim()}`);
    });

    this.process.stderr?.on('data', (data) => {
      console.error(`[MCP ${this.name}] ${data.toString().trim()}`);
    });

    this.process.on('error', (err) => {
      console.error(`[MCP ${this.name}] Error: ${err.message}`);
      this.connected = false;
    });

    this.process.on('exit', (code) => {
      console.log(`[MCP ${this.name}] Exited with code ${code}`);
      this.connected = false;
      this.process = null;
    });

    // Wait for connection (simplified - in real impl would use JSON-RPC handshake)
    await new Promise(resolve => setTimeout(resolve, 1000));
    this.connected = true;

    // Discover tools (simplified - real impl would call list_tools)
    this.tools.set(`${this.name}_list`, {
      name: `${this.name}_list`,
      description: `List available tools from ${this.name}`,
    });

    console.log(`[MCP ${this.name}] Connected successfully`);
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.connected = false;
    this.tools.clear();
    console.log(`[MCP ${this.name}] Disconnected`);
  }

  async listTools(): Promise<MCPTool[]> {
    return Array.from(this.tools.values());
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.isConnected()) {
      throw new Error(`MCP server ${this.name} is not connected`);
    }

    console.log(`[MCP ${this.name}] Calling tool: ${name}`, args);

    // Simplified - real implementation would use JSON-RPC
    return { success: true, tool: name, args };
  }

  getPID(): number | undefined {
    return this.process?.pid;
  }
}

// ============================================================================
// MCP Registry
// ============================================================================

export class MCPRegistry {
  private clients: Map<string, MCPClient> = new Map();
  private configPath: string;

  constructor(configPath: string = CONFIG_PATH) {
    this.configPath = configPath;
  }

  loadConfig(): MCPServerConfig[] {
    try {
      const content = fs.readFileSync(this.configPath, 'utf-8');
      const config = yaml.load(content) as { mcpServers: MCPServerConfig[] };
      return config?.mcpServers || [];
    } catch (err) {
      console.warn(`MCP config error: ${err}`);
      return [];
    }
  }

  saveConfig(servers: MCPServerConfig[]): void {
    const content = yaml.dump({ mcpServers: servers });
    fs.writeFileSync(this.configPath, content);
  }

  async startAll(): Promise<void> {
    const servers = this.loadConfig();
    for (const config of servers) {
      if (config.enabled) {
        await this.start(config.name);
      }
    }
  }

  async stopAll(): Promise<void> {
    for (const client of this.clients.values()) {
      await client.disconnect();
    }
    this.clients.clear();
  }

  async start(name: string): Promise<boolean> {
    const servers = this.loadConfig();
    const config = servers.find(s => s.name === name);
    if (!config) {
      console.error(`MCP server ${name} not found in config`);
      return false;
    }

    if (!config.enabled) {
      console.warn(`MCP server ${name} is disabled. Enable it first.`);
      return false;
    }

    if (this.clients.has(name)) {
      const existing = this.clients.get(name)!;
      if (existing.isConnected()) {
        console.log(`MCP server ${name} is already running`);
        return true;
      }
    }

    const client = new MCPClient(config);
    try {
      await client.connect();
      this.clients.set(name, client);
      return true;
    } catch (err) {
      console.error(`Failed to start MCP server ${name}:`, err);
      return false;
    }
  }

  async stop(name: string): Promise<boolean> {
    const client = this.clients.get(name);
    if (!client) {
      console.error(`MCP server ${name} is not running`);
      return false;
    }

    await client.disconnect();
    this.clients.delete(name);
    return true;
  }

  async restart(name: string): Promise<boolean> {
    await this.stop(name);
    return await this.start(name);
  }

  listStatus(): MCPServerStatus[] {
    const servers = this.loadConfig();
    return servers.map(config => {
      return {
        name: config.name,
        enabled: config.enabled,
        running: false,
        pid: undefined,
        tools: [],
      };
    });
  }

  getClient(name: string): MCPClient | undefined {
    return this.clients.get(name);
  }

  getAllClients(): Map<string, MCPClient> {
    return this.clients;
  }
}

// Export singleton instance
export const mcpRegistry = new MCPRegistry();
