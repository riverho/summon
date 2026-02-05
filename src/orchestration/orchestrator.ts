import { ComposedAgent } from '../components/composed-agent.js';
import { composeAgent } from '../components/composer.js';
import { createComponentRegistry, loadAgentComposition, resolvePath } from '../components/registry.js';
import type { InMemoryChatHistory } from '../runtime/memory.js';
import type { ComposedAgentSpec } from '../components/composer.js';
import { MultiAgentConfigSchema, type AgentNode, type MultiAgentConfig, type OrchestrationEvent, toAgentComposition } from './types.js';

export class AgentOrchestrator {
  private readonly config: MultiAgentConfig;
  private readonly agents: Map<string, { node: AgentNode; spec: ComposedAgentSpec; agent: ComposedAgent }> = new Map();

  constructor(config: MultiAgentConfig) {
    this.config = MultiAgentConfigSchema.parse(config);
    this.validateConfig();
  }

  static fromObject(config: unknown): AgentOrchestrator {
    return new AgentOrchestrator(MultiAgentConfigSchema.parse(config));
  }

  private validateConfig(): void {
    const { agents, orchestration } = this.config;

    const max = orchestration.maxAgents ?? 5;
    if (agents.length > max) {
      throw new Error(`Too many agents: ${agents.length}. Max allowed: ${max}`);
    }

    const agentIds = new Set(agents.map(a => a.id));
    for (const agent of agents) {
      for (const target of agent.outputTo ?? []) {
        if (!agentIds.has(target)) {
          throw new Error(`Agent "${agent.id}" outputs to unknown agent "${target}"`);
        }
      }
      for (const dep of agent.listenFrom ?? []) {
        if (!agentIds.has(dep)) {
          throw new Error(`Agent "${agent.id}" listens from unknown agent "${dep}"`);
        }
      }
    }
  }

  /**
   * Build ComposedAgent instances for each node.
   *
   * Current behavior:
   * - If node.ritual is provided: load the ritual file as a standard AgentComposition.
   * - Else: synthesize a minimal composition from persona/skills.
   */
  async initialize(): Promise<void> {
    const registry = createComponentRegistry();

    for (const node of this.config.agents) {
      const composition = node.ritual
        ? (() => {
            const resolved = resolvePath(node.ritual);
            const loaded = loadAgentComposition(resolved);
            if (!loaded) throw new Error(`Failed to load ritual for agent ${node.id}: ${node.ritual} (resolved: ${resolved})`);
            return loaded;
          })()
        : (toAgentComposition(node) as any);

      // NOTE: composeAgent will resolve $ref via registry internally.
      // For node.ritual compositions, registry resolution happens inside composeAgent.
      const spec = composeAgent(composition);

      // Node-level model override (optional)
      if (node.model?.primary) {
        (spec as any).model = node.model.primary;
      }

      const agent = ComposedAgent.create(spec);
      this.agents.set(node.id, { node, spec, agent });
    }

    // Registry currently unused; kept for future checks.
    void registry;
  }

  async *run(query: string, sharedHistory?: InMemoryChatHistory): AsyncGenerator<OrchestrationEvent> {
    if (this.agents.size === 0) {
      await this.initialize();
    }

    switch (this.config.orchestration.pattern) {
      case 'parallel':
        yield* this.runParallel(query, sharedHistory);
        return;
      case 'sequential':
        yield* this.runSequential(query, sharedHistory);
        return;
      case 'hierarchical':
        // TODO: coordinator pattern
        yield { type: 'orchestration_done', result: 'Hierarchical pattern not implemented yet.' };
        return;
      default:
        yield { type: 'orchestration_done', result: 'Unknown orchestration pattern.' };
        return;
    }
  }

  private async *runParallel(query: string, sharedHistory?: InMemoryChatHistory): AsyncGenerator<OrchestrationEvent> {
    const tasks = Array.from(this.agents.entries()).map(async ([agentId, entry]) => {
      const { agent } = entry;
      const output = await this.runSingleAgent(agentId, agent, query, sharedHistory);
      return { agentId, output };
    });

    const results = await Promise.all(tasks);
    for (const r of results) {
      yield { type: 'agent_done', agentId: r.agentId, output: r.output };
    }

    const aggregated = this.aggregate(results.map(r => ({ id: r.agentId, result: r.output })));
    yield { type: 'orchestration_done', result: aggregated };
  }

  private async *runSequential(query: string, sharedHistory?: InMemoryChatHistory): AsyncGenerator<OrchestrationEvent> {
    let current = query;
    const results: Array<{ id: string; result: string }> = [];

    for (const [agentId, entry] of this.agents.entries()) {
      const output = await this.runSingleAgent(agentId, entry.agent, current, sharedHistory);
      results.push({ id: agentId, result: output });
      yield { type: 'agent_done', agentId, output };
      current = output;
    }

    const aggregated = this.aggregate(results);
    yield { type: 'orchestration_done', result: aggregated };
  }

  private async runSingleAgent(
    agentId: string,
    agent: ComposedAgent,
    query: string,
    sharedHistory?: InMemoryChatHistory
  ): Promise<string> {
    // Stream events internally; currently only returns final answer.
    // TODO: plumb tool/thinking events into OrchestrationEvent stream.
    let final = '';

    // Emit agent_start via a side-channel? The caller yields it.
    // For now: no-op here.

    for await (const event of agent.run(query, sharedHistory, `${this.config.name}:${agentId}`)) {
      if (event.type === 'done') {
        final = event.answer;
      }
    }

    return final;
  }

  private aggregate(results: Array<{ id: string; result: string }>): string {
    const aggregator = this.config.output?.aggregator ?? 'concatenate';

    switch (aggregator) {
      case 'first':
        return results[0]?.result ?? '';
      case 'last':
        return results[results.length - 1]?.result ?? '';
      case 'concatenate':
        return results.map(r => `[${r.id}]\n${r.result}`).join('\n\n');
      case 'summarize':
        // TODO: summarize via LLM (fast model)
        return results.map(r => r.result).join('\n---\n');
      default:
        return results.map(r => r.result).join('\n\n');
    }
  }
}
