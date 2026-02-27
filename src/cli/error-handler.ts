#!/usr/bin/env bun
/**
 * Error Handler Module
 * Comprehensive error handling with recovery suggestions
 */

import { homedir } from 'os';
import { join } from 'path';

export type ErrorCategory = 
  | 'auth_missing'      // API key not set
  | 'auth_invalid'      // API key rejected
  | 'rate_limit'        // Too many requests
  | 'token_exhausted'   // Out of credits/quota
  | 'forbidden'         // 403 - permissions
  | 'not_found'         // 404 - endpoint/resource
  | 'timeout'           // Request timeout
  | 'network'           // Connection issues
  | 'validation'        // Invalid request format
  | 'tool_error'        // Tool execution failed
  | 'llm_error'         // LLM provider error
  | 'unknown';          // Unclassified

export interface SummonError {
  category: ErrorCategory;
  message: string;
  provider?: string;
  statusCode?: number;
  recoverable: boolean;
  suggestions: string[];
  autoFix?: () => Promise<boolean>;
}

// Error patterns for classification
const ERROR_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory; provider?: string }> = [
  // Auth errors
  { pattern: /api.*key.*(missing|required|not.*set)/i, category: 'auth_missing' },
  { pattern: /api.*key.*(invalid|incorrect|unauthorized|auth)/i, category: 'auth_invalid' },
  { pattern: /401|unauthorized/i, category: 'auth_invalid' },
  { pattern: /403|forbidden/i, category: 'forbidden' },
  
  // Rate limits
  { pattern: /429|rate.*limit|too.*many.*request/i, category: 'rate_limit' },
  { pattern: /quota.*exceeded|limit.*exceeded/i, category: 'rate_limit' },
  
  // Credits/tokens
  { pattern: /insufficient.*fund|out.*of.*credit|payment.*required/i, category: 'token_exhausted' },
  { pattern: /billing|quota.*exhausted|no.*quota/i, category: 'token_exhausted' },
  
  // Network
  { pattern: /timeout|timed.*out/i, category: 'timeout' },
  { pattern: /enetunreach|econnrefused|ENOTFOUND/i, category: 'network' },
  { pattern: /network.*error|connection.*failed/i, category: 'network' },
  
  // Not found
  { pattern: /404|not.*found/i, category: 'not_found' },
  
  // Validation
  { pattern: /400|bad.*request|validation/i, category: 'validation' },
  { pattern: /invalid.*(format|json|parameter)/i, category: 'validation' },
];

// Provider detection from error message or environment
const PROVIDER_PATTERNS: Array<{ pattern: RegExp; provider: string }> = [
  { pattern: /openai|gpt-|chatgpt/i, provider: 'openai' },
  { pattern: /anthropic|claude/i, provider: 'anthropic' },
  { pattern: /openrouter/i, provider: 'openrouter' },
  { pattern: /alphavantage/i, provider: 'alphavantage' },
  { pattern: /tavily/i, provider: 'tavily' },
  { pattern: /google|gemini/i, provider: 'google' },
];

function detectProvider(message: string): string | undefined {
  const lowerMessage = message.toLowerCase();
  
  // Check error message patterns
  for (const { pattern, provider } of PROVIDER_PATTERNS) {
    if (pattern.test(message) || pattern.test(lowerMessage)) {
      return provider;
    }
  }
  
  // Check which env vars are set
  if (process.env.OPENROUTER_API_KEY) return 'openrouter';
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  
  return undefined;
}

export function classifyError(error: Error | string): SummonError {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  // Find matching pattern
  let category: ErrorCategory = 'unknown';
  for (const { pattern, category: cat } of ERROR_PATTERNS) {
    if (pattern.test(message) || pattern.test(lowerMessage)) {
      category = cat;
      break;
    }
  }
  
  // Detect provider from message or environment
  const provider = detectProvider(message);
  
  // Build error object with suggestions
  return buildError(category, message, provider);
}

