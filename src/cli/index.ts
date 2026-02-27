#!/usr/bin/env bun

import { Command } from 'commander';
import { config } from 'dotenv';
import { join } from 'path';
import { homedir } from 'os';
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
import { registerExternalTools, listExternalToolFiles } from '../runtime/tool-loader.js';
import { ChatHistoryManager, generateSessionId } from '../runtime/chat-history.js';
import { AgentOrchestrator } from '../orchestration/orchestrator.js';
import { createStorageAdapter } from '../storage/index.js';
import { parse as parseYaml } from 'yaml';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, extname } from 'path';
import { preFlightCheck, promptForSetup, runInteractiveSetup } from './preflight.js';
import { classifyError, printError, withErrorHandling, isAuthError } from './error-handler.js';
import { runFormalSetup, isFirstRun, SUMMON_DIR, ENV_PATH } from './setup-formal.js';
import { executeRun } from './commands/run.js';
import { 
  loadExecutionTraces, 
  formatExecutionTrace,
  loadSteeringPreferences,
  saveSteeringPreferences,
} from '../gap-chat/steering.js';

// Load environment variables from ~/.summon/.env first, then fallback to repo .env
const userEnvPath = join(homedir(), '.summon', '.env');
if (existsSync(userEnvPath)) {
  config({ path: userEnvPath, quiet: true });
}
// Also load repo .env as fallback
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

  if (process.env.OPENROUTER_API_KEY) {
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
    models.push({ provider: 'openrouter', model, baseUrl: 'https://openrouter.ai/api/v1' });
  }

  if (process.env.OPENAI_API_KEY) {
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    models.push({ provider: 'openai', model: process.env.OPENAI_MODEL || 'gpt-4o-mini', baseUrl });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const baseUrl = process.env.ANTHROPIC_BASE_URL;
    models.push({ provider: 'anthropic', model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514', baseUrl });
  }

  if (process.env.GOOGLE_API_KEY) {
    models.push({ provider: 'google', model: process.env.GOOGLE_MODEL || 'gemini-2.5-pro' });
  }

  if (process.env.XAI_API_KEY) {
    models.push({ provider: 'xai', model: process.env.XAI_MODEL || 'grok-3', baseUrl: 'https://api.x.ai/v1' });
  }

  if (process.env.OLLAMA_BASE_URL) {
    models.push({ provider: 'ollama', model: process.env.OLLAMA_MODEL || 'llama3.3', baseUrl: process.env.OLLAMA_BASE_URL });
  }

  return models;
}

const program = new Command();

program
  .name('summon')
  .description('Summon composable agents with portable YAML rituals')
  .version('0.1.0');

// ============================================================================
// Summon Command (from YAML ritual or registry)
// ============================================================================

program
  .command('run')
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
  .action(async (arg1: string, arg2: string | undefined, options: { 
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
  }) => {
    // Determine if first arg is ritual ref or query
    let ritualArg: string;
    let query: string;
    
    if (options.ritual) {
      // --ritual flag provided: arg1 is query
      ritualArg = options.ritual;
      query = arg1;
    } else if (arg1.startsWith('@')) {
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

    // Delegate to the new run implementation
    await executeRun(ritualArg, query, options);
  });

// ============================================================================
// Review Command (post-hoc analysis of execution traces)
// ============================================================================

program
  .command('review')
  .description('Review execution traces for a ritual (post-hoc analysis)')
  .argument('<ritual-ref>', 'Ritual reference (@author/name)')
  .option('-n, --limit <num>', 'Number of traces to show', '10')
  .option('--json', 'Output in JSON format')
  .action((ritualRef: string, options: { limit: string; json?: boolean }) => {
    const limit = parseInt(options.limit, 10);
    const traces = loadExecutionTraces(ritualRef, limit);
    
    if (traces.length === 0) {
      console.log('No execution traces found for this ritual.');
      console.log('\nTo start collecting traces, run with --interactive or --review:');
      console.log(`   summon run ${ritualRef} "query" --interactive`);
      return;
    }
    
    if (options.json) {
      console.log(JSON.stringify(traces, null, 2));
      return;
    }
    
    console.log(`\n🔍 Review Mode: ${ritualRef}`);
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
    console.log(`   summon run ${ritualRef} "query" --interactive`);
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
  .option('--session <id>', 'Session ID for multi-turn conversations')
  .option('--new-session', 'Start a fresh session (ignores previous sessions)')
  .option('-v, --verbose', 'Show verbose output')
  .action(async (query: string, options: { persona: string; skills: string; model?: string; session?: string; newSession?: boolean; verbose?: boolean }) => {
    const registry = createComponentRegistry();
    const skillIds = options.skills.split(',').map(s => s.trim());

    // Determine session
    let sessionId: string | undefined;
    if (options.newSession) {
      sessionId = undefined; // Fresh session
    } else if (options.session) {
      sessionId = options.session;
    }

    // Initialize chat history
    const chatHistory = new ChatHistoryManager({ sessionId });
    if (sessionId) {
      await chatHistory.load();
    }

    console.log(`Composing: persona=${options.persona}, skills=${skillIds.join(', ')}`);
    if (chatHistory.hasMessages()) {
      console.log(`Session: ${chatHistory.getSessionId()} (${chatHistory.getMessages().length} previous messages)`);
    }
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

    // Save user query to chat history
    chatHistory.saveUserQuery(query);

    const toolCalls: string[] = [];
    let iterations = 0;

    for await (const event of agent.run(query, undefined, chatHistory.getSessionId())) {
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
        case 'done':
          console.log(event.answer);
          iterations = event.iterations;
          toolCalls.length = 0;
          for (const tc of event.toolCalls) {
            toolCalls.push(tc.tool);
          }
          break;
      }
    }

    // Save answer to chat history and persist
    const lastEvent = agent.getLastEvent?.();
    if (lastEvent && lastEvent.type === 'done') {
      chatHistory.saveAnswer(lastEvent.answer, {
        model: spec.model,
        iterations,
        toolsUsed: toolCalls,
      });
      await chatHistory.save();
      console.log(`\n[Session saved: ${chatHistory.getSessionId()}]`);
    }
  });

// ============================================================================
// Orchestration Commands
// ============================================================================

type OrchestrationCommandOptions = {
  verbose?: boolean;
  json?: boolean;
  quiet?: boolean;
  session?: string;
  newSession?: boolean;
};

async function runOrchestrationConfig(
  parsedConfig: unknown,
  query: string,
  options: OrchestrationCommandOptions,
  sessionSummary: string
): Promise<void> {
  const orchestrator = AgentOrchestrator.fromObject(parsedConfig);
  await orchestrator.initialize();

  const storage = createStorageAdapter();
  const sessionId = options.newSession ? generateSessionId() : (options.session ?? generateSessionId());

  await storage.writeEvent(sessionId, {
    timestamp: new Date().toISOString(),
    type: 'user',
    payload: { query },
  });

  const events: any[] = [];
  let finalResult = '';

  for await (const ev of orchestrator.run(query)) {
    events.push(ev);

    await storage.writeEvent(sessionId, {
      timestamp: new Date().toISOString(),
      type: 'system',
      payload: { kind: 'orchestration_event', event: ev },
    });

    if (options.verbose && !options.json && !options.quiet) {
      if (ev.type === 'agent_start') console.log(`[agent_start] ${ev.agentId}`);
      if (ev.type === 'agent_done') console.log(`[agent_done] ${ev.agentId}`);
      if (ev.type === 'handoff') console.log(`[handoff] ${ev.from} -> ${ev.to}`);
    }
    if (ev.type === 'orchestration_done') {
      finalResult = ev.result;
    }
  }

  await storage.writeEvent(sessionId, {
    timestamp: new Date().toISOString(),
    type: 'assistant',
    payload: {
      answer: finalResult,
      summary: sessionSummary,
      metadata: {
        model: 'orchestrator',
        iterations: 0,
        toolsUsed: [],
      },
    },
  });

  if (options.json) {
    console.log(JSON.stringify({ result: finalResult, events, sessionId }, null, 2));
    return;
  }

  if (options.quiet) {
    console.log(finalResult);
    return;
  }

  console.log(finalResult);
  console.log(`\n[Session saved: ${sessionId}]`);
}

program
  .command('parallel')
  .description('Run multiple agent rituals in parallel without creating a team YAML')
  .argument('<query>', 'The task/query to run')
  .requiredOption('--agents <paths>', 'Comma-separated agent ritual YAML paths')
  .option('-m, --model <model>', 'Override model for all parallel agents')
  .option('-v, --verbose', 'Show per-agent events')
  .option('--json', 'Output JSON')
  .option('-q, --quiet', 'Minimal output (just the answer)')
  .option('--session <id>', 'Persist this orchestration run under a session id')
  .option('--new-session', 'Force a new persisted session id')
  .action(async (query: string, options: {
    agents: string;
    model?: string;
    verbose?: boolean;
    json?: boolean;
    quiet?: boolean;
    session?: string;
    newSession?: boolean;
  }) => {
    const ritualPaths = options.agents
      .split(',')
      .map(path => path.trim())
      .filter(Boolean)
      .map(path => resolvePath(path));

    // Validate that all ritual files exist
    for (const path of ritualPaths) {
      if (!existsSync(path)) {
        console.error(`Error: Ritual file not found: ${path}`);
        process.exit(1);
      }
    }

    if (ritualPaths.length === 0) {
      console.error('Error: --agents must include at least one ritual path');
      process.exit(1);
    }

    const usedIds = new Set<string>();
    const makeAgentId = (ritualPath: string, index: number): string => {
      const base = basename(ritualPath, extname(ritualPath))
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || `agent-${index + 1}`;

      if (!usedIds.has(base)) {
        usedIds.add(base);
        return base;
      }

      let suffix = 2;
      let candidate = `${base}-${suffix}`;
      while (usedIds.has(candidate)) {
        suffix += 1;
        candidate = `${base}-${suffix}`;
      }
      usedIds.add(candidate);
      return candidate;
    };

    const parallelConfig = {
      name: 'parallel-cli-team',
      version: '1.0.0',
      description: 'Ad-hoc parallel team generated by summon parallel',
      orchestration: {
        pattern: 'parallel' as const,
        maxAgents: Math.max(ritualPaths.length, 1),
        maxIterations: 20,
        timeoutMs: 120_000,
      },
      agents: ritualPaths.map((ritualPath, index) => ({
        id: makeAgentId(ritualPath, index),
        ritual: ritualPath,
        ...(options.model ? { model: { primary: options.model } } : {}),
      })),
      output: {
        format: 'markdown' as const,
        aggregator: 'concatenate' as const,
      },
    };

    await runOrchestrationConfig(
      parallelConfig,
      query,
      options,
      `Parallel orchestration result (${ritualPaths.join(', ')})`
    );
  });

program
  .command('orchestrate')
  .description('Run a multi-agent team from a YAML config')
  .argument('<teamYaml>', 'Path to team YAML (supports summon:// prefix)')
  .argument('<query>', 'The task/query to run')
  .option('-v, --verbose', 'Show per-agent events')
  .option('--json', 'Output JSON')
  .option('-q, --quiet', 'Minimal output (just the answer)')
  .option('--session <id>', 'Persist this orchestration run under a session id')
  .option('--new-session', 'Force a new persisted session id')
  .action(async (teamYaml: string, query: string, options: OrchestrationCommandOptions) => {
    const resolved = resolvePath(teamYaml);
    const raw = readFileSync(resolved, 'utf-8');
    const parsed = parseYaml(raw);

    await runOrchestrationConfig(parsed, query, options, `Orchestration result (${resolved})`);
  });

const teams = program
  .command('teams')
  .description('List and run example multi-agent teams');

teams
  .command('list')
  .description('List team YAML files in examples/teams')
  .action(() => {
    const teamsDir = resolvePath('summon://examples/teams');
    if (!existsSync(teamsDir)) {
      console.log(`No teams directory found: ${teamsDir}`);
      return;
    }

    const teamFiles = readdirSync(teamsDir)
      .filter(file => file.endsWith('.yaml') || file.endsWith('.yml'))
      .sort((a, b) => a.localeCompare(b));

    if (teamFiles.length === 0) {
      console.log('No team YAML files found in examples/teams');
      return;
    }

    console.log('Teams:');
    for (const file of teamFiles) {
      const name = file.replace(/\.(yaml|yml)$/i, '');
      console.log(`  - ${name} (${file})`);
    }
  });

teams
  .command('run <teamName> <query>')
  .description('Run a team from examples/teams by name')
  .option('-v, --verbose', 'Show per-agent events')
  .option('--json', 'Output JSON')
  .option('-q, --quiet', 'Minimal output (just the answer)')
  .option('--session <id>', 'Persist this orchestration run under a session id')
  .option('--new-session', 'Force a new persisted session id')
  .action(async (teamName: string, query: string, options: OrchestrationCommandOptions) => {
    const normalizedTeamName = teamName.replace(/\.(yaml|yml)$/i, '');
    const candidatePaths = [
      `summon://examples/teams/${normalizedTeamName}.yaml`,
      `summon://examples/teams/${normalizedTeamName}.yml`,
    ];

    const resolved = candidatePaths
      .map(path => resolvePath(path))
      .find(path => existsSync(path));

    if (!resolved) {
      console.error(`Error: Team not found: ${teamName}`);
      console.log('Run `summon teams list` to see available team names.');
      process.exit(1);
    }

    const raw = readFileSync(resolved, 'utf-8');
    const parsed = parseYaml(raw);

    await runOrchestrationConfig(parsed, query, options, `Team run result (${normalizedTeamName})`);
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

program
  .command('tools')
  .description('List registered tools and external tool files')
  .option('-e, --external', 'Show external tool file paths')
  .action((options: { external?: boolean }) => {
    console.log('Registered Tools:');
    for (const name of globalToolRegistry.getNames()) {
      console.log(`  - ${name}`);
    }

    if (options.external) {
      console.log('\nExternal Tool Files:');
      const externalFiles = listExternalToolFiles();
      if (externalFiles.length === 0) {
        console.log('  (none found)');
        console.log('\nExternal tools directory:');
        console.log('  ~/.summon/components/tools/');
      } else {
        for (const file of externalFiles) {
          console.log(`  - ${file}`);
        }
      }
    }
  });

// ============================================================================
// Sessions Commands
// ============================================================================

const sessionsCmd = program
  .command('sessions')
  .description('Manage chat sessions');

sessionsCmd
  .command('list')
  .description('List all sessions')
  .action(async () => {
    const sessions = await ChatHistoryManager.listSessions();
    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }
    console.log('Sessions:\n');
    for (const sessionId of sessions) {
      console.log(`  - ${sessionId}`);
    }
  });

sessionsCmd
  .command('show <sessionId>')
  .description('Show session content')
  .option('--events', 'Also print stored system/orchestration events (raw)')
  .action(async (sessionId: string, options: { events?: boolean }) => {
    const history = await ChatHistoryManager.getSession(sessionId);
    if (!history) {
      console.log(`Session not found: ${sessionId}`);
      return;
    }
    console.log(`Session: ${sessionId}`);
    console.log(`Created: ${history.createdAt}`);
    console.log(`Last used: ${history.lastUsed}`);
    console.log(`Messages: ${history.messages.length}\n`);
    for (const msg of history.messages) {
      if (msg.role === 'user') {
        console.log(`[${msg.id}] USER: ${msg.query}`);
        if (msg.answer) {
          console.log(`    → ${msg.summary}`);
        }
      }
    }

    if (options.events) {
      const storage = createStorageAdapter();
      const events = await storage.readEvents(sessionId);
      const systemEvents = events.filter(e => e.type === 'system');

      console.log('\n---\nEvents (system):');
      if (systemEvents.length === 0) {
        console.log('  (none)');
        return;
      }

      for (const ev of systemEvents) {
        console.log(JSON.stringify(ev, null, 2));
      }
    }
  });

sessionsCmd
  .command('clear <sessionId>')
  .description('Clear session messages (keep file)')
  .action(async (sessionId: string) => {
    const cleared = await ChatHistoryManager.clearSession(sessionId);
    if (!cleared) {
      console.log(`Session not found: ${sessionId}`);
      return;
    }
    console.log(`Session cleared: ${sessionId}`);
  });

sessionsCmd
  .command('delete <sessionId>')
  .description('Delete a session file')
  .action(async (sessionId: string) => {
    const deleted = await ChatHistoryManager.deleteSession(sessionId);
    if (deleted) {
      console.log(`Session deleted: ${sessionId}`);
    } else {
      console.log(`Session not found: ${sessionId}`);
    }
  });

// ============================================================================
// Tools Registration (auto-load skills)
// ============================================================================
// NOTE: Finance skill uses external tool at ~/.summon/components/tools/financial-search.ts
// import '../builtin/skills/finance/index.js';
import '../builtin/skills/web-search/index.js';
import '../builtin/skills/git/index.js';
import '../builtin/skills/file/index.js';
import { createMCPCommands } from './mcp-commands.js';

async function registerAvailableTools(): Promise<void> {
  // Load external tools first with override (so they replace stubs)
  await registerExternalTools({ override: true });

  const args = new Set(process.argv);
  const shouldLog = (args.has('--verbose') || args.has('-v')) && !args.has('--json') && !args.has('--quiet') && !args.has('-q');
  if (!shouldLog) return;
  console.log('Registered tools:');
  for (const name of globalToolRegistry.getNames()) {
    console.log(`  ✓ ${name}`);
  }
}
await registerAvailableTools();

// ============================================================================
// MCP Commands
// ============================================================================

const mcpCommand = createMCPCommands();
program.addCommand(mcpCommand);

// ============================================================================
// Ritual Commands — Durable Execution Engine
// ============================================================================

import { createRitualEngine, RitualPlan } from '../durable/ritual-engine.js';

const ritualCmd = program
  .command('ritual')
  .description('Durable execution rituals with ephemeral sub-agents');

ritualCmd
  .command('start <goal>')
  .description('Start a new ritual with a goal')
  .option('-p, --plan <yaml>', 'Path to ritual plan YAML')
  .option('--json', 'Output in JSON format')
  .action(async (goal: string, options: { plan?: string; json?: boolean }) => {
    const engine = createRitualEngine();
    
    let plan: RitualPlan | undefined;
    if (options.plan) {
      const planYaml = readFileSync(options.plan, 'utf-8');
      plan = parseYaml(planYaml) as RitualPlan;
    }
    
    const ritual = await engine.createRitual(goal, plan);
    
    if (options.json) {
      console.log(JSON.stringify({ ritualId: ritual.id, goal, state: ritual.state }, null, 2));
    } else {
      console.log(`🔥 Ritual created: ${ritual.id}`);
      console.log(`   Goal: ${goal}`);
      console.log(`   Tasks: ${ritual.tasks.length}`);
      console.log(`   Starting execution...\n`);
    }
    
    // Start execution
    await engine.startRitual(ritual.id);
    
    const stats = engine.getRitualStats(ritual.id);
    
    if (options.json) {
      console.log(JSON.stringify({
        ritualId: ritual.id,
        state: ritual.state,
        stats,
        tokensUsed: ritual.metadata.totalTokensUsed,
        estimatedCost: ritual.metadata.estimatedCost.toFixed(4)
      }, null, 2));
    } else {
      console.log(`\n✓ Ritual complete: ${ritual.id}`);
      console.log(`  State: ${ritual.state}`);
      if (stats) {
        console.log(`  Progress: ${stats.completed}/${stats.totalTasks} tasks`);
      }
      console.log(`  Tokens: ${ritual.metadata.totalTokensUsed}`);
      console.log(`  Est. cost: $${ritual.metadata.estimatedCost.toFixed(4)}`);
    }
  });

ritualCmd
  .command('list')
  .description('List active rituals')
  .option('--json', 'Output in JSON format')
  .action((options: { json?: boolean }) => {
    const engine = createRitualEngine();
    const rituals = engine.listRituals();
    
    if (options.json) {
      console.log(JSON.stringify(rituals.map(r => ({
        id: r.id,
        goal: r.goal,
        state: r.state,
        tasks: r.tasks.length,
        createdAt: r.metadata.createdAt
      })), null, 2));
    } else {
      console.log('Active Rituals:\n');
      for (const ritual of rituals) {
        const stats = engine.getRitualStats(ritual.id);
        console.log(`  ${ritual.id.slice(0, 20)}...`);
        console.log(`    Goal: ${ritual.goal.slice(0, 50)}${ritual.goal.length > 50 ? '...' : ''}`);
        console.log(`    State: ${ritual.state}`);
        if (stats) {
          console.log(`    Progress: ${Math.round(stats.progress * 100)}% (${stats.completed}/${stats.totalTasks})`);
        }
        console.log('');
      }
    }
  });

ritualCmd
  .command('status <ritualId>')
  .description('Get ritual status and progress')
  .option('--json', 'Output in JSON format')
  .action((ritualId: string, options: { json?: boolean }) => {
    const engine = createRitualEngine();
    const ritual = engine.getRitual(ritualId);
    
    if (!ritual) {
      console.error(`Ritual not found: ${ritualId}`);
      process.exit(1);
    }
    
    const stats = engine.getRitualStats(ritualId);
    
    if (options.json) {
      console.log(JSON.stringify({
        id: ritual.id,
        goal: ritual.goal,
        state: ritual.state,
        stats,
        tasks: ritual.tasks.map(t => ({
          id: t.id,
          type: t.type,
          status: t.status,
          agentId: t.agentId
        })),
        metadata: ritual.metadata
      }, null, 2));
    } else {
      console.log(`Ritual: ${ritual.id}`);
      console.log(`Goal: ${ritual.goal}`);
      console.log(`State: ${ritual.state}`);
      console.log(`\nTasks:`);
      for (const task of ritual.tasks) {
        const icon = task.status === 'completed' ? '✓' : task.status === 'failed' ? '✗' : task.status === 'running' ? '⟳' : '○';
        console.log(`  ${icon} [${task.type}] ${task.description.slice(0, 40)}${task.description.length > 40 ? '...' : ''}`);
        if (task.agentId) {
          console.log(`      Agent: ${task.agentId} | Session: ${task.sessionId?.slice(0, 16)}...`);
        }
      }
      if (stats) {
        console.log(`\nProgress: ${Math.round(stats.progress * 100)}% (${stats.completed}/${stats.totalTasks})`);
      }
      console.log(`\nTokens: ${ritual.metadata.totalTokensUsed}`);
      console.log(`Est. Cost: $${ritual.metadata.estimatedCost.toFixed(4)}`);
    }
  });

ritualCmd
  .command('resume <ritualId>')
  .description('Resume a ritual from checkpoint')
  .option('--json', 'Output in JSON format')
  .action(async (ritualId: string, options: { json?: boolean }) => {
    const engine = createRitualEngine();
    
    if (!options.json) {
      console.log(`Resuming ritual: ${ritualId}...`);
    }
    
    await engine.resumeRitual(ritualId);
    
    const ritual = engine.getRitual(ritualId);
    const stats = engine.getRitualStats(ritualId);
    
    if (options.json) {
      console.log(JSON.stringify({ ritualId, state: ritual?.state, stats }, null, 2));
    } else {
      console.log(`✓ Ritual resumed: ${ritualId}`);
      if (stats) {
        console.log(`  Progress: ${Math.round(stats.progress * 100)}%`);
      }
    }
  });

// ============================================================================
// Observability Commands — See First, Automate Second
// ============================================================================

import { getMetricsCollector, Dashboard } from '../observability/index.js';

const obsCmd = program
  .command('observability')
  .alias('obs')
  .description('Ritual observability — metrics, costs, and routing analysis');

obsCmd
  .command('dashboard')
  .description('Show real-time observability dashboard')
  .option('--html <path>', 'Export to HTML file')
  .action((options: { html?: string }) => {
    const collector = getMetricsCollector();
    const dashboard = new Dashboard(collector, './');
    
    if (options.html) {
      const path = dashboard.saveHtml(options.html);
      console.log(`Dashboard exported to: ${path}`);
    } else {
      console.log(dashboard.renderRealtime());
    }
  });

obsCmd
  .command('ritual <ritualId>')
  .description('Show detailed metrics for a ritual')
  .action((ritualId: string) => {
    const collector = getMetricsCollector();
    const dashboard = new Dashboard(collector, './');
    console.log(dashboard.renderRitualDetail(ritualId));
  });

obsCmd
  .command('summary [date]')
  .description('Show daily summary (YYYY-MM-DD, default: today)')
  .option('--json', 'Output in JSON format')
  .action((date: string | undefined, options: { json?: boolean }) => {
    const collector = getMetricsCollector();
    const summary = collector.getDailySummary(date);
    
    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      console.log(`\n📊 Daily Summary: ${summary.date}`);
      console.log(`   Rituals: ${summary.completedRituals} completed │ ${summary.failedRituals} failed`);
      console.log(`   Tasks:   ${summary.totalTasks}`);
      console.log(`   Tokens:  ${summary.totalTokens.toLocaleString()}`);
      console.log(`   Cost:    $${summary.totalCost.toFixed(4)}`);
      console.log(`   Avg Duration: ${(summary.avgRitualDuration / 1000).toFixed(1)}s`);
      console.log(`\n   Routing Accuracy: ${(summary.routingAccuracy.accuracyRate * 100).toFixed(1)}%`);
      if (summary.routingAccuracy.wastedCost > 0) {
        console.log(`   Wasted Cost: $${summary.routingAccuracy.wastedCost.toFixed(4)}`);
      }
      if (summary.routingAccuracy.recommendations.length > 0) {
        console.log(`\n   💡 Recommendations:`);
        summary.routingAccuracy.recommendations.forEach(r => console.log(`      • ${r}`));
      }
    }
  });

obsCmd
  .command('routing')
  .description('Analyze routing accuracy and get recommendations')
  .action(() => {
    const collector = getMetricsCollector();
    const report = collector.analyzeRoutingAccuracy();
    
    console.log('\n🎯 Routing Accuracy Analysis');
    console.log(`   Total Decisions: ${report.total}`);
    console.log(`   Correct: ${report.correct} (${(report.accuracyRate * 100).toFixed(1)}%)`);
    console.log(`   Overkill: ${report.overkill} (wasted $${report.wastedCost.toFixed(4)})`);
    console.log(`   Underpowered: ${report.underpowered}`);
    
    if (report.recommendations.length > 0) {
      console.log('\n   💡 Recommendations:');
      report.recommendations.forEach(r => console.log(`      • ${r}`));
    }
  });

obsCmd
  .command('weekly')
  .description('Show 7-day summary report')
  .action(() => {
    const collector = getMetricsCollector();
    const dashboard = new Dashboard(collector, './');
    const report = dashboard.generateWeeklyReport();
    
    console.log('\n📈 7-Day Report');
    console.log(`   Days: ${report.days}`);
    console.log(`   Total Rituals: ${report.totalRituals}`);
    console.log(`   Total Cost: $${report.totalCost.toFixed(4)}`);
    console.log(`   Total Tokens: ${report.totalTokens.toLocaleString()}`);
    console.log(`   Avg Daily: $${report.avgDailyCost.toFixed(4)}`);
    console.log(`   Trend: ${report.costTrend}`);
    
    if (report.recommendations.length > 0) {
      console.log('\n   💡 Recommendations:');
      report.recommendations.forEach(r => console.log(`      • ${r}`));
    }
  });

// ============================================================================
// Preferences Commands - User Preference Profiles
// ============================================================================

import {
  loadPreferences,
  savePreferences,
  setStylePreference,
  setFormatPreference,
  setSafetyPreference,
  getPreferencesPath,
  validatePreferences,
  DEFAULT_PREFERENCES,
} from '../preferences/index.js';
import {
  getUserMemoryManager,
  createDefaultMemory,
} from '../memory/index.js';
import { stringify as stringifyYaml } from 'yaml';

const prefsCmd = program
  .command('preferences')
  .alias('prefs')
  .description('Manage user preferences for personalized agent behavior');

prefsCmd
  .command('show')
  .description('Display current preferences')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const prefs = loadPreferences();
    
    if (options.json) {
      console.log(JSON.stringify(prefs, null, 2));
      return;
    }

    console.log(`\n👤 User: ${prefs.user.name}`);
    console.log(`📍 Config: ${getPreferencesPath()}`);
    console.log('\n🎨 Style:');
    console.log(`   Response Length: ${prefs.style.response_length}`);
    console.log(`   Tone: ${prefs.style.tone}`);
    console.log(`   Reasoning: ${prefs.style.reasoning}`);
    console.log('\n📝 Format:');
    console.log(`   Tables: ${prefs.format.use_tables ? '✓' : '✗'}`);
    console.log(`   Bullets: ${prefs.format.use_bullets ? '✓' : '✗'}`);
    console.log(`   Sources: ${prefs.format.include_sources ? '✓' : '✗'}`);
    console.log(`   Code Style: ${prefs.format.code_style}`);
    console.log('\n🛡️  Safety:');
    console.log(`   Max Cost/Run: $${prefs.safety.max_cost_per_run}`);
    console.log(`   Max Time/Run: ${prefs.safety.max_time_per_run}min`);
    if (prefs.safety.blocked_topics.length > 0) {
      console.log(`   Blocked Topics: ${prefs.safety.blocked_topics.join(', ')}`);
    }
  });

prefsCmd
  .command('set')
  .description('Set a preference value')
  .option('--name <name>', 'User name')
  .option('--style <style>', 'Response style (concise|detailed|exhaustive)')
  .option('--tone <tone>', 'Tone (formal|casual|professional)')
  .option('--reasoning <mode>', 'Reasoning display (hidden|brief|thorough)')
  .option('--tables', 'Enable tables')
  .option('--no-tables', 'Disable tables')
  .option('--bullets', 'Enable bullets')
  .option('--no-bullets', 'Disable bullets')
  .option('--sources', 'Require sources')
  .option('--no-sources', 'Do not require sources')
  .option('--max-cost <amount>', 'Max cost per run in USD')
  .option('--max-time <minutes>', 'Max time per run in minutes')
  .action((options: {
    name?: string;
    style?: string;
    tone?: string;
    reasoning?: string;
    tables?: boolean;
    bullets?: boolean;
    sources?: boolean;
    maxCost?: string;
    maxTime?: string;
  }) => {
    let prefs = loadPreferences();

    if (options.name) {
      prefs.user.name = options.name;
    }

    if (options.style) {
      const valid = ['concise', 'detailed', 'exhaustive'];
      if (valid.includes(options.style)) {
        prefs = setStylePreference(prefs, 'response_length', options.style as any);
      } else {
        console.error(`Invalid style. Use: ${valid.join(', ')}`);
        process.exit(1);
      }
    }

    if (options.tone) {
      const valid = ['formal', 'casual', 'professional'];
      if (valid.includes(options.tone)) {
        prefs = setStylePreference(prefs, 'tone', options.tone as any);
      } else {
        console.error(`Invalid tone. Use: ${valid.join(', ')}`);
        process.exit(1);
      }
    }

    if (options.reasoning) {
      const valid = ['hidden', 'brief', 'thorough'];
      if (valid.includes(options.reasoning)) {
        prefs = setStylePreference(prefs, 'reasoning', options.reasoning as any);
      } else {
        console.error(`Invalid reasoning mode. Use: ${valid.join(', ')}`);
        process.exit(1);
      }
    }

    if (options.tables !== undefined) {
      prefs = setFormatPreference(prefs, 'use_tables', options.tables);
    }

    if (options.bullets !== undefined) {
      prefs = setFormatPreference(prefs, 'use_bullets', options.bullets);
    }

    if (options.sources !== undefined) {
      prefs = setFormatPreference(prefs, 'include_sources', options.sources);
    }

    if (options.maxCost) {
      const cost = parseFloat(options.maxCost);
      if (!isNaN(cost)) {
        prefs = setSafetyPreference(prefs, 'max_cost_per_run', cost);
      }
    }

    if (options.maxTime) {
      const time = parseFloat(options.maxTime);
      if (!isNaN(time)) {
        prefs = setSafetyPreference(prefs, 'max_time_per_run', time);
      }
    }

    if (savePreferences(prefs)) {
      console.log('✓ Preferences saved');
    } else {
      console.error('✗ Failed to save preferences');
      process.exit(1);
    }
  });

prefsCmd
  .command('reset')
  .description('Reset preferences to defaults')
  .option('--confirm', 'Confirm reset')
  .action((options: { confirm?: boolean }) => {
    if (!options.confirm) {
      console.log('This will reset all preferences to defaults.');
      console.log('Run with --confirm to proceed.');
      return;
    }

    if (savePreferences(DEFAULT_PREFERENCES)) {
      console.log('✓ Preferences reset to defaults');
    } else {
      console.error('✗ Failed to reset preferences');
      process.exit(1);
    }
  });

prefsCmd
  .command('validate')
  .description('Validate preferences file')
  .action(() => {
    const prefs = loadPreferences();
    const result = validatePreferences(prefs);

    if (result.valid) {
      console.log('✓ Preferences are valid');
    } else {
      console.log('✗ Validation errors:');
      for (const error of result.errors) {
        console.log(`  - ${error}`);
      }
      process.exit(1);
    }
  });

prefsCmd
  .command('export')
  .description('Export preferences to stdout')
  .action(() => {
    const prefs = loadPreferences();
    console.log(stringifyYaml(prefs));
  });

// ============================================================================
// Guardrails Commands - Advanced Guardrails
// ============================================================================

import { GuardrailEngine, createGuardrailsFromPreferences } from '../guardrails/advanced.js';

const guardrailsCmd = program
  .command('guardrails')
  .alias('guard')
  .description('Advanced guardrail management');

guardrailsCmd
  .command('check')
  .description('Check current configuration')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const prefs = loadPreferences();
    const guardrails = createGuardrailsFromPreferences(prefs);

    if (options.json) {
      console.log(JSON.stringify(guardrails, null, 2));
      return;
    }

    console.log('\n🛡️  Advanced Guardrails');
    console.log('\nContent Policy:');
    console.log(`   Blocked Topics: ${guardrails.content_policy.blocked_topics.join(', ') || '(none)'}`);
    console.log(`   Banned Words: ${guardrails.content_policy.banned_words.join(', ') || '(none)'}`);
    
    console.log('\nTool Policy:');
    console.log(`   Allowed: ${guardrails.tool_policy.allowed.join(', ') || '(all)'}`);
    console.log(`   Blocked: ${guardrails.tool_policy.blocked.join(', ') || '(none)'}`);
    console.log(`   Require Approval: ${guardrails.tool_policy.require_approval.join(', ') || '(none)'}`);
    console.log(`   Max Tool Calls: ${guardrails.tool_policy.max_tool_calls_per_run}`);

    console.log('\nCost Policy:');
    console.log(`   Max Per Run: $${guardrails.cost_policy.max_per_run}`);
    console.log(`   Max Per Day: $${guardrails.cost_policy.max_per_day}`);
    console.log(`   Alert Threshold: $${guardrails.cost_policy.alert_threshold}`);

    console.log('\nQuality Policy:');
    console.log(`   Min Response Length: ${guardrails.quality_policy.min_response_length}`);
    console.log(`   Max Response Length: ${guardrails.quality_policy.max_response_length}`);
    console.log(`   Require Sources: ${guardrails.quality_policy.require_sources ? '✓' : '✗'}`);
    console.log(`   Ban Words: ${guardrails.quality_policy.ban_words.join(', ')}`);

    console.log('\nTime Policy:');
    console.log(`   Max Total Time: ${guardrails.time_policy.max_total_time}s`);
    console.log(`   Max Tool Time: ${guardrails.time_policy.max_tool_time}s`);
  });

