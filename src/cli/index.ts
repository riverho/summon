#!/usr/bin/env bun

import { Command } from 'commander';
import { config } from 'dotenv';
import {
  createComponentRegistry,
  loadAgentComposition,
  listPersonas,
  listSkills,
  resolvePath,
} from '../components/registry.js';
import { composeAgent, quickCompose, type ComposedAgentSpec } from '../components/composer.js';
import { ComposedAgent } from '../components/composed-agent.js';
import { globalToolRegistry } from '../runtime/tools.js';

// Load environment variables
config({ quiet: true });

// ============================================================================
// Model Helpers
// ============================================================================

interface ModelInfo {
  provider: string;
  model: string;
  baseUrl?: string;
}

function getConfiguredModels(): ModelInfo[] {
  const models: ModelInfo[] = [];

  if (process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    if (baseUrl.includes('openrouter')) {
      // Using OpenRouter
    }
    models.push({ provider: 'openai', model: process.env.DEFAULT_MODEL_ID || 'gpt-4o-mini', baseUrl });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    console.log(`  Anthropic: ${baseUrl || 'default'}`);
    models.push({ provider: 'anthropic', model: 'claude-sonnet-4-20250514', baseUrl });
  }

  if (process.env.GOOGLE_API_KEY) {
    console.log('  Google: default');
    models.push({ provider: 'google', model: 'gemini-2.5-pro' });
  }

  if (process.env.XAI_API_KEY) {
    console.log('  xAI: https://api.x.ai/v1');
    models.push({ provider: 'xai', model: 'grok-3' });
  }

  if (process.env.OLLAMA_BASE_URL) {
    console.log(`  Ollama: ${process.env.OLLAMA_BASE_URL}`);
    models.push({ provider: 'ollama', model: 'llama3.3' });
  }

  return models;
}

const program = new Command();

program
  .name('summon')
  .description('Summon composable agents with portable YAML rituals')
  .version('0.1.0');

// ============================================================================
// Summon Command (from YAML ritual)
// ============================================================================

program
  .command('run')
  .description('Summon an agent from a YAML ritual file')
  .argument('<query>', 'The summoning request')
  .option('-r, --ritual <path>', 'Path to YAML ritual file (braddy:// for relative paths)')
  .option('-m, --model <model>', 'Override the model (e.g., openrouter/deepseek-r1:free)')
  .option('-v, --verbose', 'Show verbose output including tool calls')
  .action(async (query: string, options: { ritual?: string; model?: string; verbose?: boolean }) => {
    if (!options.ritual) {
      console.error('Error: --ritual is required');
      console.log('Usage: summon run "query" --ritual braddy://examples/agents/financial-analyst.yaml');
      process.exit(1);
    }

    const resolvedConfig = resolvePath(options.ritual);
    console.log(`Loading ritual: ${options.ritual} → ${resolvedConfig}`);

    const composition = loadAgentComposition(resolvedConfig);
    if (!composition) {
      console.error(`Error: Failed to load ritual from ${resolvedConfig}`);
      console.log('\nTip: Use braddy:// prefix for paths relative to summon installation:');
      console.log('  summon run "query" --ritual braddy://examples/agents/financial-analyst.yaml');
      process.exit(1);
    }

    console.log(`Summoning: ${composition.name}`);
    console.log(`Query: ${query}\n`);

    let spec: ComposedAgentSpec = composeAgent(composition);
    if (options.model) {
      console.log(`Using model: ${options.model}\n`);
      spec = { ...spec, model: options.model };
    }

    const agent = ComposedAgent.create(spec);

    for await (const event of agent.run(query)) {
      switch (event.type) {
        case 'thinking':
          if (options.verbose) console.log(`[Thinking] ${event.message}`);
          break;
        case 'tool_start':
          if (options.verbose) console.log(`[Tool] ${event.tool}(${JSON.stringify(event.args)})`);
          break;
        case 'tool_end':
          if (options.verbose) console.log(`[Tool] ${event.tool} completed in ${event.duration}ms`);
          break;
        case 'tool_error':
          console.error(`[Error] ${event.tool}: ${event.error}`);
          break;
        case 'done':
          console.log(event.answer);
          if (options.verbose) {
            console.log(`\n[Completed in ${event.iterations} iteration(s), ${event.toolCalls.length} tool call(s)]`);
          }
          break;
      }
    }
  });

// ============================================================================
// Compose Command (from components)
// ============================================================================

