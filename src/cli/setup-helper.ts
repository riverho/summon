#!/usr/bin/env bun
/**
 * Interactive Setup Helper
 * Guides user through setup when auth/tools are missing
 */

import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'fs';
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

const SUMMON_DIR = join(homedir(), '.summon');
const ENV_PATH = join(SUMMON_DIR, '.env');

interface MissingItem {
  type: 'auth' | 'tool' | 'skill';
  name: string;
  description: string;
  envVar?: string;
  setupUrl?: string;
}

export async function interactiveSetup(
  missing: MissingItem[],
  query?: string,
  ritualPath?: string
): Promise<boolean> {
  console.log('');
  console.log('🔧 Setup Required');
  console.log('─────────────────');
  console.log('The following are needed to run this command:');
  console.log('');

  for (const item of missing) {
    const icon = item.type === 'auth' ? '🔑' : item.type === 'tool' ? '🛠️' : '📦';
    console.log(`${icon} ${item.name}: ${item.description}`);
  }

  console.log('');
  const answer = await question('Would you like to set these up now? [Y/n] ');

  if (answer.toLowerCase() === 'n') {
    console.log('');
    console.log('⚠️  Continuing without setup. The command may fail or produce limited results.');
    console.log('   You can run setup later with: summon setup');
    console.log('');
    return false;
  }

  // Setup each missing item
  const setupResults: Record<string, string> = {};

  for (const item of missing) {
    console.log('');
    console.log(`Setting up: ${item.name}`);
    console.log(item.description);

    if (item.setupUrl) {
      console.log(`Get your key at: ${item.setupUrl}`);
    }

    if (item.envVar) {
      const value = await question(`${item.envVar}: `);
      if (value.trim()) {
        setupResults[item.envVar] = value.trim();
        // Also set for current process
        process.env[item.envVar] = value.trim();
      }
    }
  }

  // Save to .env file
  if (Object.keys(setupResults).length > 0) {
    // Ensure directory exists
    mkdirSync(SUMMON_DIR, { recursive: true });

    // Create or append to .env
    let envContent = '\n# Added by summon setup on ' + new Date().toISOString() + '\n';
    for (const [key, value] of Object.entries(setupResults)) {
      envContent += `${key}=${value}\n`;
    }

    writeFileSync(ENV_PATH, envContent, { flag: 'a' });
    console.log('');
    console.log(`✓ Saved to ${ENV_PATH}`);
  }

  console.log('');
  console.log('🎉 Setup complete!');

  // Offer to re-run the original command
  if (query) {
    console.log('');
    const rerun = await question('Re-run your command now? [Y/n] ');
    if (rerun.toLowerCase() !== 'n') {
      return true; // Signal to re-run
    }
  }

  rl.close();
  return false;
}

// Map tool names to setup info
export function getToolSetupInfo(toolName: string): MissingItem | null {
  const toolMap: Record<string, MissingItem> = {
    'alphavantage_api': {
      type: 'tool',
      name: 'AlphaVantage API',
      description: 'Real-time stock quotes and financial data',
      envVar: 'ALPHAVANTAGE_API_KEY',
      setupUrl: 'https://www.alphavantage.co/support/#api-key'
    },
    'tavily_search': {
      type: 'tool',
      name: 'Tavily Search',
      description: 'Web search for news and market research',
      envVar: 'TAVILY_API_KEY',
      setupUrl: 'https://tavily.com'
    },
    'financial_search': {
      type: 'tool',
      name: 'Financial Search',
      description: 'Financial data search capability',
      envVar: 'ALPHAVANTAGE_API_KEY',
      setupUrl: 'https://www.alphavantage.co/support/#api-key'
    },
    'web_search': {
      type: 'tool',
      name: 'Web Search',
      description: 'General web search capability',
      envVar: 'TAVILY_API_KEY',
      setupUrl: 'https://tavily.com'
    },
    'openai': {
      type: 'auth',
      name: 'OpenAI API',
      description: 'LLM access for agent responses',
      envVar: 'OPENAI_API_KEY',
      setupUrl: 'https://platform.openai.com/api-keys'
    },
    'anthropic': {
      type: 'auth',
      name: 'Anthropic API',
      description: 'Claude LLM access',
      envVar: 'ANTHROPIC_API_KEY',
      setupUrl: 'https://console.anthropic.com/settings/keys'
    },
    'openrouter': {
      type: 'auth',
      name: 'OpenRouter API',
      description: 'Multi-provider LLM access (recommended)',
      envVar: 'OPENROUTER_API_KEY',
      setupUrl: 'https://openrouter.ai/keys'
    }
  };

  return toolMap[toolName] || null;
}

// Check what's missing for a ritual
export function checkRitalRequirements(ritualPath: string): MissingItem[] {
  const missing: MissingItem[] = [];

  // Check for LLM keys
  const hasLLM = process.env.OPENAI_API_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    process.env.OPENROUTER_API_KEY;

  if (!hasLLM) {
    missing.push(getToolSetupInfo('openrouter')!);
  }

  // Try to read and parse the ritual file
  try {
    const content = readFileSync(ritualPath, 'utf-8');
    console.log('Read ritual file, length:', content.length);

    // Check for tool requirements in the YAML content
    const hasAlpha = content.includes('alphavantage') || content.includes('financial');
    const hasTavily = content.includes('tavily') || content.includes('web_search') || content.includes('search');
    console.log('Has alphavantage/financial:', hasAlpha);
    console.log('Has tavily/search:', hasTavily);

    if (hasAlpha) {
      if (!process.env.ALPHAVANTAGE_API_KEY) {
        console.log('ALPHAVANTAGE_API_KEY not set, adding to missing');
        missing.push(getToolSetupInfo('alphavantage_api')!);
      }
    }

    if (hasTavily) {
      if (!process.env.TAVILY_API_KEY) {
        console.log('TAVILY_API_KEY not set, adding to missing');
        missing.push(getToolSetupInfo('tavily_search')!);
      }
    }

    // Check model requirements
    if (content.includes('openai') && !process.env.OPENAI_API_KEY) {
      missing.push(getToolSetupInfo('openai')!);
    }
    if (content.includes('anthropic') && !process.env.ANTHROPIC_API_KEY) {
      missing.push(getToolSetupInfo('anthropic')!);
    }
    if (content.includes('openrouter') && !process.env.OPENROUTER_API_KEY) {
      missing.push(getToolSetupInfo('openrouter')!);
    }

  } catch (err) {
    console.log('Error reading ritual file:', err);
    // If we can't read the file, fall back to path-based detection
    if (ritualPath.includes('financial')) {
      if (!process.env.ALPHAVANTAGE_API_KEY) {
        missing.push(getToolSetupInfo('alphavantage_api')!);
      }
      if (!process.env.TAVILY_API_KEY) {
        missing.push(getToolSetupInfo('tavily_search')!);
      }
    }
  }

  return missing;
}