#!/usr/bin/env bun
/**
 * Formalized Setup Module - Multi-Provider Edition
 * One-time setup with clear location reporting
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import readline from 'readline';

const SUMMON_DIR = join(homedir(), '.summon');
const CONFIG_PATH = join(SUMMON_DIR, 'config.yaml');
const ENV_PATH = join(SUMMON_DIR, '.env');
const SESSIONS_DIR = join(SUMMON_DIR, 'sessions');
const RITUALS_DIR = join(SUMMON_DIR, 'rituals');
const CACHE_DIR = join(SUMMON_DIR, 'cache');
const DOCS_DIR = join(homedir(), 'Documents', 'Summon');

// LLM Provider definitions
const LLM_PROVIDERS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Multi-provider access (recommended)',
    envVar: 'OPENROUTER_API_KEY',
    modelEnvVar: 'OPENROUTER_MODEL',
    setupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'z-ai/glm-5',
    models: [
      { id: 'z-ai/glm-5', name: 'GLM-5 (default)' },
      { id: 'openai/gpt-5.3', name: 'GPT-5.3' },
      { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6' },
      { id: 'google/gemini-3.0', name: 'Gemini 3.0' },
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'Direct OpenAI access',
    envVar: 'OPENAI_API_KEY',
    modelEnvVar: 'OPENAI_MODEL',
    setupUrl: 'https://platform.openai.com/api-keys',
    defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude models',
    envVar: 'ANTHROPIC_API_KEY',
    modelEnvVar: 'ANTHROPIC_MODEL',
    setupUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku (fast)' },
    ]
  },
  {
    id: 'google',
    name: 'Google',
    description: 'Gemini models',
    envVar: 'GOOGLE_API_KEY',
    modelEnvVar: 'GOOGLE_MODEL',
    setupUrl: 'https://makersuite.google.com/app/apikey',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro' },
    ]
  },
  {
    id: 'xai',
    name: 'xAI',
    description: 'Grok models',
    envVar: 'XAI_API_KEY',
    modelEnvVar: 'XAI_MODEL',
    setupUrl: 'https://x.ai/api',
    defaultModel: 'grok-2',
    models: [
      { id: 'grok-2', name: 'Grok 2' },
      { id: 'grok-2-mini', name: 'Grok 2 Mini' },
    ]
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: 'Local models (no API key needed)',
    envVar: 'OLLAMA_BASE_URL',
    modelEnvVar: 'OLLAMA_MODEL',
    setupUrl: 'https://ollama.com',
    defaultModel: 'llama3.2',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2' },
      { id: 'qwen2.5', name: 'Qwen 2.5' },
    ]
  },
];

const TOOLS = [
  {
    id: 'tavily',
    name: 'Tavily Search',
    envVar: 'TAVILY_API_KEY',
    description: 'Web search for news and research',
    setupUrl: 'https://tavily.com'
  },
  {
    id: 'alphavantage',
    name: 'AlphaVantage',
    envVar: 'ALPHAVANTAGE_API_KEY',
    description: 'Real-time stock quotes and financial data',
    setupUrl: 'https://www.alphavantage.co/support/#api-key'
  },
];

interface SetupOptions {
  ritualPath?: string;
  skipIfExists?: boolean;
}

interface SetupResult {
  success: boolean;
  isNewSetup: boolean;
  locations: {
    config: string;
    env: string;
    sessions: string;
    rituals: string;
    docs: string;
  };
  configured: {
    llm: string | null;
    tools: string[];
  };
}

export function isFirstRun(): boolean {
  return !existsSync(CONFIG_PATH);
}

export async function runFormalSetup(options: SetupOptions = {}): Promise<SetupResult> {
  const { ritualPath, skipIfExists = true } = options;
  
  if (existsSync(CONFIG_PATH) && skipIfExists) {
    return {
      success: true,
      isNewSetup: false,
      locations: getLocations(),
      configured: getConfiguredStatus()
    };
  }

  console.log('🦞 Summon Setup');
  console.log('════════════════');
  console.log('');

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const question = (prompt: string): Promise<string> => {
    return new Promise((resolve) => rl.question(prompt, resolve));
  };

  // Step 1: Create directories
  console.log('Step 1: Creating directory structure...');
  createDirectoryStructure();
  console.log('✓ Directories created');
  console.log('');

  // Step 2: LLM Provider Selection
  console.log('Step 2: LLM Provider (Required)');
  console.log('────────────────────────────────');
  LLM_PROVIDERS.forEach((p, i) => {
    console.log(`[${i + 1}] ${p.name} - ${p.description}`);
  });
  console.log(`[${LLM_PROVIDERS.length + 1}] Skip (configure later)`);
  console.log('');

  let selectedProvider: typeof LLM_PROVIDERS[0] | null = null;
  let llmConfigured = false;

  const providerChoice = await question('> ');
  const providerIndex = parseInt(providerChoice) - 1;

  if (providerIndex >= 0 && providerIndex < LLM_PROVIDERS.length) {
    selectedProvider = LLM_PROVIDERS[providerIndex];
    
    if (selectedProvider.id === 'ollama') {
      // Ollama doesn't need API key
      console.log(`\n${selectedProvider.name} Configuration:`);
      const baseUrl = await question(`Base URL [http://127.0.0.1:11434]: `);
      const model = await question(`Model [${selectedProvider.defaultModel}]: `);
      
      const finalBaseUrl = baseUrl.trim() || 'http://127.0.0.1:11434';
      const finalModel = model.trim() || selectedProvider.defaultModel;
      
      saveEnvVar(selectedProvider.envVar, finalBaseUrl);
      saveEnvVar(selectedProvider.modelEnvVar, finalModel);
      process.env[selectedProvider.envVar] = finalBaseUrl;
      process.env[selectedProvider.modelEnvVar] = finalModel;
      console.log(`✓ ${selectedProvider.name} configured\n`);
      llmConfigured = true;
    } else {
      // Other providers need API key
      console.log(`\n${selectedProvider.name} Configuration:`);
      
      // Check if API key already exists
      const envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
      const existingKeyMatch = envContent.match(new RegExp(`^${selectedProvider.envVar}=(.+)$`, 'm'));
      const existingKey = existingKeyMatch ? existingKeyMatch[1].trim() : '';
      const existingModelMatch = envContent.match(new RegExp(`^${selectedProvider.modelEnvVar}=(.+)$`, 'm'));
      const existingModel = existingModelMatch ? existingModelMatch[1].trim() : selectedProvider.defaultModel;
      
      let apiKey: string;
      
      if (existingKey) {
        // Show masked existing key
        const maskedKey = existingKey.slice(0, 8) + '...' + existingKey.slice(-4);
        console.log(`Current API key: ${maskedKey}`);
        console.log(`Get a new key: ${selectedProvider.setupUrl}`);
        const newKey = await question(`${selectedProvider.envVar} (Press Enter to keep existing): `);
        apiKey = newKey.trim() || existingKey;
      } else {
        console.log(`Get your API key: ${selectedProvider.setupUrl}`);
        const newKey = await question(`${selectedProvider.envVar}: `);
        apiKey = newKey.trim();
      }
      
      if (apiKey) {
        saveEnvVar(selectedProvider.envVar, apiKey);
        process.env[selectedProvider.envVar] = apiKey;
        
        // Model selection - always show, with current model highlighted
        console.log('\nSelect a model:');
        console.log(`Current: ${existingModel}`);
        console.log('');
        selectedProvider.models.forEach((m, i) => {
          const isCurrent = m.id === existingModel;
          console.log(`[${i + 1}] ${m.name}${isCurrent ? ' ← current' : ''}`);
        });
        console.log(`[${selectedProvider.models.length + 1}] Enter custom model ID`);
        console.log(`\n💡 Find more at: https://openrouter.ai/models`);
        
        const modelChoice = await question('> ');
        
        let modelId: string;
        if (!modelChoice.trim()) {
          // Empty input - keep existing model
          modelId = existingModel;
        } else {
          const modelIndex = parseInt(modelChoice) - 1;
          if (modelIndex >= 0 && modelIndex < selectedProvider.models.length) {
            modelId = selectedProvider.models[modelIndex].id;
          } else if (modelIndex === selectedProvider.models.length) {
            const customModel = await question('Enter model ID: ');
            modelId = customModel.trim() || existingModel;
          } else {
            modelId = existingModel;
          }
        }
        
        saveEnvVar(selectedProvider.modelEnvVar, modelId);
        process.env[selectedProvider.modelEnvVar] = modelId;
        console.log(`✓ Model: ${modelId}`);
        
        console.log(`✓ ${selectedProvider.name} configured\n`);
        llmConfigured = true;
      }
    }
  } else {
    console.log('⚠️  Skipped. Configure an LLM provider before using summon.\n');
  }

  // Step 3: Tool configuration
  const configuredTools: string[] = [];
  
  // Check ritual for required tools
  let requiredTools = TOOLS;
  if (ritualPath && existsSync(ritualPath)) {
    const content = readFileSync(ritualPath, 'utf-8');
    requiredTools = TOOLS.filter(t => {
      if (t.id === 'alphavantage') return content.includes('financial') || content.includes('alphavantage');
      if (t.id === 'tavily') return content.includes('search') || content.includes('tavily');
      return false;
    });
  }

  if (requiredTools.length > 0) {
    console.log('Step 3: Tool Configuration (Optional)');
    console.log('─────────────────────────────────────');
    console.log('These tools enhance your rituals:');
    requiredTools.forEach(t => console.log(`  • ${t.name} - ${t.description}`));
    console.log('');

    const setupTools = await question('Set up these tools now? [Y/n] ');
    
    if (setupTools.toLowerCase() !== 'n') {
      for (const tool of requiredTools) {
        console.log(`\n${tool.name}`);
        console.log(`Get free key: ${tool.setupUrl}`);
        const key = await question(`${tool.envVar}: `);
        
        if (key.trim()) {
          saveEnvVar(tool.envVar, key.trim());
          process.env[tool.envVar] = key.trim();
          configuredTools.push(tool.name);
          console.log('✓ Saved');
        }
      }
    }
    console.log('');
  }

  // Step 4: Save config
  const config = `# Summon Configuration
# Created: ${new Date().toISOString()}
version: "1.0.0"

setup:
  completed: true
  date: "${new Date().toISOString().split('T')[0]}"
  llmProvider: ${selectedProvider?.id || 'none'}
  llmConfigured: ${llmConfigured}
  toolsConfigured: [${configuredTools.map(t => `"${t}"`).join(', ')}]

preferences:
  defaultRitual: null
  saveLocation: "${DOCS_DIR.replace(/\\/g, '\\')}"
  autoSave: true
`;

  writeFileSync(CONFIG_PATH, config);
  console.log('✓ Configuration saved');

  rl.close();

  printSetupComplete(getLocations(), selectedProvider?.name || null, configuredTools);

  return {
    success: true,
    isNewSetup: true,
    locations: getLocations(),
    configured: {
      llm: selectedProvider?.name || null,
      tools: configuredTools
    }
  };
}

function createDirectoryStructure(): void {
  mkdirSync(SUMMON_DIR, { recursive: true });
  mkdirSync(SESSIONS_DIR, { recursive: true });
  mkdirSync(RITUALS_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(DOCS_DIR, { recursive: true });
  
  if (!existsSync(ENV_PATH)) {
    writeFileSync(ENV_PATH, `# Summon API Keys
# Created: ${new Date().toISOString()}
# Get your keys from the providers listed below

# LLM Provider (Choose one)
# OPENROUTER_API_KEY=                    # https://openrouter.ai/keys
# OPENROUTER_MODEL=openai/gpt-4o-mini    # Model ID from openrouter.ai/models

# OPENAI_API_KEY=                        # https://platform.openai.com/api-keys
# OPENAI_MODEL=gpt-4o-mini

# ANTHROPIC_API_KEY=                     # https://console.anthropic.com/settings/keys
# ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# GOOGLE_API_KEY=                        # https://makersuite.google.com/app/apikey
# GOOGLE_MODEL=gemini-2.0-flash

# XAI_API_KEY=                           # https://x.ai/api
# XAI_MODEL=grok-2

# OLLAMA_BASE_URL=http://127.0.0.1:11434
# OLLAMA_MODEL=llama3.2

# Tools
# TAVILY_API_KEY=                        # https://tavily.com
# ALPHAVANTAGE_API_KEY=                  # https://www.alphavantage.co/support/#api-key
`);
  }
}

function saveEnvVar(key: string, value: string): void {
  const envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  // Match commented or uncommented key: # KEY=value or KEY=value
  const keyRegex = new RegExp(`^(#\\s*)?${key}=.*$`, 'm');
  
  if (keyRegex.test(envContent)) {
    // Replace existing (uncomment and set value)
    const newContent = envContent.replace(keyRegex, `${key}=${value}`);
    writeFileSync(ENV_PATH, newContent);
  } else {
    // Append new key at end
    writeFileSync(ENV_PATH, envContent + `\n${key}=${value}\n`);
  }
}

function getLocations() {
  return {
    config: CONFIG_PATH,
    env: ENV_PATH,
    sessions: SESSIONS_DIR,
    rituals: RITUALS_DIR,
    docs: DOCS_DIR
  };
}

function getConfiguredStatus(): { llm: string | null; tools: string[] } {
  const envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
  
  let llm: string | null = null;
  if (envContent.match(/OPENROUTER_API_KEY=\S+/)) llm = 'OpenRouter';
  else if (envContent.match(/OPENAI_API_KEY=\S+/)) llm = 'OpenAI';
  else if (envContent.match(/ANTHROPIC_API_KEY=\S+/)) llm = 'Anthropic';
  else if (envContent.match(/GOOGLE_API_KEY=\S+/)) llm = 'Google';
  else if (envContent.match(/XAI_API_KEY=\S+/)) llm = 'xAI';
  else if (envContent.match(/OLLAMA_BASE_URL=\S+/)) llm = 'Ollama';
  
  const tools: string[] = [];
  if (envContent.match(/TAVILY_API_KEY=\S+/)) tools.push('Tavily');
  if (envContent.match(/ALPHAVANTAGE_API_KEY=\S+/)) tools.push('AlphaVantage');
  
  return { llm, tools };
}

function printSetupComplete(locations: any, llmName: string | null, tools: string[]): void {
  console.log('');
  console.log('✅ Setup Complete!');
  console.log('═══════════════════');
  console.log('');
  console.log('Your data is stored in:');
  console.log(`  Config:     ${locations.config}`);
  console.log(`  Auth:       ${locations.env}`);
  console.log(`  Sessions:   ${locations.sessions}`);
  console.log(`  Rituals:    ${locations.rituals}`);
  console.log(`  Docs:       ${locations.docs}`);
  console.log('');
  console.log('Configured:');
  console.log(`  LLM:        ${llmName || 'None'}`);
  console.log(`  Tools:      ${tools.length > 0 ? tools.join(', ') : 'None'}`);
  console.log('');
  console.log('Next steps:');
  console.log('  summon run "What is AAPL price?" --ritual <path>');
  console.log('  summon config --location    # Show all locations');
  console.log('  summon doctor               # Check health');
  console.log('');
}

// Export for CLI
export { SUMMON_DIR, CONFIG_PATH, ENV_PATH, SESSIONS_DIR, RITUALS_DIR, DOCS_DIR, LLM_PROVIDERS, TOOLS };