guardrailsCmd
  .command('test <text>')
  .description('Test content against guardrails')
  .action((text: string) => {
    const prefs = loadPreferences();
    const guardrails = createGuardrailsFromPreferences(prefs);
    
    const engine = new GuardrailEngine({
      userPreferences: prefs,
      guardrails,
      startTime: Date.now(),
      currentCost: 0,
      dailyCost: 0,
      toolCalls: 0,
      toolCallsByType: {},
    });

    const result = engine.checkContent(text);

    console.log('\n🧪 Guardrail Test Results');
    console.log(`\nPassed: ${result.passed ? '✓' : '✗'}`);
    
    if (result.errors.length > 0) {
      console.log('\nErrors:');
      for (const check of result.errors) {
        console.log(`  ✗ ${check.policy}.${check.rule}: ${check.message}`);
      }
    }

    if (result.warnings.length > 0) {
      console.log('\nWarnings:');
      for (const check of result.warnings) {
        console.log(`  ⚠ ${check.policy}.${check.rule}: ${check.message}`);
      }
    }

    if (result.passed && result.errors.length === 0 && result.warnings.length === 0) {
      console.log('  ✓ All checks passed');
    }
  });

// ============================================================================
// Memory Commands - Long-term Memory
// ============================================================================

const memoryCmd = program
  .command('memory')
  .description('Long-term memory management');