program
  .command('compose')
  .description('Quick summon an agent from component IDs')
  .argument('<query>', 'The summoning request')
  .requiredOption('-p, --persona <id>', 'Persona ID to summon')
  .requiredOption('-s, --skills <ids>', 'Comma-separated skill IDs')
  .option('-m, --model <model>', 'Override the model')
  .option('-v, --verbose', 'Show verbose output')
  .action(async (query: string, options: { persona: string; skills: string; model?: string; verbose?: boolean }) => {
    const registry = createComponentRegistry();
    const skillIds = options.skills.split(',').map(s => s.trim());

    console.log(`Composing: persona=${options.persona}, skills=${skillIds.join(', ')}`);
    console.log(`Query: ${query}\n`);

    let spec: ComposedAgentSpec | null = quickCompose(options.persona, skillIds, registry);
    if (!spec) {
      console.error('Error: Failed to compose agent');
      process.exit(1);
    }

    if (options.model) {
      console.log(`Using model: ${options.model}\n`);
      spec = { ...spec, model: options.model };
    }

    const agent = ComposedAgent.create(spec);

    for await (const event of agent.run(query)) {
      switch (event.type) {
        case 'thinking':
          if (options.verbose) console.log(`[Thinking] ${event.message}`);
          break;
        case 'done':
          console.log(event.answer);
          break;
      }
    }
  });

// ============================================================================
// Component Commands
// ============================================================================

const components = program
  .command('components')
  .description('Manage and list components');

components
  .command('list')
  .description('List all available components')
  .option('-t, --type <type>', 'Filter by type (personas, skills)', 'all')
  .action((options: { type: string }) => {
    const registry = createComponentRegistry();

    if (options.type === 'all' || options.type === 'personas') {
      console.log('Personas:');
      for (const id of listPersonas(registry)) {
        const p = registry.personas.get(id);
        console.log(`  - ${id}: ${p?.role || 'Unknown'}`);
      }
    }

    if (options.type === 'all' || options.type === 'skills') {
      console.log('Skills:');
      for (const id of listSkills(registry)) {
        const s = registry.skills.get(id);
        console.log(`  - ${id}: ${s?.name || 'Unknown'}`);
        if (s?.requiredTools.length) {
          console.log(`    Tools: ${s.requiredTools.join(', ')}`);
        }
      }
    }

    console.log('Registered Tools:');
    for (const name of globalToolRegistry.getNames()) {
      console.log(`  - ${name}`);
    }
  });

// ============================================================================
// Models Command
// ============================================================================

program
  .command('models')
  .description('List available models')
  .action(() => {
    console.log('Configured Models:\n');
    const models = getConfiguredModels();
    if (models.length === 0) {
      console.log('No models configured. Set API keys in .env');
      return;
    }
    for (const m of models) {
      console.log(`  ${m.provider}: ${m.model}`);
      if (m.baseUrl) console.log(`    ${m.baseUrl}`);
    }
    console.log('\nUsage:');
    console.log('  summon run "query" --ritual agent.yaml --model openrouter/deepseek-r1:free');
    console.log('  summon compose "query" -p analyst -s finance -m openai/gpt-4o-mini');
  });

// ============================================================================
// Skills & Personas Commands (shortcuts)
// ============================================================================

program
  .command('skills')
  .description('List available skills')
  .action(() => {
    const registry = createComponentRegistry();
    console.log('Skills:');
    for (const id of listSkills(registry)) {
      const s = registry.skills.get(id);
      console.log(`  - ${id}: ${s?.name || 'Unknown'}`);
      if (s?.requiredTools.length) {
        console.log(`    Tools: ${s.requiredTools.join(', ')}`);
      }
    }
  });

program
  .command('personas')
  .description('List available personas')
  .action(() => {
    const registry = createComponentRegistry();
    console.log('Personas:');
    for (const id of listPersonas(registry)) {
      const p = registry.personas.get(id);
      console.log(`  - ${id}: ${p?.role || 'Unknown'}`);
    }
  });

// ============================================================================
// Tools Registration (auto-load skills)
// ============================================================================

import '../builtin/skills/finance/index.js';
import '../builtin/skills/web-search/index.js';
import '../builtin/skills/git/index.js';

function registerAvailableTools(): void {
  console.log('Registered tools:');
  for (const name of globalToolRegistry.getNames()) {
    console.log(`  ✓ ${name}`);
  }
}
registerAvailableTools();

// ============================================================================
// Parse
// ============================================================================

program.parse();
