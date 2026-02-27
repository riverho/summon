/**
 * Unified Summon Configuration
 * 
 * Single source of truth for all paths.
 * Replaces scattered `.summon_mem` references with unified `.summon`.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync } from 'fs';

// Base directory - unified to ~/.summon
export const SUMMON_HOME = process.env.SUMMON_HOME || join(homedir(), '.summon');

// Subdirectories
export const PATHS = {
  home: SUMMON_HOME,
  env: join(SUMMON_HOME, '.env'),
  config: join(SUMMON_HOME, 'config.yaml'),
  sessions: join(SUMMON_HOME, 'sessions'),
  rituals: join(SUMMON_HOME, 'rituals'),
  cache: join(SUMMON_HOME, 'cache'),
  logs: join(SUMMON_HOME, 'logs'),
  components: join(SUMMON_HOME, 'components'),
  tools: join(SUMMON_HOME, 'components', 'tools'),
  skills: join(SUMMON_HOME, 'components', 'skills'),
  personas: join(SUMMON_HOME, 'components', 'personas'),
  decisions: join(SUMMON_HOME, 'decisions'),
  runs: join(SUMMON_HOME, 'sessions', 'runs'),
  docs: join(homedir(), 'Documents', 'Summon'),
} as const;

/**
 * Ensure all summon directories exist
 */
export function ensureDirectories(): void {
  const dirs = [
    PATHS.sessions,
    PATHS.rituals,
    PATHS.cache,
    PATHS.logs,
    PATHS.components,
    PATHS.tools,
    PATHS.skills,
    PATHS.personas,
    PATHS.decisions,
    PATHS.runs,
    PATHS.docs,
  ];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Check if summon is initialized
 */
export function isInitialized(): boolean {
  return existsSync(PATHS.config) && existsSync(PATHS.env);
}

/**
 * Get configured status
 */
export function getConfigStatus(): { 
  initialized: boolean;
  hasLlm: boolean;
  llmProvider: string | null;
} {
  const initialized = isInitialized();
  
  // Check for LLM provider
  const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;
  
  let llmProvider: string | null = null;
  if (hasOpenRouter) llmProvider = 'OpenRouter';
  else if (hasOpenAI) llmProvider = 'OpenAI';
  else if (hasAnthropic) llmProvider = 'Anthropic';
  
  return {
    initialized,
    hasLlm: hasOpenRouter || hasOpenAI || hasAnthropic,
    llmProvider,
  };
}