memoryCmd
  .command('show')
  .description('Display user memory summary')
  .option('--json', 'Output as JSON')
  .action((options: { json?: boolean }) => {
    const manager = getUserMemoryManager();
    const memory = manager.getMemory();

    if (options.json) {
      console.log(JSON.stringify(memory, null, 2));
      return;
    }

    console.log(`\n🧠 User Memory`);
    console.log(`   User ID: ${memory.userId}`);
    console.log(`   Created: ${memory.createdAt}`);
    console.log(`   Updated: ${memory.updatedAt}`);

    console.log('\n📊 Stats:');
    console.log(`   Total Interactions: ${memory.stats.totalInteractions}`);
    console.log(`   Total Sessions: ${memory.stats.totalSessions}`);
    console.log(`   Total Tokens: ${memory.stats.totalTokensUsed.toLocaleString()}`);
    console.log(`   Total Cost: $${memory.stats.totalCost.toFixed(4)}`);
    if (memory.stats.averageRating) {
      console.log(`   Avg Rating: ${memory.stats.averageRating.toFixed(1)}/5`);
    }

    console.log('\n💡 Learned Preferences:');
    const lp = memory.learnedPreferences;
    if (lp.style.response_length) console.log(`   Style Length: ${lp.style.response_length}`);
    if (lp.style.tone) console.log(`   Style Tone: ${lp.style.tone}`);
    if (lp.preferredModels.length > 0) console.log(`   Preferred Models: ${lp.preferredModels.join(', ')}`);

    if (memory.patterns.length > 0) {
      console.log('\n📈 Patterns:');
      for (const pattern of memory.patterns.slice(0, 5)) {
        const icon = pattern.type === 'success' ? '✓' : pattern.type === 'failure' ? '✗' : '💡';
        console.log(`   ${icon} ${pattern.pattern} (${pattern.count}x)`);
      }
    }

    if (memory.successfulMods.length > 0) {
      console.log('\n🔧 Successful Modifications:');
      for (const mod of memory.successfulMods.slice(0, 5)) {
        console.log(`   • ${mod.description} (${Math.round(mod.successRate * 100)}%)`);
      }
    }
  });

