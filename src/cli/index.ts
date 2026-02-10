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
import { ChatHistoryManager, generateSessionId } from '../runtime/chat-history.js';
import { AgentOrchestrator } from '../orchestration/orchestrator.js';
import { createStorageAdapter } from '../storage/index.js';
import { parse as parseYaml } from 'yaml';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { basename, extname } from 'path';

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
  .option('-r, --ritual <path>', 'Path to YAML ritual file (summon:// for relative paths)')
  .option('-m, --model <model>', 'Override the model (e.g., openrouter/deepseek-r1:free)')
  .option('--session <id>', 'Session ID for multi-turn conversations')
  .option('--session-auto', 'Automatically use the most recent session')
  .option('--new-session', 'Start a fresh session (ignores previous sessions)')
  .option('--continue', 'Continue the most recent session (auto-detects follow-up)')
  .option('-q, --quiet', 'Minimal output (just the answer)')
  .option('--json', 'Output in JSON format for programmatic use')
  .option('-v, --verbose', 'Show verbose output including tool calls')
  .action(async (query: string, options: { 
    ritual?: string; 
    model?: string; 
    session?: string; 
    sessionAuto?: boolean; 
    newSession?: boolean;
    continue?: boolean; 
    quiet?: boolean; 
    json?: boolean; 
    verbose?: boolean 
  }) => {
    if (!options.ritual) {
      console.error('Error: --ritual is required');
      console.log('Usage: summon run "query" --ritual summon://examples/agents/financial-analyst.yaml');
      process.exit(1);
    }

    // Auto-detect follow-up keywords
    const FOLLOW_UP_KEYWORDS = [
      'it', 'that', 'this', 'also', 'compare',
      'and', 'but', 'what about', 'next',
      'continue', 'more', 'deeper', 'explain',
      'then', 'further', 'additionally'
    ];
    const isFollowUp = FOLLOW_UP_KEYWORDS.some(kw => 
      query.toLowerCase().includes(kw)
    );

    // Determine session
    let sessionId: string | undefined;
    if (options.newSession) {
      sessionId = undefined; // Fresh session
    } else if (options.session) {
      sessionId = options.session;
    } else if (options.sessionAuto || (options.continue && isFollowUp)) {
      const sessions = await ChatHistoryManager.listSessions();
      if (sessions.length > 0) {
        sessionId = sessions[0];
      }
    }

    // Initialize chat history
    const chatHistory = new ChatHistoryManager({ sessionId });
    if (sessionId) {
      await chatHistory.load();
    }

    const resolvedConfig = resolvePath(options.ritual);
    if (!options.quiet && !options.json) {
      console.log(`Loading ritual: ${options.ritual} → ${resolvedConfig}`);
    }

    const composition = loadAgentComposition(resolvedConfig);
    if (!composition) {
      console.error(`Error: Failed to load ritual from ${resolvedConfig}`);
      process.exit(1);
    }

    if (!options.quiet && !options.json) {
      console.log(`Summoning: ${composition.name}`);
      if (chatHistory.hasMessages()) {
        console.log(`Session: ${chatHistory.getSessionId()} (${chatHistory.getMessages().length} previous messages)`);
      }
      if (isFollowUp && sessionId) {
        console.log(`[Auto-detected follow-up, continuing session]`);
      }
      console.log(`Query: ${query}\n`);
    }

    let spec: ComposedAgentSpec = composeAgent(composition);
    if (options.model) {
      if (!options.quiet && !options.json) {
        console.log(`Using model: ${options.model}\n`);
      }
      spec = { ...spec, model: options.model };
    }

    const agent = ComposedAgent.create(spec);

    // Save user query to chat history
    chatHistory.saveUserQuery(query);

    const toolCalls: string[] = [];
    let iterations = 0;
    let finalAnswer = '';

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
        case 'tool_error':
          console.error(`[Error] ${event.tool}: ${event.error}`);
          break;
        case 'done':
          if (options.json) {
            console.log(JSON.stringify({
              answer: event.answer,
              iterations: event.iterations,
              toolCalls: event.toolCalls.length,
              sessionId: chatHistory.getSessionId()
            }, null, 2));
          } else if (options.quiet) {
            console.log(event.answer);
          } else {
            console.log(event.answer);
            if (options.verbose) {
              console.log(`\n[Completed in ${event.iterations} iteration(s), ${event.toolCalls.length} tool call(s)]`);
            }
          }
          iterations = event.iterations;
          toolCalls.length = 0;
          for (const tc of event.toolCalls) {
            toolCalls.push(tc.tool);
          }
          finalAnswer = event.answer;
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
      if (!options.quiet && !options.json) {
        console.log(`\n[Session saved: ${chatHistory.getSessionId()}]`);
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

import '../builtin/skills/finance/index.js';
import '../builtin/skills/web-search/index.js';
import '../builtin/skills/git/index.js';
import '../builtin/skills/file/index.js';
import { createMCPCommands } from './mcp-commands.js';

function registerAvailableTools(): void {
  const args = new Set(process.argv);
  const shouldLog = (args.has('--verbose') || args.has('-v')) && !args.has('--json') && !args.has('--quiet') && !args.has('-q');
  if (!shouldLog) return;
  console.log('Registered tools:');
  for (const name of globalToolRegistry.getNames()) {
    console.log(`  ✓ ${name}`);
  }
}
registerAvailableTools();

// ============================================================================
// MCP Commands
// ============================================================================

const mcpCommand = createMCPCommands();
program.addCommand(mcpCommand);

// ============================================================================
// Parse
// ============================================================================

program.parse();
