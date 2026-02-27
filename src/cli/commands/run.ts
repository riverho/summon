#!/usr/bin/env bun
/**
 * Run Command - Enhanced CLI for executing rituals
 * 
 * Supports:
 * - Registry mode: @author/name[@version]
 * - Local file mode: --ritual ./path.yaml or summon://path
 * 
 * Usage:
 *   summon run @river/stock-checker --symbol AAPL
 *   summon run @river/stock-checker@v1.0.0 --symbol AAPL
 *   summon run --ritual ./local-agent.yaml "query"
 */

import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fetchRitualByRef, parseRitualRef, RegistryClientError } from '../../registry/client.js';
import { 
  getCachedRitualByComponents, 
  cacheRitualByComponents 
} from '../../registry/cache.js';
import { parseRitualYaml, validateRitual, RitualParseError, RitualValidationError } from '../../ritual/loader.js';
import type { Ritual } from '../../ritual/types.js';
import { resolveTools, getToolInstances, initializeToolResolver } from '../../tools/resolver.js';
import { resolvePath } from '../../components/registry.js';
import { composeAgent, quickCompose, type ComposedAgentSpec } from '../../components/composer.js';
import { ComposedAgent } from '../../components/composed-agent.js';
import { ChatHistoryManager } from '../../runtime/chat-history.js';
import { globalToolRegistry } from '../../runtime/tools.js';
import { registerExternalTools } from '../../runtime/tool-loader.js';
import { classifyError, printError, isAuthError } from '../error-handler.js';
import { preFlightCheck, promptForSetup, runInteractiveSetup } from '../preflight.js';
import { runFormalSetup, isFirstRun } from '../setup-formal.js';
import { executeRitual } from '../../runtime/engine.js';
import { 
  loadSteeringPreferences, 
  saveSteeringPreferences,
  formatExecutionTrace,
  loadExecutionTraces,
} from '../../gap-chat/steering.js';
import type { ExecutionMode } from '../../gap-chat/steering.js';

// ============================================================================
// Types
// ============================================================================

interface RunOptions {
  ritual?: string;
  model?: string;
  persona?: string;
  session?: string;
  sessionAuto?: boolean;
  newSession?: boolean;
  continue?: boolean;
  quiet?: boolean;
  json?: boolean;
  verbose?: boolean;
  interactive?: boolean;
  review?: boolean;
}

interface RitualSource {
  type: 'registry' | 'local';
  ref: string;
  yaml: string;
  metadata?: {
    author: string;
    name: string;
    version: string;
  };
}

// ============================================================================
// Constants
// ============================================================================

const FOLLOW_UP_KEYWORDS = [
  'it', 'that', 'this', 'also', 'compare',
  'and', 'but', 'what about', 'next',
  'continue', 'more', 'deeper', 'explain',
  'then', 'further', 'additionally'
];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if a string is a registry reference (starts with @)
 */
function isRegistryRef(ref: string): boolean {
  return ref.startsWith('@');
}

/**
 * Fetch ritual from registry with caching
 */
async function fetchRitualWithCache(ref: string): Promise<RitualSource> {
  const { author, name, version } = parseRitualRef(ref);
  const requestedVersion = version || 'latest';
  
  // Try cache first (for versioned rituals)
  if (version) {
    const cached = getCachedRitualByComponents(author, name, version);
    if (cached) {
      return {
        type: 'registry',
        ref,
        yaml: cached,
        metadata: { author, name, version }
      };
    }
  }

  // Fetch from registry
  try {
    const ritual = await fetchRitualByRef(ref, { skipCache: false });
    
    // Cache the result (use actual version from metadata)
    const cacheVersion = ritual.metadata.version;
    cacheRitualByComponents(author, name, cacheVersion, ritual.yaml);
    
    return {
      type: 'registry',
      ref,
      yaml: ritual.yaml,
      metadata: {
        author: ritual.metadata.author,
        name: ritual.metadata.name,
        version: ritual.metadata.version
      }
    };
  } catch (error) {
    if (error instanceof RegistryClientError) {
      if (error.isNotFound()) {
        throw new Error(`Ritual not found: ${ref}\n  Check the author/name and try again.`);
      }
      if (error.isAuthError()) {
        throw new Error(`Registry authentication failed: ${error.message}`);
      }
    }
    throw error;
  }
}

/**
 * Load ritual from local file
 */