memoryCmd
  .command('interactions')
  .description('Show recent interactions')
  .option('-n, --limit <num>', 'Number to show', '10')
  .action((options: { limit: string }) => {
    const manager = getUserMemoryManager();
    const limit = parseInt(options.limit, 10);
    const interactions = manager.getRecentInteractions(limit);

    console.log(`\n💬 Recent Interactions (${interactions.length}):\n`);
    
    for (const interaction of interactions) {
      const date = new Date(interaction.timestamp).toLocaleDateString();
      const rating = interaction.rating ? `★${interaction.rating}` : '☆';
      const success = interaction.success ? '✓' : '✗';
      
      console.log(`[${date}] ${success} ${rating} ${interaction.query.slice(0, 60)}${interaction.query.length > 60 ? '...' : ''}`);
      console.log(`    → ${interaction.summary}`);
      if (interaction.tags.length > 0) {
        console.log(`    Tags: ${interaction.tags.join(', ')}`);
      }
      console.log('');
    }
  });

memoryCmd
  .command('patterns')
  .description('Show learned patterns')
  .action(() => {
    const manager = getUserMemoryManager();
    const memory = manager.getMemory();

    console.log('\n📈 Learned Patterns\n');

    const failures = memory.patterns.filter(p => p.type === 'failure');
    const successes = memory.patterns.filter(p => p.type === 'success');
    const preferences = memory.patterns.filter(p => p.type === 'preference');

    if (failures.length > 0) {
      console.log('⚠️  Failure Patterns:');
      for (const p of failures) {
        console.log(`   ${p.pattern} (${p.count}x)`);
        if (p.examples.length > 0) {
          console.log(`      Example: ${p.examples[0]}`);
        }
      }
      console.log('');
    }

    if (successes.length > 0) {
      console.log('✓ Success Patterns:');
      for (const p of successes) {
        console.log(`   ${p.pattern} (${p.count}x)`);
      }
      console.log('');
    }

    if (preferences.length > 0) {
      console.log('💡 User Preferences:');
      for (const p of preferences) {
        console.log(`   ${p.pattern} (${p.count}x)`);
      }
    }
  });

