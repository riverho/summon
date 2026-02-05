import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { mcpRegistry } from '../runtime/mcp-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', 'builtin', 'mcp', 'mcp-servers.yaml');

// ============================================================================
// MCP Commands
// ============================================================================

export function createMCPCommands(): Command {
  const mcp = new Command('mcp')
    .description('Manage MCP (Model Context Protocol) servers');

  // List all configured MCP servers
  mcp
    .command('list')
    .description('List all configured MCP servers')
    .action(() => {
      const status = mcpRegistry.listStatus();
      if (status.length === 0) {
        console.log('No MCP servers configured.');
        console.log('Add servers to:', CONFIG_PATH);
        return;
      }

      console.log('MCP Servers:\n');
      for (const s of status) {
        const statusIcon = s.running ? '🟢' : '🔴';
        const enabledIcon = s.enabled ? '✅' : '❌';
        console.log(`  ${statusIcon} ${enabledIcon} ${s.name}`);
        if (s.running && s.pid) {
          console.log(`      PID: ${s.pid}`);
        }
        if (s.tools.length > 0) {
          console.log(`      Tools: ${s.tools.join(', ')}`);
        }
      }
    });

  // Show status of all MCP servers
  mcp
    .command('status')
    .description('Show detailed status of all MCP servers')
    .action(() => {
      const status = mcpRegistry.listStatus();
      console.log(JSON.stringify(status, null, 2));
    });

  // Start an MCP server
  mcp
    .command('start <name>')
    .description('Start an MCP server by name')
    .action(async (name: string) => {
      console.log(`Starting MCP server: ${name}...`);
      const success = await mcpRegistry.start(name);
      if (success) {
        console.log(`✅ MCP server ${name} started successfully`);
      } else {
        console.log(`❌ Failed to start MCP server ${name}`);
        process.exit(1);
      }
    });

  // Stop an MCP server
  mcp
    .command('stop <name>')
    .description('Stop an MCP server by name')
    .action(async (name: string) => {
      console.log(`Stopping MCP server: ${name}...`);
      const success = await mcpRegistry.stop(name);
      if (success) {
        console.log(`✅ MCP server ${name} stopped`);
      } else {
        console.log(`❌ Failed to stop MCP server ${name}`);
        process.exit(1);
      }
    });

  // Restart an MCP server
  mcp
    .command('restart <name>')
    .description('Restart an MCP server by name')
    .action(async (name: string) => {
      console.log(`Restarting MCP server: ${name}...`);
      const success = await mcpRegistry.restart(name);
      if (success) {
        console.log(`✅ MCP server ${name} restarted`);
      } else {
        console.log(`❌ Failed to restart MCP server ${name}`);
        process.exit(1);
      }
    });

  // Show available tools from MCP servers
  mcp
    .command('tools [name]')
    .description('Show available tools from all or specific MCP server')
    .action(async (name?: string) => {
      if (name) {
        const client = mcpRegistry.getClient(name);
        if (!client) {
          console.log(`MCP server ${name} is not running`);
          return;
        }
        const tools = await client.listTools();
        console.log(`Tools from ${name}:`);
        for (const tool of tools) {
          console.log(`  - ${tool.name}: ${tool.description || 'No description'}`);
        }
      } else {
        const status = mcpRegistry.listStatus();
        for (const s of status) {
          if (s.running) {
            console.log(`\n${s.name}:`);
            const client = mcpRegistry.getClient(s.name);
            if (client) {
              const tools = await client.listTools();
              for (const tool of tools) {
                console.log(`  - ${tool.name}: ${tool.description || 'No description'}`);
              }
            }
          }
        }
      }
    });

  // Connect to an MCP server
  mcp
    .command('connect <name>')
    .description('Connect to an MCP server')
    .action(async (name: string) => {
      const success = await mcpRegistry.start(name);
      if (success) {
        console.log(`✅ Connected to ${name}`);
      } else {
        console.log(`❌ Failed to connect to ${name}`);
        process.exit(1);
      }
    });

  // Disconnect from an MCP server
  mcp
    .command('disconnect <name>')
    .description('Disconnect from an MCP server')
    .action(async (name: string) => {
      const success = await mcpRegistry.stop(name);
      if (success) {
        console.log(`✅ Disconnected from ${name}`);
      } else {
        console.log(`❌ Failed to disconnect from ${name}`);
        process.exit(1);
      }
    });

  // Add a new MCP server configuration
  mcp
    .command('add <name> <command>')
    .description('Add a new MCP server configuration')
    .action((name: string, command: string) => {
      const configPath = CONFIG_PATH;
      let config: { mcpServers: Array<{
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string>;
        enabled: boolean;
      }> };

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = yaml.load(content) as { mcpServers: Array<{
          name: string;
          command: string;
          args: string[];
          env?: Record<string, string>;
          enabled: boolean;
        }> };
      } catch {
        config = { mcpServers: [] };
      }

      // Parse command and args
      const parts = command.split(' ');
      const cmd = parts[0];
      const args = parts.slice(1);

      config.mcpServers.push({
        name,
        command: cmd,
        args,
        enabled: true,
      });

      fs.writeFileSync(configPath, yaml.dump(config));
      console.log(`✅ Added MCP server: ${name}`);
    });

  // Remove an MCP server configuration
  mcp
    .command('remove <name>')
    .description('Remove an MCP server configuration')
    .action((name: string) => {
      const configPath = CONFIG_PATH;
      let config: { mcpServers: Array<{
        name: string;
        command: string;
        args: string[];
        env?: Record<string, string>;
        enabled: boolean;
      }> };

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = yaml.load(content) as { mcpServers: Array<{
          name: string;
          command: string;
          args: string[];
          env?: Record<string, string>;
          enabled: boolean;
        }> };
      } catch {
        console.log('No MCP config found');
        return;
      }

      const before = config.mcpServers.length;
      config.mcpServers = config.mcpServers.filter(s => s.name !== name);
      const after = config.mcpServers.length;

      if (before === after) {
        console.log(`MCP server ${name} not found`);
        return;
      }

      fs.writeFileSync(configPath, yaml.dump(config));
      console.log(`✅ Removed MCP server: ${name}`);
    });

  // Enable an MCP server
  mcp
    .command('enable <name>')
    .description('Enable an MCP server')
    .action((name: string) => {
      const configPath = CONFIG_PATH;
      let config: { mcpServers: Array<{
        name: string;
        enabled: boolean;
      }> };

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = yaml.load(content) as { mcpServers: Array<{
          name: string;
          enabled: boolean;
        }> };
      } catch {
        console.log('No MCP config found');
        return;
      }

      const server = config.mcpServers.find(s => s.name === name);
      if (server) {
        server.enabled = true;
        fs.writeFileSync(configPath, yaml.dump(config));
        console.log(`✅ Enabled MCP server: ${name}`);
      } else {
        console.log(`MCP server ${name} not found`);
      }
    });

  // Disable an MCP server
  mcp
    .command('disable <name>')
    .description('Disable an MCP server')
    .action((name: string) => {
      const configPath = CONFIG_PATH;
      let config: { mcpServers: Array<{
        name: string;
        enabled: boolean;
      }> };

      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        config = yaml.load(content) as { mcpServers: Array<{
          name: string;
          enabled: boolean;
        }> };
      } catch {
        console.log('No MCP config found');
        return;
      }

      const server = config.mcpServers.find(s => s.name === name);
      if (server) {
        server.enabled = false;
        fs.writeFileSync(configPath, yaml.dump(config));
        console.log(`✅ Disabled MCP server: ${name}`);
      } else {
        console.log(`MCP server ${name} not found`);
      }
    });

  return mcp;
}