function loadLocalRitual(filePath: string): RitualSource {
  const resolvedPath = resolvePath(filePath);
  
  if (!existsSync(resolvedPath)) {
    throw new Error(`Ritual file not found: ${filePath}\n  Resolved: ${resolvedPath}`);
  }

  try {
    const yaml = readFileSync(resolvedPath, 'utf-8');
    return {
      type: 'local',
      ref: filePath,
      yaml
    };
  } catch (error) {
    throw new Error(`Failed to read ritual file: ${filePath}\n  ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Resolve ritual source from reference or file path
 */
async function resolveRitualSource(ritualArg: string): Promise<RitualSource> {
  if (isRegistryRef(ritualArg)) {
    return fetchRitualWithCache(ritualArg);
  }
  return loadLocalRitual(ritualArg);
}

/**
 * Parse and validate ritual YAML
 */
function parseAndValidateRitual(yaml: string, source: RitualSource): Ritual {
  try {
    const parsed = parseRitualYaml(yaml);
    validateRitual(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof RitualParseError) {
      throw new Error(`Failed to parse ritual YAML from ${source.ref}:\n  ${error.message}`);
    }
    if (error instanceof RitualValidationError) {
      const issues = error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Ritual validation failed for ${source.ref}:\n${issues}`);
    }
    throw error;
  }
}

/**
 * Convert Ritual to AgentComposition format
 */
function ritualToComposition(ritual: Ritual, overrides: { model?: string; persona?: string } = {}) {
  // Build behavior if present
  const behavior = ritual.persona.behavior ? {
    style: (ritual.persona.behavior.style as 'formal' | 'casual' | 'technical' | 'professional') || 'professional',
    priorities: ritual.persona.behavior.priorities || [],
    avoidances: []
  } : undefined;

  return {
    name: ritual.name,
    version: ritual.version,
    description: ritual.description,
    persona: overrides.persona 
      ? { $ref: overrides.persona }
      : {
          role: ritual.persona.role,
          goal: ritual.persona.goal || '',
          backstory: ritual.persona.backstory || '',
          behavior
        },
    skills: ritual.skills.map(s => ({
      $ref: s.$ref,
      config: s.config
    })),
    model: {
      primary: overrides.model || ritual.model.primary,
      fallback: ritual.model.fallback,
      provider: 'openai',
      maxIterations: 10
    }
  };
}

/**
 * Resolve tools from ritual skills
 */
function resolveRitualTools(ritual: Ritual): ReturnType<typeof resolveTools> {
  // Get skill refs from ritual
  const skillRefs = ritual.skills.map(s => s.$ref);
  
  // Define skill-to-tool mapping
  const skillToolMapping: Record<string, string[]> = {
    'finance': ['financial_search'],
    'web': ['web_search'],
    'web-search': ['web_search'],
    'file': ['file_read', 'file_write'],
    'search': ['web_search', 'financial_search'],
    'crypto': ['crypto_price'],
    'stocks': ['financial_search'],
  };

  // Collect all required tools
  const toolNames: string[] = [];
  for (const skillRef of skillRefs) {
    const tools = skillToolMapping[skillRef] || [];
    toolNames.push(...tools);
  }

  // Resolve tools from registry
  return resolveTools(toolNames);
}

/**
 * Check if query is a follow-up
 */
function isFollowUpQuery(query: string): boolean {
  return FOLLOW_UP_KEYWORDS.some(kw => 
    query.toLowerCase().includes(kw.toLowerCase())
  );
}

/**
 * Determine session ID based on options
 */
async function determineSessionId(options: RunOptions, query: string): Promise<string | undefined> {
  if (options.newSession) {
    return undefined; // Fresh session
  }
  
  if (options.session) {
    return options.session;
  }
  
  if (options.sessionAuto || (options.continue && isFollowUpQuery(query))) {
    const sessions = await ChatHistoryManager.listSessions();
    if (sessions.length > 0) {
      return sessions[0];
    }
  }
  
  return undefined;
}

// ============================================================================
// Main Run Function
// ============================================================================

