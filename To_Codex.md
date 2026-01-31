Code Review: Summon CLI Project
Critical Issues (Fix Before Using)
1. Broken Module Exports in CLI Entry Point
File: src/cli/index.ts (lines 178-182)

export * from './llm.js';
export * from './config.js';
export * from './env.js';
export * from './memory.js';
export * from './scratchpad.js';
export * from './tools.js';
These files don't exist in /src/. The correct paths should be:

./runtime/llm.js (exists at src/runtime/llm.ts)
./runtime/config.js (exists at src/runtime/config.ts)
./runtime/env.js (exists at src/runtime/env.ts)
./runtime/memory.js (exists at src/runtime/memory.ts)
./runtime/scratchpad.js (exists at src/runtime/scratchpad.ts)
./runtime/tools.js (exists at src/runtime/tools.ts)
2. Non-existent Default Model
File: src/runtime/llm.ts (lines 28-30)

export const DEFAULT_PROVIDER = 'openai';
export const DEFAULT_MODEL = 'gpt-5.2';  // ❌ GPT-5 doesn't exist
const FAST_MODELS: Record<string, string> = {
  openai: 'gpt-4.1',  // ❌ Also doesn't exist
  anthropic: 'claude-haiku-4-5',  // ❌ Wrong format
  google: 'gemini-3-flash-preview',  // ❌ Doesn't exist
  xai: 'grok-4-1-fast-reasoning',  // ❌ Doesn't exist
};
The application will fail to initialize LLM calls with default config. Valid models: gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514, etc.

3. Duplicate Interface Definition
File: src/components/types.ts (lines 183-191 vs earlier definition)

export interface ToolCallRecord {  // Duplicate!
  tool: string;
  args: Record<string, unknown>;
  result: string;
}
This is defined twice - once around line 183 and earlier around line 159. The second definition may override the first.

4. Hardcoded Placeholder Model Names
File: src/cli/index.ts (lines 33, 37, 40, 43)

models.push({ provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' });  // Wrong format
models.push({ provider: 'google', model: 'gemini-3-pro-preview' });  // Doesn't exist
models.push({ provider: 'xai', model: 'grok-4-1-reasoning' });  // Doesn't exist
models.push({ provider: 'ollama', model: 'llama3' });  // Should be 'llama3.1' or similar
These model names will cause runtime failures when those providers are configured.

5. Missing Type Safety with Non-null Assertions
File: src/components/composed-agent.ts (line 72)

for (const toolCall of response.tool_calls!) {  // Non-null assertion
If response.tool_calls is undefined, this will throw. Should be:

for (const toolCall of response.tool_calls ?? []) {
6. Stub Implementation Being Used in Production
File: src/builtin/skills/finance/index.ts (entire file)
The createFinancialSearchTool() function creates stub tools that return random data instead of calling real APIs. This is misleading and will return fake financial data to users.

Minor Issues (Should Fix)
7. Unused Import
File: src/cli/index.ts (line 10)

import { ComposedAgentSpec } from '../components/composer.js';
ComposedAgentSpec is imported but only composeAgent and quickCompose are used from that module.

8. Inconsistent CLI Option Types
File: src/cli/index.ts

// Line 30: Inline type annotation
.action(async (query: string, options: { ritual?: string; model?: string; verbose?: boolean }) => {

// Line 82: Different inline type
.action(async (query: string, options: { persona: string; skills: string; model?: string; verbose?: boolean }) => {
Should define these as interfaces for consistency and reusability.

9. Console Logging in Non-CLI Code
File: src/runtime/llm.ts (line 33)

console.log(`  OpenAI-compatible: ${baseUrl}`);
LLM module shouldn't log to console - should use a logger interface for proper separation of concerns.

10. Silent Failure in YAML Parsing
File: src/components/registry.ts (line 130)

function loadYamlFile<T>(filepath: string): T | null {
  if (!existsSync(filepath)) return null;
  try {
    return parseYaml(readFileSync(filepath, 'utf-8')) as T;
  } catch (error) {
    console.error(`Failed to parse: ${filepath}`, error);  // Catches and logs but continues
    return null;
  }
}
If a YAML file is malformed, it silently returns null without throwing. This could hide configuration errors.

11. TODO Comments Left in Code
File: src/tools/index.ts (line 1)

/**
 * Financial Search Tool for Braddy
 * 
 * This module provides the financial_search tool by importing
 * and adapting the core logic from agent_brad.
 */
The comment mentions adapting from agent_brad but the implementation is stubbed. Either complete the integration or remove the comment.

12. Missing Error Handling in Finance Tool
File: src/builtin/skills/finance/index.ts (lines 160-175)

func: async ({ query }) => {
  const ticker = extractTicker(query) || 'AAPL';  // Defaults to AAPL silently
  const lowerQuery = query.toLowerCase();
  // Routes based on keywords - if no keywords match, defaults to price snapshot
No validation that the extracted ticker is valid, and no handling for unrecognized queries.

13. Inconsistent Ticker Extraction
File: src/builtin/skills/finance/index.ts (line 161)

const tickerMatch = query.match(/\b[A-Z]{1,5}\b/);  // Matches any 1-5 uppercase letters
This will incorrectly extract non-ticker words like "THIS", "PLEASE", "THANK" as tickers.

Suggestions (Nice to Have)
14. Missing Zod Schema Validation
File: src/components/registry.ts
The validateComposition() function returns { valid: true, errors: [] } unconditionally without actually validating that:

Referenced persona IDs exist
Referenced skill IDs exist
Required tools for skills are available
15. No Rate Limiting or Retry Logic for APIs
File: src/builtin/skills/finance/index.ts, src/builtin/skills/web-search/index.ts
API calls to Alpha Vantage, Tavily, and Exa have no retry logic or rate limiting. Alpha Vantage has strict rate limits (5 calls/minute on free tier).

16. No Input Sanitization
File: src/components/composed-agent.ts (buildFinalAnswerPrompt)
User query is inserted directly into prompts without sanitization, which could be exploited for prompt injection.

17. Magic Numbers in Code
File: src/components/composed-agent.ts (line 279)

if (!scratchpad.hasToolResults() && responseText) {
Magic number - should be MAX_ITERATIONS constant.

18. No Logging Framework
Throughout the codebase, console.log, console.error, console.warn are used directly. Consider using a proper logging library for production use.

19. Missing Unit Tests
No test files found in the project. For a CLI tool that executes external API calls, test coverage is important.

20. YAML Schema Not Versioned
Files: All YAML files
No $schema reference in YAML files for IDE support and validation:

# Example:
# $schema: https://json-schema.org/draft/2020-12/schema
Summary
Category	Count
Critical Issues	6
Minor Issues	6
Suggestions	7
Priority: Fix the 6 critical issues before using this codebase in production, particularly the broken module exports (will cause immediate runtime failure) and the non-existent model names.

Stats: runtime 1m35s • tokens 34.0k (in 26.1k / out 2.0k) • sessionKey agent:coding-agent:subagent:09f96011-a8a2-4912-ae94-80dfabcd8ce5 • sessionId 6050a8a9-ccae-4a87-a6d3-20488ef00037 • transcript /Users/river/.clawdbot/agents/coding-agent/sessions/6050a8a9-ccae-4a87-a6d3-20488ef00037.jsonl

Summarize this naturally for the user. Keep it brief (1-2 sentences). Flow it into the conversation naturally.
Do not mention technical details like tokens, stats, or that this was a background task.
You can respond with NO_REPLY if no announcement is needed (e.g., internal task with no user-facing result).