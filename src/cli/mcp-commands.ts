/**
 * MCP Commands - Full Model Context Protocol CLI
 * 
 * Full spec support: stdio, HTTP/SSE transports
 * Tools, Resources, Prompts capabilities
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { 
  getMCPManager, 
  initializeMCPTools,
} from '../mcp/resolver.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(process.env.HOME || '~', '.summon', 'config', 'mcp-servers.yaml');

export function createMCPCommands(): Command {
  const mcp = new Command('mcp')
    .description('Manage MCP (Model Context Protocol) servers');

  // List all configured MCP servers
  mcp
    .command('list')
    .description('List all configured MCP servers')
    .action(async () => {
      await initializeMCPTools();
      const manager = getMCPManager();
      const status = manager.getStatus();
      
      if (status.length === 0) {
        console.log('No MCP servers connected.');
        console.log('Use "summon mcp add" to configure servers.');
        return;
      }

      console.log('MCP Servers:\n');
      for (const s of status) {
        const statusIcon = s.connected ? '🟢' : '🔴';
        const caps = Object.entries(s.capabilities)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(', ');
        console.log(`  ${statusIcon} ${s.server}`);
        console.log(`      Capabilities: ${caps || 'none'}`);
      }
    });

  // Connect to an MCP server
  mcp
    .command('connect <name>')
    .description('Connect to an MCP server by name')
    .action(async (name: string) => {
      const manager = getMCPManager();
      await manager.loadConfig();
      
      try {
        await manager.connect(name);
        console.log(`✅ Connected to MCP server: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to connect to ${name}:`, error);
        process.exit(1);
      }
    });

  // Disconnect from an MCP server
  mcp
    .command('disconnect <name>')
    .description('Disconnect from an MCP server')
    .action(async (name: string) => {
      const manager = getMCPManager();
      
      try {
        await manager.disconnect(name);
        console.log(`✅ Disconnected from MCP server: ${name}`);
      } catch (error) {
        console.error(`❌ Failed to disconnect from ${name}:`, error);
        process.exit(1);
      }
    });

  // Show available tools
  mcp
    .command('tools')
    .description('Show available tools from MCP servers')
    .action(async () => {
      await initializeMCPTools();
      const manager = getMCPManager();
      
      const tools = await manager.listAllTools();
      
      console.log('MCP Tools:\n');
      for (const tool of tools) {
        console.log(`  • ${tool.name} (${tool.server})`);
        const desc = tool.description.substring(0, 60);
        console.log(`    ${desc}${tool.description.length > 60 ? '...' : ''}`);
      }
      
      console.log(`\nTotal: ${tools.length} tools`);
    });

  // Show available resources
  mcp
    .command('resources')
    .description('Show available resources from MCP servers')
    .action(async () => {
      await initializeMCPTools();
      const manager = getMCPManager();
      
      const resources = await manager.listAllResources();
      
      console.log('MCP Resources:\n');
      for (const r of resources) {
        console.log(`  • ${r.name} (${r.server})`);
        console.log(`    URI: ${r.uri}`);
      }
    });

  // Show available prompts
  mcp
    .command('prompts')
    .description('Show available prompts from MCP servers')
    .action(async () => {
      await initializeMCPTools();
      const manager = getMCPManager();
      
      const prompts = await manager.listAllPrompts();
      
      console.log('MCP Prompts:\n');
      for (const p of prompts) {
        console.log(`  • ${p.name} (${p.server})`);
      }
    });

  // Add a new MCP server
  mcp
    .command('add')
    .description('Add a new MCP server configuration')
    .requiredOption('-n, --name <name>', 'Server name')
    .option('-c, --command <cmd>', 'Command for stdio transport')
    .option('-u, --url <url>', 'URL for HTTP/SSE transport')
    .option('-a, --args <args>', 'Arguments (comma-separated)')
    .option('-e, --env <env>', 'Environment vars (KEY=value,KEY2=value2)')
    .action((options) => {
      if (!options.command && !options.url) {
        console.error('Error: Either --command (stdio) or --url (HTTP/SSE) is required');
        process.exit(1);
      }

      let config: { mcpServers: Array<any> } = { mcpServers: [] };

      try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
          const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
          config = yaml.load(content) as { mcpServers: Array<any> };
        }
      } catch {
        // Start fresh
      }

      const serverConfig: any = {
        name: options.name,
        enabled: true,
      };

      if (options.url) {
        serverConfig.url = options.url;
      } else {
        serverConfig.command = options.command;
        serverConfig.args = options.args ? options.args.split(',') : [];
      }

      if (options.env) {
        serverConfig.env = {};
        options.env.split(',').forEach((pair: string) => {
          const [key, value] = pair.split('=');
          if (key && value) {
            serverConfig.env[key] = value;
          }
        });
      }

      // Remove existing server with same name
      config.mcpServers = config.mcpServers.filter((s: any) => s.name !== options.name);
      config.mcpServers.push(serverConfig);

      // Ensure directory exists
      const dir = path.dirname(USER_CONFIG_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(config));
      console.log(`✅ Added MCP server: ${options.name}`);
      if (options.url) {
        console.log(`   Transport: HTTP/SSE (${options.url})`);
      } else {
        console.log(`   Transport: stdio (${options.command})`);
      }
      console.log(`   Config: ${USER_CONFIG_PATH}`);
    });

  // Remove an MCP server
  mcp
    .command('remove <name>')
    .description('Remove an MCP server configuration')
    .action((name: string) => {
      let config: { mcpServers: Array<any> } = { mcpServers: [] };

      try {
        if (fs.existsSync(USER_CONFIG_PATH)) {
          const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
          config = yaml.load(content) as { mcpServers: Array<any> };
        }
      } catch {
        console.log('No MCP config found');
        return;
      }

      const before = config.mcpServers.length;
      config.mcpServers = config.mcpServers.filter((s: any) => s.name !== name);

      if (before === config.mcpServers.length) {
        console.log(`MCP server ${name} not found`);
        return;
      }

      fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(config));
      console.log(`✅ Removed MCP server: ${name}`);
    });

  // Enable/disable servers
  mcp
    .command('enable <name>')
    .description('Enable an MCP server')
    .action((name: string) => toggleServer(name, true));

  mcp
    .command('disable <name>')
    .description('Disable an MCP server')
    .action((name: string) => toggleServer(name, false));

  return mcp;
}

function toggleServer(name: string, enabled: boolean): void {
  let config: { mcpServers: Array<any> } = { mcpServers: [] };

  try {
    if (fs.existsSync(USER_CONFIG_PATH)) {
      const content = fs.readFileSync(USER_CONFIG_PATH, 'utf-8');
      config = yaml.load(content) as { mcpServers: Array<any> };
    }
  } catch {
    console.log('No MCP config found');
    return;
  }

  const server = config.mcpServers.find((s: any) => s.name === name);
  if (server) {
    server.enabled = enabled;
    fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(config));
    console.log(`✅ ${enabled ? 'Enabled' : 'Disabled'} MCP server: ${name}`);
  } else {
    console.log(`MCP server ${name} not found`);
  }
}