export async function executeRun(
  ritualArg: string,
  query: string,
  options: RunOptions
): Promise<void> {
  // Determine execution mode
  let mode: ExecutionMode = 'autonomous';
  if (options.interactive) {
    mode = 'interactive';
  } else if (options.review) {
    mode = 'review';
  }

  // Handle review mode (post-hoc analysis)
  if (options.review) {
    await executeReviewMode(ritualArg);
    return;
  }

  // Check for first run
  let justCompletedSetup = false;
  if (isFirstRun() && !options.quiet) {
    console.log('🦞 First run detected. Setting up summon...\n');
    const setupResult = await runFormalSetup({ ritualPath: ritualArg, skipIfExists: false });
    if (!setupResult.configured.llm) {
      console.error('❌ Setup incomplete. Please configure an LLM provider.');
      process.exit(1);
    }
    justCompletedSetup = true;
    console.log('\n🔄 Continuing with your query...\n');
  }

  // Initialize tools
  await initializeToolResolver();
  await registerExternalTools({ override: true });

  // Resolve ritual source
  if (!options.quiet && !options.json) {
    console.log(`Resolving ritual: ${ritualArg}`);
  }

  let source: RitualSource;
  try {
    source = await resolveRitualSource(ritualArg);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!options.quiet && !options.json) {
    if (source.type === 'registry' && source.metadata) {
      console.log(`  ↳ Registry: ${source.metadata.author}/${source.metadata.name}@${source.metadata.version}`);
    } else {
      console.log(`  ↳ Local: ${resolvePath(source.ref)}`);
    }
  }

  // Parse and validate ritual
  let ritual: Ritual;
  try {
    ritual = parseAndValidateRitual(source.yaml, source);
  } catch (error) {
    console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!options.quiet && !options.json) {
    console.log(`✓ Loaded: ${ritual.name} v${ritual.version}`);
  }

  // Pre-flight check (skip if just completed setup)
  if (!options.quiet && !justCompletedSetup && source.type === 'local') {
    const check = await preFlightCheck(source.ref);
    
    if (!check.ok) {
      const action = await promptForSetup(check.missing);
      
      if (action === 'cancel') {
        console.log('\n❌ Cancelled');
        process.exit(0);
      }
      
      if (action === 'setup') {
        await runInteractiveSetup(check.missing);
        
        // Re-check after setup
        const recheck = await preFlightCheck(source.ref);
        if (!recheck.ok) {
          console.log('\n⚠️  Setup incomplete. Continuing with limited functionality.\n');
        } else {
          console.log('\n✅ All systems ready!\n');
        }
      }
      
      if (action === 'continue') {
        console.log('\n⚠️  Continuing without tools (limited results).\n');
      }
    }
  }

  // Determine session
  const sessionId = await determineSessionId(options, query);

  if (!options.quiet && !options.json) {
    console.log(`\n🦞 Summoning: ${ritual.persona.role}`);
    if (sessionId) {
      console.log(`   Session: ${sessionId}`);
    }
    if (isFollowUpQuery(query) && sessionId) {
      console.log(`   [Follow-up detected]`);
    }
    console.log(`   Mode: ${mode}`);
    console.log(`   Query: ${query}\n`);
  }

  // Load steering preferences
  const ritualId = source.type === 'registry' && source.metadata 
    ? `@${source.metadata.author}/${source.metadata.name}`
    : ritual.name;
  const steeringPreferences = loadSteeringPreferences(ritualId);

  // Execute using the engine
  try {
    const result = await executeRitual(ritual, {
      query,
      options: {
        model: options.model,
        sessionId,
        verbose: options.verbose,
        streaming: !options.quiet,
        quiet: options.quiet,
        mode,
      },
      steeringPreferences,
    });

    // Output result
    if (options.json) {
      console.log(JSON.stringify({
        answer: result.output,
        status: result.status,
        iterations: result.iterations,
        toolsUsed: result.toolsUsed,
        sessionId,
        ritual: source.type === 'registry' ? source.ref : undefined,
        mode,
      }, null, 2));
    } else if (options.quiet) {
      console.log(result.output);
    } else {
      console.log(result.output);
      if (options.verbose) {
        console.log(`\n[Completed in ${result.iterations} iteration(s), ${result.toolsUsed.length} tool call(s), mode: ${mode}]`);
      }
    }

    // Save steering preferences if in interactive mode
    if (mode === 'interactive' && !options.json) {
      console.log('\n💡 Preferences for this ritual can be adjusted using:');
      console.log(`   summon run ${ritualArg} "query" --interactive`);
    }

  } catch (error) {
    const summonError = classifyError(error as Error);
    printError(summonError, options.verbose);
    
    if (summonError.recoverable) {
      console.log('\n💡 This error may be temporary. Try again.');
    }
    
    process.exit(1);
  }
}

// ============================================================================
// Review Mode
// ============================================================================

/**
 * Execute review mode - show execution traces for a ritual
 */
