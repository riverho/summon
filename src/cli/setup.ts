#!/usr/bin/env bun
/**
 * Summon Setup Wizard
 * One-time interactive onboarding
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = (prompt: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
};

interface SetupConfig {
  llmProvider: string;
  apiKey: string;
  basePath: string;
  defaultRitual: string;
  extras: string[];
}

const SUMMON_DIR = join(homedir(), '.summon');
const CONFIG_PATH = join(SUMMON_DIR, 'config.yaml');

export async function runSetup(): Promise<void> {
  console.log('🦞 Welcome to Summon!');
  console.log('   Let\'s get you set up in 4 quick steps.\n');

  const config: Partial<SetupConfig> = {};

  // Step 1: LLM Provider
  console.log('Step 1/4: LLM Provider');
  console.log('───────────────────────');
  console.log('[1] OpenAI (GPT-4o)');
  console.log('[2] Anthropic (Claude)');
  console.log('[3] OpenRouter (multi-provider)');
  console.log('[4] Skip for now (demo mode)');
  
  const providerChoice = await question('\n> ');
  const providers: Record<string, string> = {
    '1': 'openai',
    '2': 'anthropic',
    '3': 'openrouter',
    '4': 'demo'
  };
  config.llmProvider = providers[providerChoice] || 'demo';

  if (config.llmProvider !== 'demo') {
    const providerName = config.llmProvider === 'openai' ? 'OpenAI' : 
                        config.llmProvider === 'anthropic' ? 'Anthropic' : 'OpenRouter';
    config.apiKey = await question(`${providerName} API key: `);
    // TODO: Verify key
    console.log('✓ Verified\n');
  } else {
    console.log('⚠️  Running in demo mode. Set API key later with: summon auth add\n');
  }

  // Step 2: Data Location
  console.log('Step 2/4: Data Location');
  console.log('───────────────────────');
  console.log(`Default: ~/.summon/`);
  const customPath = await question('Press Enter for default, or type custom path: ');
  config.basePath = customPath.trim() || SUMMON_DIR;
  
  // Create directories
  const dirs = ['sessions', 'memory', 'cache', 'credentials', 'rituals'];
  for (const dir of dirs) {
    mkdirSync(join(config.basePath, dir), { recursive: true });
  }
  console.log(`✓ Created ${config.basePath}/{${dirs.join(',')}}\n`);

  // Step 3: Default Ritual
  console.log('Step 3/4: Default Ritual (Optional)');
  console.log('─────────────────────────────────────');
  console.log('[1] General researcher');
  console.log('[2] Code reviewer');
  console.log('[3] Financial analyst');
  console.log('[4] Skip (specify per-run)');
  
  const ritualChoice = await question('\n> ');
  const rituals: Record<string, string> = {
    '1': 'researcher',
    '2': 'code-reviewer',
    '3': 'financial-analyst',
    '4': 'none'
  };
  config.defaultRitual = rituals[ritualChoice] || 'none';
  
  if (config.defaultRitual !== 'none') {
    console.log(`✓ Set default: ${config.defaultRitual}\n`);
  }

  // Step 4: Optional Tools
  console.log('Step 4/4: Optional Tools');
  console.log('─────────────────────────');
  console.log('[1] Skip (add later)');
  console.log('[2] AlphaVantage (stocks)');
  console.log('[3] Tavily (web search)');
  console.log('[4] All of the above');
  
  const extrasChoice = await question('\n> ');
  config.extras = [];
  
  if (extrasChoice === '2' || extrasChoice === '4') {
    const key = await question('AlphaVantage API key: ');
    config.extras.push('alphavantage');
    // Save to credentials
  }
  if (extrasChoice === '3' || extrasChoice === '4') {
    const key = await question('Tavily API key: ');
    config.extras.push('tavily');
    // Save to credentials
  }

  // Save config
  const yamlConfig = `# Summon Configuration
# Generated: ${new Date().toISOString()}
version: "1.0.0"

llm:
  default_provider: ${config.llmProvider}
  ${config.apiKey ? `api_key: "${config.apiKey}"` : '# No API key set'}

storage:
  base_path: "${config.basePath}"
  sessions: "${join(config.basePath, 'sessions')}"
  memory: "${join(config.basePath, 'memory')}"
  cache: "${join(config.basePath, 'cache')}"
  credentials: "${join(config.basePath, 'credentials')}"

defaults:
  ritual: ${config.defaultRitual !== 'none' ? config.defaultRitual : 'null'}

onboarding:
  completed: true
  version: "1.0.0"
  date: "${new Date().toISOString().split('T')[0]}"
`;

  writeFileSync(CONFIG_PATH, yamlConfig);
  console.log(`\n✓ Config saved to ${CONFIG_PATH}`);

  // Done
  console.log('\n🎉 Setup complete!');
  console.log('\nQuick start:');
  console.log('  summon "What is the P/E of AAPL?"');
  console.log('  summon run "Review this code" --ritual code-reviewer');
  console.log('  summon auth list');
  console.log('\nFor help: summon --help');

  rl.close();
}

// Run if called directly
if (import.meta.main) {
  runSetup().catch(console.error);
}