function buildError(
  category: ErrorCategory, 
  message: string, 
  provider?: string
): SummonError {
  const suggestions: string[] = [];
  let recoverable = true;
  
  switch (category) {
    case 'auth_missing':
      suggestions.push(
        `Set ${provider?.toUpperCase()}_API_KEY environment variable`,
        `Run: summon setup`,
        `Or: export ${provider?.toUpperCase()}_API_KEY=your_key`
      );
      recoverable = true;
      break;
      
    case 'auth_invalid':
      if (provider === 'openrouter') {
        suggestions.push(
          'Check your OpenRouter API key at https://openrouter.ai/keys',
          'Verify the model ID is correct (e.g., openai/gpt-4o-mini)',
          'Check model availability at https://openrouter.ai/models',
          'Update: summon setup'
        );
      } else {
        suggestions.push(
          `Check your ${provider} API key is correct`,
          `Get a new key at the provider dashboard`,
          `Update: summon setup`
        );
      }
      recoverable = true;
      break;
      
    case 'rate_limit':
      suggestions.push(
        `Wait a moment and retry`,
        `Use a different provider: --model anthropic/claude`,
        `Upgrade your plan for higher limits`
      );
      recoverable = true;
      break;
      
    case 'token_exhausted':
      suggestions.push(
        `Check your billing dashboard`,
        `Add credits to your account`,
        `Switch to a different provider`
      );
      recoverable = false;
      break;
      
    case 'forbidden':
      suggestions.push(
        `Check API key permissions`,
        `Ensure you have access to this model`,
        `Contact provider support`
      );
      recoverable = false;
      break;
      
    case 'timeout':
      suggestions.push(
        `Retry the request`,
        `Check your internet connection`,
        `Use --timeout flag to increase limit`
      );
      recoverable = true;
      break;
      
    case 'network':
      suggestions.push(
        `Check your internet connection`,
        `Verify firewall/proxy settings`,
        `Try again in a few moments`
      );
      recoverable = true;
      break;
      
    case 'validation':
      suggestions.push(
        `Check your query format`,
        `Verify ritual YAML is valid`,
        `Run with --verbose for details`
      );
      recoverable = true;
      break;
      
    case 'tool_error':
      suggestions.push(
        `Check tool parameters`,
        `Verify API key has required permissions`,
        `Try a simpler query`
      );
      recoverable = true;
      break;
      
    default:
      suggestions.push(
        `Run with --verbose for more details`,
        `Check logs: ~/.summon/logs/summon.log`,
        `Report issue: https://github.com/summon/summon/issues`
      );
      recoverable = false;
  }
  
  return {
    category,
    message: formatMessage(message, category, provider),
    provider,
    recoverable,
    suggestions,
  };
}

function formatMessage(original: string, category: ErrorCategory, provider?: string): string {
  const prefix = provider ? `[${provider}] ` : '';
  
  switch (category) {
    case 'auth_missing':
      return `${prefix}API key not configured`;
    case 'auth_invalid':
      return `${prefix}API key is invalid or expired`;
    case 'rate_limit':
      return `${prefix}Rate limit exceeded - too many requests`;
    case 'token_exhausted':
      return `${prefix}Out of credits/quota`;
    case 'forbidden':
      return `${prefix}Access forbidden - check permissions`;
    case 'timeout':
      return `${prefix}Request timed out`;
    case 'network':
      return `${prefix}Network error - check connection`;
    default:
      return prefix + original;
  }
}

// Pretty print error with formatting
export function printError(error: SummonError, verbose = false): void {
  console.error('');
  console.error('❌ Error');
  console.error('───────');
  console.error(`${error.message}`);
  
  if (verbose && error.provider) {
    console.error(`Provider: ${error.provider}`);
    console.error(`Category: ${error.category}`);
  }
  
  console.error('');
  console.error('💡 Suggestions:');
  for (const suggestion of error.suggestions) {
    console.error(`   • ${suggestion}`);
  }
  
  if (!error.recoverable) {
    console.error('');
    console.error('⚠️  This error requires manual intervention.');
  }
  
  console.error('');
}

// Wrap async function with error handling
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  options: { verbose?: boolean; retries?: number } = {}
): Promise<T | null> {
  const { verbose = false, retries = 0 } = options;
  let lastError: SummonError | null = null;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const summonError = classifyError(err as Error);
      lastError = summonError;
      
      if (verbose || attempt === 0) {
        printError(summonError, verbose);
      }
      
      // Don't retry non-recoverable errors
      if (!summonError.recoverable) {
        break;
      }
      
      // Retry with backoff
      if (attempt < retries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`Retrying in ${delay / 1000}s... (attempt ${attempt + 1}/${retries + 1})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  return null;
}

// Specific error checkers
export function isAuthError(error: unknown): boolean {
  const classified = classifyError(error as Error);
  return classified.category === 'auth_missing' || classified.category === 'auth_invalid';
}

export function isRateLimit(error: unknown): boolean {
  const classified = classifyError(error as Error);
  return classified.category === 'rate_limit';
}

export function isRetryable(error: unknown): boolean {
  const classified = classifyError(error as Error);
  return classified.recoverable;
}