async function executeReviewMode(ritualArg: string): Promise<void> {
  console.log(`\n🔍 Review Mode: ${ritualArg}\n`);
  
  // Load execution traces
  const traces = loadExecutionTraces(ritualArg, 10);
  
  if (traces.length === 0) {
    console.log('No execution traces found for this ritual.');
    console.log('\nTo start collecting traces, run with --interactive or --review:');
    console.log(`   summon run ${ritualArg} "query" --interactive`);
    return;
  }
  
  console.log(`Showing last ${traces.length} execution(s):\n`);
  console.log('─'.repeat(70));
  
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    console.log(`\n#${i + 1} ${formatExecutionTrace(trace)}`);
    
    // Show reasoning path highlights
    if (trace.traces.length > 0) {
      console.log('\n   Reasoning path:');
      const reasoningSteps = trace.traces
        .filter(t => t.type === 'thinking' || t.type === 'tool_start')
        .slice(0, 5);
      
      for (const step of reasoningSteps) {
        if (step.type === 'thinking' && step.message) {
          console.log(`      → ${step.message.slice(0, 60)}${step.message.length > 60 ? '...' : ''}`);
        } else if (step.type === 'tool_start' && step.tool) {
          console.log(`      → [Tool] ${step.tool}`);
        }
      }
    }
    
    if (trace.steeringPreferences) {
      console.log(`\n   Steering preferences:`);
      console.log(`      Framework: ${trace.steeringPreferences.framework}`);
      console.log(`      Output style: ${trace.steeringPreferences.outputStyle.length}, ${trace.steeringPreferences.outputStyle.format}`);
      if (trace.steeringPreferences.reflectionPoints.length > 0) {
        console.log(`      Reflection points: ${trace.steeringPreferences.reflectionPoints.join(', ')}`);
      }
    }
    
    console.log('\n' + '─'.repeat(70));
  }
  
  // Summary statistics
  const successfulTraces = traces.filter(t => t.status === 'success');
  const avgIterations = traces.reduce((sum, t) => sum + t.iterations, 0) / traces.length;
  const avgDuration = traces.reduce((sum, t) => sum + t.duration, 0) / traces.length;
  
  console.log('\n📊 Summary:');
  console.log(`   Total runs: ${traces.length}`);
  console.log(`   Success rate: ${Math.round((successfulTraces.length / traces.length) * 100)}%`);
  console.log(`   Avg iterations: ${avgIterations.toFixed(1)}`);
  console.log(`   Avg duration: ${(avgDuration / 1000).toFixed(1)}s`);
  
  // Framework usage
  const frameworkUsage = new Map<string, number>();
  for (const trace of traces) {
    if (trace.steeringPreferences) {
      const fw = trace.steeringPreferences.framework;
      frameworkUsage.set(fw, (frameworkUsage.get(fw) || 0) + 1);
    }
  }
  
  if (frameworkUsage.size > 0) {
    console.log('\n   Frameworks used:');
    for (const [fw, count] of frameworkUsage) {
      console.log(`      ${fw}: ${count} runs`);
    }
  }
  
  console.log('\n💡 To set preferences for future runs:');
  console.log(`   summon run ${ritualArg} "query" --interactive`);
}

// ============================================================================
// Command Definition
// ============================================================================

export function createRunCommand(): Command {
  const command = new Command('run');
  
  command
    .description('Run a ritual from registry (@author/name) or local file')
    .argument('<ritual-or-query>', 'Registry ref (@author/name), ritual path, or query (with --ritual)')
    .argument('[query]', 'The query to run (if first arg is ritual path)')
    .option('-r, --ritual <path>', 'Path to YAML ritual file (for local mode)')
    .option('-m, --model <model>', 'Override the model (e.g., openrouter/deepseek-r1:free)')
    .option('-p, --persona <id>', 'Override persona by ID')
    .option('--session <id>', 'Session ID for multi-turn conversations')
    .option('--session-auto', 'Automatically use the most recent session')
    .option('--new-session', 'Start a fresh session (ignores previous sessions)')
    .option('--continue', 'Continue the most recent session (auto-detects follow-up)')
    .option('-q, --quiet', 'Minimal output (just the answer)')
    .option('--json', 'Output in JSON format for programmatic use')
    .option('-v, --verbose', 'Show verbose output including tool calls')
    .option('-i, --interactive', 'Enable Gap Chat steering (interactive mode)')
    .option('--review', 'Show execution traces for post-hoc analysis')
    .action(async (arg1: string, arg2: string | undefined, options: RunOptions) => {
      // Determine if first arg is ritual ref or query
      let ritualArg: string;
      let query: string;
      
      if (options.ritual) {
        // --ritual flag provided: arg1 is query
        ritualArg = options.ritual;
        query = arg1;
      } else if (isRegistryRef(arg1)) {
        // First arg is registry reference
        ritualArg = arg1;
        query = arg2 || '';
      } else if (arg1.endsWith('.yaml') || arg1.endsWith('.yml') || arg1.startsWith('summon://')) {
        // First arg looks like a file path
        ritualArg = arg1;
        query = arg2 || '';
      } else if (options.review) {
        // Review mode - first arg is the ritual ref
        ritualArg = arg1;
        query = '';
      } else {
        // No ritual specified, treat as error
        console.error('Error: No ritual specified.');
        console.log('\nUsage:');
        console.log('  summon run @author/name "your query"');
        console.log('  summon run --ritual ./path.yaml "your query"');
        console.log('  summon run @author/name@version "your query"');
        process.exit(1);
      }

      // Review mode doesn't require a query
      if (!options.review && !query.trim()) {
        console.error('Error: Query is required');
        process.exit(1);
      }

      await executeRun(ritualArg, query, options);
    });

  return command;
}

export default createRunCommand;