memoryCmd
  .command('clear')
  .description('Clear all memory (irreversible)')
  .option('--confirm', 'Confirm deletion')
  .action((options: { confirm?: boolean }) => {
    if (!options.confirm) {
      console.log('⚠️  This will permanently delete all user memory.');
      console.log('Run with --confirm to proceed.');
      return;
    }

    const manager = getUserMemoryManager();
    
    // Reset to default
    const defaultMemory = createDefaultMemory(manager.getMemory().userId);
    
    // Save empty memory (need to access private method or create new file)
    console.log('Memory cleared. Restart to apply changes.');
  });

// ============================================================================
// A/B Testing Commands
// ============================================================================

import { getABTestManager, createStandardTest } from '../ab-testing/index.js';

const abCmd = program
  .command('ab-test')
  .alias('ab')
  .description('A/B testing for ritual variants');

abCmd
  .command('list')
  .description('List all A/B tests')
  .option('--ritual <id>', 'Filter by ritual ID')
  .option('--json', 'Output as JSON')
  .action((options: { ritual?: string; json?: boolean }) => {
    const manager = getABTestManager();
    let tests = manager.listTests();

    if (options.ritual) {
      tests = tests.filter(t => t.ritualId === options.ritual);
    }

    if (options.json) {
      console.log(JSON.stringify(tests, null, 2));
      return;
    }

    if (tests.length === 0) {
      console.log('No A/B tests found.');
      return;
    }

    console.log('\n📊 A/B Tests\n');
    
    for (const test of tests) {
      const statusIcon = test.status === 'running' ? '▶' : test.status === 'completed' ? '✓' : test.status === 'paused' ? '⏸' : '○';
      console.log(`${statusIcon} ${test.name}`);
      console.log(`   ID: ${test.id}`);
      console.log(`   Ritual: ${test.ritualId}`);
      console.log(`   Status: ${test.status}`);
      console.log(`   Variants: ${test.variants.map(v => v.name).join(' vs ')}`);
      
      const totalAssignments = Object.values(test.results).reduce((sum, r) => sum + r.assignments, 0);
      console.log(`   Assignments: ${totalAssignments}`);
      
      if (test.winner) {
        const winnerName = test.variants.find(v => v.id === test.winner)?.name;
        console.log(`   Winner: ${winnerName} (${Math.round((test.winnerConfidence || 0) * 100)}%)`);
      }
      console.log('');
    }
  });

