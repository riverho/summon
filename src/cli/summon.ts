#!/usr/bin/env bun
/**
 * Summon CLI - Polished Entry Point
 * Zero-friction agent summoning
 */

import { Command } from 'commander';
import { config } from 'dotenv';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { runSetup } from './setup.js';
import { interactiveSetup, checkRitalRequirements } from './setup-helper.js';
import { executeRitualByRef, executeRitualFromYaml, streamExecuteRitual } from '../runtime/index.js';

// Load .env if present
config({ quiet: true });

const SUMMON_DIR = join(homedir(), '.summon');
const CONFIG_PATH = join(SUMMON_DIR, 'config.yaml');

// Check if onboarding is needed
function needsSetup(): boolean {
  if (!existsSync(CONFIG_PATH)) return true;

  try {
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    return !content.includes('onboarding:') || !content.includes('completed: true');
  } catch {
    return true;
  }
}

// Load summon config
function loadSummonConfig(): Record<string, any> | null {
  if (!existsSync(CONFIG_PATH)) return null;

  try {
    // Simple YAML parsing (or use js-yaml)
    const content = readFileSync(CONFIG_PATH, 'utf-8');
    const result: Record<string, any> = {};

    let currentSection = result;
    for (const line of content.split('\n')) {
      if (line.trim().startsWith('#') || !line.trim()) continue;

      const match = line.match(/^(\w+):\s*(.+)?$/);
      if (match) {
        const [, key, value] = match;
        if (value) {
          currentSection[key] = value.replace(/^["']|["']$/g, '');
        } else {
          result[key] = {};
          currentSection = result[key];
        }
      }
    }
    return result;
  } catch {
    return null;
  }
}

// Check environment status
interface EnvStatus {
  mode: 'full' | 'limited' | 'demo';
  warnings: string[];
  config: Record<string, any> | null;
}

function checkEnvironment(): EnvStatus {
  const warnings: string[] = [];
  const summonConfig = loadSummonConfig();

  // Check LLM key first - this is the main requirement
  const hasLLM = process.env.OPENAI_API_KEY ||
                 process.env.ANTHROPIC_API_KEY ||
                 process.env.OPENROUTER_API_KEY;

  if (!hasLLM) {
    warnings.push('Run `summon setup` for full features');
    return {
      mode: 'demo',
      warnings,
      config: summonConfig
    };
  }

  // Have LLM but no config file - that's ok, just warn
  if (!summonConfig) {
    warnings.push('No config file found. Run `summon setup` to save preferences.');
  }

  return { mode: 'full', warnings, config: summonConfig };
}

// Print warnings (non-blocking)
function printWarnings(status: EnvStatus): void {
  if (status.warnings.length > 0) {
    console.error('');
    for (const warning of status.warnings) {
      console.error(`⚠️  ${warning}`);
    }
    console.error('');
  }
}

// Create CLI
const program = new Command();

program
  .name('summon')
  .description('Summon composable agents with portable YAML rituals')
  .version('0.1.0')
  .configureOutput({
    writeErr: (str) => process.stderr.write(str),
    outputError: (str, write) => write(`Error: ${str}`)
  });

// Setup command
program
  .command('setup')
  .description('Interactive setup wizard')
  .action(async () => {
    await runSetup();
  });

// Quick summon (default command)
program
  .argument('[query]', 'Your question or task')
  .option('-r, --ritual <path>', 'Ritual YAML file')
  .option('-R, --reference <ref>', 'Ritual reference (e.g., @author/name)')
  .option('-q, --quick', 'Quick compose mode (no ritual file)')
  .option('-i, --interactive', 'Interactive mode with checkpoints')
  .option('-a, --autonomous', 'Fully autonomous mode (no checkpoints)')
  .option('--dry-run', 'Show what would be done')
  .action(async (query: string | undefined, options: any) => {
    // Check if first run
    if (!query && needsSetup()) {
      console.log('🦞 Welcome to Summon!');
      console.log('   Run `summon setup` to get started, or try:');
      console.log('   summon "What is AI?" --quick\n');
      return;
    }

    if (!query) {
      program.help();
      return;
    }

    const status = checkEnvironment();
    printWarnings(status);

    if (options.dryRun) {
      console.log('🔮 Would summon with:');
      console.log(`   Query: "${query}"`);
      console.log(`   Mode: ${status.mode}`);
      console.log(`   Ritual: ${options.ritual || status.config?.defaults?.ritual || 'quick-compose'}`);
      return;
    }

    // Check for missing requirements if ritual specified
    if (options.ritual) {
      console.log('Checking ritual requirements...');
      const missing = checkRitalRequirements(options.ritual);
      console.log('Missing items:', missing.length);
      if (missing.length > 0) {
        console.log('');
        console.log('⚠️  Missing requirements for this ritual:');
        for (const item of missing) {
          console.log(`   • ${item.name}`);
        }
        console.log('');

        const shouldSetup = await interactiveSetup(missing, query, options.ritual);
        if (shouldSetup) {
          // Re-run the command after setup
          console.log('');
          console.log('🔄 Re-running your command...');
          console.log('');
          // Recursively call ourselves - but we need to avoid infinite loops
          // For now, just continue with potentially updated env
        }
      }
    }

    // In demo mode, show simulated response
    if (status.mode === 'demo') {
      console.log(`\n[DEMO MODE] Simulated response for: "${query}"`);
      console.log('\nIn live mode, this would:');
      console.log('  1. Load ritual configuration');
      console.log('  2. Spawn agent with LLM');
      console.log('  3. Execute tools if needed');
      console.log('  4. Return formatted response\n');
      console.log('Run `summon setup` to enable live mode.\n');
      return;
    }

    // Delegate to main CLI
    console.log(`\n🦞 Summoning: "${query}"`);
    console.log('Mode:', status.mode);
    
    try {
      let result;
      
      if (options.ritual) {
        // Load and execute from local YAML file
        const ritualPath = options.ritual;
        console.log(`Loading ritual: ${ritualPath}`);
        
        // Read the YAML file
        const yamlContent = readFileSync(ritualPath, 'utf-8');
        
        result = await executeRitualFromYaml(yamlContent, query, {
          mode: options.interactive ? 'interactive' : (options.autonomous ? 'autonomous' : 'autonomous'),
          streaming: true
        });
      } else if (options.reference) {
        // Execute from registry reference (e.g., @author/name)
        const ref = options.reference;
        console.log(`Fetching ritual: ${ref}`);
        
        result = await executeRitualByRef(ref, query, {
          mode: options.interactive ? 'interactive' : (options.autonomous ? 'autonomous' : 'autonomous'),
          streaming: true
        });
      } else {
        // Quick compose mode - just use default settings
        console.log('Using quick-compose mode');
        // For quick compose, we need a basic YAML - use a minimal default
        const defaultYaml = `
name: quick-summon
version: 1.0.0
persona:
  role: Assistant
  goal: Help the user
model:
  provider: openrouter
  name: google/gemini-2.0-flash
`;
        result = await executeRitualFromYaml(defaultYaml, query, {
          mode: options.interactive ? 'interactive' : (options.autonomous ? 'autonomous' : 'autonomous'),
          streaming: true
        });
      }
      
      // Handle streaming or regular result
      if (result && typeof result[Symbol.asyncIterator] === 'function') {
        // Streaming result
        for await (const chunk of result) {
          process.stdout.write(chunk);
        }
      } else if (result) {
        // Regular result
        console.log('\n✅ Result:', result);
      }
    } catch (error: any) {
      console.error('\n❌ Summoning failed:', error.message);
      process.exit(1);
    }
  });

// Config command group
const configCmd = program
  .command('config')
  .description('Manage summon configuration');

configCmd
  .command('get <key>')
  .description('Get config value')
  .action((key: string) => {
    const summonConfig = loadSummonConfig();
    if (!summonConfig) {
      console.error('No config found. Run `summon setup`');
      return;
    }
    // Simple key path (e.g., "llm.default_provider")
    const parts = key.split('.');
    let value: any = summonConfig;
    for (const part of parts) {
      value = value?.[part];
    }
    console.log(value || '(not set)');
  });

configCmd
  .command('set <key> <value>')
  .description('Set config value')
  .action((key: string, value: string) => {
    console.log(`Would set ${key} = ${value}`);
    // TODO: Implement config update
  });

configCmd
  .command('list')
  .description('List all config')
  .action(() => {
    const summonConfig = loadSummonConfig();
    if (!summonConfig) {
      console.log('No config found. Run `summon setup`');
      return;
    }
    console.log('Current configuration:');
    console.log(summonConfig);
  });

// Auth command group
const authCmd = program
  .command('auth')
  .description('Manage API credentials');

authCmd
  .command('list')
  .description('List configured auth')
  .action(() => {
    const keys: { name: string; status: string }[] = [];
    if (process.env.OPENAI_API_KEY) keys.push({ name: 'openai', status: '✓' });
    if (process.env.ANTHROPIC_API_KEY) keys.push({ name: 'anthropic', status: '✓' });
    if (process.env.OPENROUTER_API_KEY) keys.push({ name: 'openrouter', status: '✓' });
    if (process.env.ALPHAVANTAGE_API_KEY) keys.push({ name: 'alphavantage', status: '✓' });
    if (process.env.TAVILY_API_KEY) keys.push({ name: 'tavily', status: '✓' });

    if (keys.length === 0) {
      console.log('No API keys configured.');
      console.log('Run `summon auth add <provider>`');
      return;
    }

    console.log('Configured credentials:');
    for (const key of keys) {
      console.log(`  ${key.status} ${key.name}`);
    }
  });

authCmd
  .command('add <provider>')
  .description('Add API key for provider')
  .action((provider: string) => {
    console.log(`Would add ${provider} key interactively`);
    // TODO: Interactive key input
  });

// Sessions command group
const sessionsCmd = program
  .command('sessions')
  .description('Manage session history');

sessionsCmd
  .command('list')
  .description('List recent sessions')
  .action(() => {
    console.log('Recent sessions:');
    console.log('  (No sessions yet)');
    // TODO: Implement session listing
  });

// Parse and run
program.parse();