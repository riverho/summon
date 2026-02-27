#!/usr/bin/env bun
/**
 * Pre-flight Check Module
 * Validates environment before agent spawn
 */

import { existsSync, readFileSync } from 'fs';
import readline from 'readline';

export interface PreFlightResult {
  ok: boolean;
  missing: MissingItem[];
  warnings: string[];
}

export interface MissingItem {
  type: 'auth' | 'tool';
  name: string;
  envVar: string;
  description: string;
  setupUrl: string;
}

const TOOL_MAP: Record<string, MissingItem> = {
  'alphavantage_api': {
    type: 'tool',
    name: 'AlphaVantage API',
    envVar: 'ALPHAVANTAGE_API_KEY',
    description: 'Real-time stock quotes and financial data',
    setupUrl: 'https://www.alphavantage.co/support/#api-key'
  },
  'tavily_search': {
    type: 'tool',
    name: 'Tavily Search',
    envVar: 'TAVILY_API_KEY',
    description: 'Web search for news and research',
    setupUrl: 'https://tavily.com'
  },
  'openai': {
    type: 'auth',
    name: 'OpenAI API',
    envVar: 'OPENAI_API_KEY',
    description: 'LLM access for agent responses',
    setupUrl: 'https://platform.openai.com/api-keys'
  },
  'anthropic': {
    type: 'auth',
    name: 'Anthropic API',
    envVar: 'ANTHROPIC_API_KEY',
    description: 'Claude LLM access',
    setupUrl: 'https://console.anthropic.com/settings/keys'
  },
  'openrouter': {
    type: 'auth',
    name: 'OpenRouter API',
    envVar: 'OPENROUTER_API_KEY',
    description: 'Multi-provider LLM access',
    setupUrl: 'https://openrouter.ai/keys'
  }
};

export async function preFlightCheck(ritualPath?: string): Promise<PreFlightResult> {
  const missing: MissingItem[] = [];
  const warnings: string[] = [];

  // Check LLM
  const hasLLM = process.env.OPENAI_API_KEY || 
                 process.env.ANTHROPIC_API_KEY || 
                 process.env.OPENROUTER_API_KEY;
  
  if (!hasLLM) {
    missing.push(TOOL_MAP['openrouter']);
    warnings.push('No LLM API key configured');
  }

  // Check ritual-specific tools
  if (ritualPath && existsSync(ritualPath)) {
    try {
      const content = readFileSync(ritualPath, 'utf-8');
      
      // Check for OpenRouter specifically
      if (content.includes('OPENROUTER_API_KEY') && !process.env.OPENROUTER_API_KEY) {
        // Replace the generic openai suggestion with openrouter
        const openRouterIndex = missing.findIndex(m => m.name === 'OpenAI API');
        if (openRouterIndex >= 0) {
          missing[openRouterIndex] = TOOL_MAP['openrouter'];
        } else if (!process.env.OPENROUTER_API_KEY) {
          missing.push(TOOL_MAP['openrouter']);
        }
      }
      
      if ((content.includes('alphavantage') || content.includes('financial')) && 
          !process.env.ALPHAVANTAGE_API_KEY) {
        missing.push(TOOL_MAP['alphavantage_api']);
      }
      
      if ((content.includes('tavily') || content.includes('search')) && 
          !process.env.TAVILY_API_KEY) {
        missing.push(TOOL_MAP['tavily_search']);
      }
    } catch {
      // Ignore read errors
    }
  }

  return {
    ok: missing.length === 0,
    missing,
    warnings
  };
}

export async function promptForSetup(missing: MissingItem[]): Promise<'continue' | 'setup' | 'cancel'> {
  console.log('');
  console.log('🔍 Pre-flight Check');
  console.log('───────────────────');
  
  for (const item of missing) {
    console.log(`✗ ${item.name} (${item.envVar})`);
    console.log(`  ${item.description}`);
    console.log(`  Get key: ${item.setupUrl}`);
  }
  
  console.log('');
  console.log('Options:');
  console.log('  [1] Run setup now (interactive)');
  console.log('  [2] Continue without tools (limited results)');
  console.log('  [3] Cancel');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise<string>((resolve) => {
    rl.question('> ', resolve);
  });

  rl.close();

  switch (answer.trim()) {
    case '1': return 'setup';
    case '2': return 'continue';
    case '3': return 'cancel';
    default: return 'continue';
  }
}

export async function runInteractiveSetup(missing: MissingItem[]): Promise<boolean> {
  console.log('');
  console.log('🔧 Interactive Setup');
  console.log('───────────────────');
  console.log(`Setup location: ~/.summon/`);
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => rl.question(prompt, resolve));
  };

  const { default: fs } = await import('fs');
  const { default: path } = await import('path');
  const { homedir } = await import('os');

  const setupPath = path.join(homedir(), '.summon');
  fs.mkdirSync(setupPath, { recursive: true });

  for (const item of missing) {
    console.log(`\n${item.name}`);
    console.log(`${item.setupUrl}`);
    const key = await question(`${item.envVar}: `);
    
    if (key.trim()) {
      process.env[item.envVar] = key.trim();
      fs.appendFileSync(
        path.join(setupPath, '.env'), 
        `${item.envVar}=${key.trim()}\n`
      );
      console.log('✓ Saved');
    }
  }

  rl.close();
  console.log('\n✅ Setup complete!\n');
  return true;
}