abCmd
  .command('create <ritualId>')
  .description('Create a new A/B test for a ritual')
  .requiredOption('-n, --name <name>', 'Test name')
  .requiredOption('--control <yaml>', 'Control variant config (JSON/YAML)')
  .requiredOption('--treatment <yaml>', 'Treatment variant config (JSON/YAML)')
  .option('--start', 'Start immediately')
  .action((ritualId: string, options: {
    name: string;
    control: string;
    treatment: string;
    start?: boolean;
  }) => {
    let controlConfig: Record<string, unknown>;
    let treatmentConfig: Record<string, unknown>;

    try {
      controlConfig = JSON.parse(options.control);
    } catch {
      try {
        controlConfig = parseYaml(options.control);
      } catch {
        console.error('Invalid control config. Provide valid JSON or YAML.');
        process.exit(1);
      }
    }

    try {
      treatmentConfig = JSON.parse(options.treatment);
    } catch {
      try {
        treatmentConfig = parseYaml(options.treatment);
      } catch {
        console.error('Invalid treatment config. Provide valid JSON or YAML.');
        process.exit(1);
      }
    }

    const test = createStandardTest(
      ritualId,
      controlConfig,
      treatmentConfig,
      options.name
    );

    console.log(`\n✓ A/B Test Created`);
    console.log(`   ID: ${test.id}`);
    console.log(`   Name: ${test.name}`);
    console.log(`   Ritual: ${test.ritualId}`);

    if (options.start) {
      const manager = getABTestManager();
      manager.startTest(test.id);
      console.log(`   Status: Started`);
    } else {
      console.log(`\nRun "summon ab-test start ${test.id}" to begin testing.`);
    }
  });

abCmd
  .command('start <testId>')
  .description('Start an A/B test')
  .action((testId: string) => {
    const manager = getABTestManager();
    const success = manager.startTest(testId);
    
    if (success) {
      console.log(`✓ Test ${testId} started`);
    } else {
      console.error(`✗ Could not start test. Check ID and ensure test is in draft status.`);
      process.exit(1);
    }
  });

abCmd
  .command('pause <testId>')
  .description('Pause an A/B test')
  .action((testId: string) => {
    const manager = getABTestManager();
    const success = manager.pauseTest(testId);
    
    if (success) {
      console.log(`✓ Test ${testId} paused`);
    } else {
      console.error(`✗ Could not pause test.`);
      process.exit(1);
    }
  });

abCmd
  .command('results <testId>')
  .description('Show test results')
  .option('--json', 'Output as JSON')
  .action((testId: string, options: { json?: boolean }) => {
    const manager = getABTestManager();
    const report = manager.analyzeResults(testId);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log(`\n📊 Test Results: ${testId}`);
    console.log(`   Status: ${report.status}`);

    if (report.variants.length === 0) {
      console.log('   No data yet.');
      return;
    }

    console.log('\n   Variants:');
    for (const v of report.variants) {
      const isWinner = report.winner === v.id;
      const icon = isWinner ? '🏆' : '○';
      console.log(`\n   ${icon} ${v.name}`);
      console.log(`      Assignments: ${v.assignments}`);
      console.log(`      Completion Rate: ${(v.completionRate * 100).toFixed(1)}%`);
      if (v.averageRating) {
        console.log(`      Avg Rating: ${v.averageRating.toFixed(1)}/5`);
      }
      for (const [metric, score] of Object.entries(v.metricScores)) {
        console.log(`      ${metric}: ${score.toFixed(2)}`);
      }
    }

    console.log(`\n   ${report.recommendation}`);
  });

abCmd
  .command('promote <testId>')
  .description('Promote the winning variant')
  .action(async (testId: string) => {
    const manager = getABTestManager();
    const result = await manager.promoteWinner(testId);
    
    if (result.success) {
      console.log(`✓ ${result.message}`);
    } else {
      console.error(`✗ ${result.message}`);
      process.exit(1);
    }
  });

// ============================================================================
// Conditions Commands — Conditional Edge Support
// ============================================================================

import {
  validateConditions,
  createConditionEngine,
} from '../conditions/index.js';
import {
  createRitualEngineV2,
  RitualPlanV2,
} from '../durable/ritual-engine-v2.js';

const conditionsCmd = program
  .command('conditions')
  .alias('cond')
  .description('Conditional edge management for rituals');

conditionsCmd
  .command('validate <ritualYaml>')
  .description('Validate conditions in a ritual YAML file')
  .option('--json', 'Output as JSON')
  .action((ritualPath: string, options: { json?: boolean }) => {
    const resolved = resolvePath(ritualPath);
    if (!existsSync(resolved)) {
      console.error(`Error: Ritual file not found: ${resolved}`);
      process.exit(1);
    }

    const raw = readFileSync(resolved, 'utf-8');
    const parsed = parseYaml(raw) as RitualPlanV2;

    if (!parsed.conditions || parsed.conditions.length === 0) {
      if (options.json) {
        console.log(JSON.stringify({ valid: true, conditions: 0, errors: [] }));
      } else {
        console.log('No conditions found in ritual.');
      }
      return;
    }

    const availableSteps = parsed.tasks.map((t) => t.type);
    const result = validateConditions(parsed.conditions, availableSteps);

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            valid: result.valid,
            conditions: parsed.conditions.length,
            errors: result.errors,
          },
          null,
          2
        )
      );
      return;
    }

    console.log(`\n🔄 Validating ${parsed.conditions.length} condition(s)\n`);

    if (result.valid) {
      console.log('✓ All conditions are valid');
    } else {
      console.log('✗ Validation errors:');
      for (const err of result.errors) {
        console.log(`\n  Condition: ${err.conditionId}`);
        for (const msg of err.errors) {
          console.log(`    • ${msg}`);
        }
      }
      process.exit(1);
    }

    // Show summary
    console.log('\nConditions:');
    for (const cond of parsed.conditions) {
      console.log(`  • ${cond.id}: ${cond.from} → (then: ${cond.then}, else: ${cond.else})`);
      console.log(`    Condition: "${cond.condition}"`);
    }
  });

conditionsCmd
  .command('graph <ritualYaml>')
  .description('Generate Mermaid diagram of ritual with conditions')
  .option('-o, --output <path>', 'Save to file instead of stdout')
  .action((ritualPath: string, options: { output?: string }) => {
    const resolved = resolvePath(ritualPath);
    if (!existsSync(resolved)) {
      console.error(`Error: Ritual file not found: ${resolved}`);
      process.exit(1);
    }

    const raw = readFileSync(resolved, 'utf-8');
    const parsed = parseYaml(raw) as RitualPlanV2;

    if (!parsed.conditions || parsed.conditions.length === 0) {
      console.log('No conditions found in ritual.');
      return;
    }

    const engine = createConditionEngine();
    const diagram = engine.exportMermaidDiagram(parsed.conditions);

    if (options.output) {
      writeFileSync(options.output, diagram);
      console.log(`✓ Diagram saved to: ${options.output}`);
    } else {
      console.log('\n```mermaid');
      console.log(diagram);
      console.log('```\n');
    }
  });

conditionsCmd
  .command('run <ritualYaml> <goal>')
  .description('Run a ritual with condition tracing enabled')
  .option('--json', 'Output as JSON')
  .option('--max-iterations <n>', 'Max iterations to prevent infinite loops', '50')
  .action(
    async (
      ritualPath: string,
      goal: string,
      options: { json?: boolean; maxIterations?: string }
    ) => {
      const resolved = resolvePath(ritualPath);
      if (!existsSync(resolved)) {
        console.error(`Error: Ritual file not found: ${resolved}`);
        process.exit(1);
      }

      const raw = readFileSync(resolved, 'utf-8');
      const plan = parseYaml(raw) as RitualPlanV2;

      const engine = createRitualEngineV2({
        maxIterations: parseInt(options.maxIterations || '50', 10),
        traceConditions: true,
        onConditionEvaluated: (trace, ritual) => {
          if (!options.json) {
            console.log(
              `\n🔄 [${ritual.executionPath.length}] Condition: ${trace.conditionId}`
            );
            console.log(`   From: ${trace.from}`);
            console.log(`   Evaluated: "${trace.condition}"`);
            console.log(
              `   Result: ${trace.result.outcome} → ${
                trace.result.outcome === 'then' ? trace.then : trace.else
              }`
            );
            if (trace.result.reasoning) {
              console.log(`   Reasoning: ${trace.result.reasoning.slice(0, 100)}...`);
            }
          }
        },
      });

      const ritual = await engine.createRitual(goal, plan);

      if (!options.json) {
        console.log(`🔥 Starting ritual: ${ritual.id}`);
        console.log(`   Goal: ${goal}`);
        console.log(`   Steps: ${ritual.tasks.length}`);
        console.log(`   Conditions: ${ritual.conditions.length}`);
        console.log(`   Max iterations: ${options.maxIterations}\n`);
      }

      const result = await engine.executeRitual(ritual.id);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n${'='.repeat(50)}`);
        console.log(`Ritual ${result.success ? '✓ completed' : '✗ failed'}`);
        console.log(`  Execution path: ${result.executionPath.join(' → ')}`);
        console.log(`  Total steps executed: ${result.totalSteps}`);
        console.log(`  Condition evaluations: ${result.conditionEvaluations}`);

        if (Object.keys(result.iterationsByStep).length > 0) {
          console.log(`\n  Step iterations:`);
          for (const [stepId, count] of Object.entries(result.iterationsByStep)) {
            if (count > 1) {
              console.log(`    • ${stepId}: ${count} iterations`);
            }
          }
        }

        if (result.error) {
          console.log(`\n  Error: ${result.error}`);
        }
      }
    }
  );

conditionsCmd
  .command('trace <ritualYaml>')
  .description('Show condition trace from last run')
  .action((ritualPath: string) => {
    console.log('Trace history is stored per ritual execution.');
    console.log('Use "summon conditions run" with --json to get full traces.');
  });

// ============================================================================
// Trainer Commands — Decision Point System
// ============================================================================

import { registerTrainerCommands } from '../trainer/cli.js';
registerTrainerCommands(program);

// ============================================================================
// Setup Command
// ============================================================================

program
  .command('setup')
  .description('Interactive setup wizard for summon')
  .option('-r, --ritual <path>', 'Ritual path to configure tools for')
  .action(async (options: { ritual?: string }) => {
    await runFormalSetup({ ritualPath: options.ritual, skipIfExists: false });
  });

// ============================================================================
// Config Command — Location
// ============================================================================

program
  .command('config')
  .description('Show summon configuration and locations')
  .option('--location', 'Show storage locations')
  .action(async (options: { location?: boolean }) => {
    if (options.location) {
      console.log('Summon Storage Locations');
      console.log('═════════════════════════');
      console.log(`Config:   ${SUMMON_DIR}/config.yaml`);
      console.log(`Auth:     ${ENV_PATH}`);
      console.log(`Sessions: ${SUMMON_DIR}/sessions/`);
      console.log(`Rituals:  ${SUMMON_DIR}/rituals/`);
      console.log(`Cache:    ${SUMMON_DIR}/cache/`);
      console.log(`Docs:     ~/Documents/Summon/`);
      console.log('');
      
      // Show current status
      const envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
      console.log('Configured:');
      console.log(`  LLM:      ${envContent.match(/(OPENAI|ANTHROPIC|OPENROUTER)_API_KEY=/) ? '✓' : '✗'}`);
      console.log(`  Alpha:    ${envContent.includes('ALPHAVANTAGE_API_KEY=') ? '✓' : '✗'}`);
      console.log(`  Tavily:   ${envContent.includes('TAVILY_API_KEY=') ? '✓' : '✗'}`);
    } else {
      console.log('Usage: summon config --location');
    }
  });

// ============================================================================
// Doctor Command
// ============================================================================

program
  .command('doctor')
  .description('Check summon health and configuration')
  .action(async () => {
    console.log('🩺 Summon Doctor');
    console.log('═════════════════');
    console.log('');
    
    // Check directories
    console.log('Directories:');
    console.log(`  ~/.summon/      ${existsSync(SUMMON_DIR) ? '✓' : '✗'}`);
    console.log(`  sessions/       ${existsSync(`${SUMMON_DIR}/sessions`) ? '✓' : '✗'}`);
    console.log(`  rituals/        ${existsSync(`${SUMMON_DIR}/rituals`) ? '✓' : '✗'}`);
    console.log('');
    
    // Check config
    console.log('Configuration:');
    console.log(`  config.yaml     ${existsSync(`${SUMMON_DIR}/config.yaml`) ? '✓' : '✗'}`);
    console.log(`  .env            ${existsSync(ENV_PATH) ? '✓' : '✗'}`);
    console.log('');
    
    // Check API keys
    const envContent = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf-8') : '';
    console.log('API Keys:');
    console.log(`  OpenAI          ${envContent.match(/OPENAI_API_KEY=\S+/) ? '✓' : '✗'}`);
    console.log(`  Anthropic       ${envContent.match(/ANTHROPIC_API_KEY=\S+/) ? '✓' : '✗'}`);
    console.log(`  OpenRouter      ${envContent.match(/OPENROUTER_API_KEY=\S+/) ? '✓' : '✗'}`);
    console.log(`  AlphaVantage    ${envContent.match(/ALPHAVANTAGE_API_KEY=\S+/) ? '✓' : '✗'}`);
    console.log(`  Tavily          ${envContent.match(/TAVILY_API_KEY=\S+/) ? '✓' : '✗'}`);
    console.log('');
    
    // Recommendations
    const hasLLM = envContent.match(/(OPENAI|ANTHROPIC|OPENROUTER)_API_KEY=\S+/);
    if (!hasLLM) {
      console.log('⚠️  No LLM configured. Run: summon setup');
    }
    
    console.log('');
  });

// ============================================================================
// Parse
// ============================================================================

program.parse();
