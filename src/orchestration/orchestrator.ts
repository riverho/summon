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

    this.assertDAG();
  }

  private assertDAG(): void {
    const { depsByAgent } = this.buildDependencyGraph();
    const remaining = new Map<string, Set<string>>();
    for (const [id, deps] of depsByAgent.entries()) {
      remaining.set(id, new Set(deps));
    }

    const ready: string[] = [];
    for (const [id, deps] of remaining.entries()) {
      if (deps.size === 0) ready.push(id);
    }

    let visited = 0;
    while (ready.length > 0) {
      const current = ready.shift();
      if (!current) break;
      visited += 1;
      for (const [id, deps] of remaining.entries()) {
        if (deps.has(current)) {
          deps.delete(current);
          if (deps.size === 0) ready.push(id);
        }
      }
    }

    if (visited !== this.config.agents.length) {
      throw new Error('Agent dependency graph contains a cycle. Check listenFrom/outputTo wiring.');
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
        yield* this.runGraphParallel(query, sharedHistory);
        return;
      case 'sequential':
        yield* this.runGraphSequential(query, sharedHistory);
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

  private buildDependencyGraph(): {
    depsByAgent: Map<string, Set<string>>;
    dependentsByAgent: Map<string, Set<string>>;
  } {
    const depsByAgent = new Map<string, Set<string>>();
    const dependentsByAgent = new Map<string, Set<string>>();

    for (const node of this.config.agents) {
      depsByAgent.set(node.id, new Set(node.listenFrom ?? []));
      dependentsByAgent.set(node.id, new Set());
    }

    for (const node of this.config.agents) {
      for (const target of node.outputTo ?? []) {
        depsByAgent.get(target)?.add(node.id);
      }
    }

    for (const [id, deps] of depsByAgent.entries()) {
      for (const dep of deps) {
        dependentsByAgent.get(dep)?.add(id);
      }
    }

    return { depsByAgent, dependentsByAgent };
  }

  private formatAgentInput(query: string, deps: string[], outputs: Map<string, string>): string {
    if (deps.length === 0) return query;

    const parts: string[] = [];
    parts.push(query);
    parts.push('');
    parts.push('Upstream context:');
    for (const dep of deps) {
      const output = outputs.get(dep) ?? '';
      parts.push(`[${dep}]`);
      parts.push(output);
      parts.push('');
    }
    return parts.join('\n').trim();
  }

  private async runSingleAgent(
    agentId: string,
    agent: ComposedAgent,
    query: string,
    sharedHistory: InMemoryChatHistory | undefined,
    emit: (event: OrchestrationEvent) => void
  ): Promise<string> {
    let final = '';

    for await (const event of agent.run(query, sharedHistory, `${this.config.name}:${agentId}`)) {
      if (event.type === 'done') {
        final = event.answer;
      }
      if (event.type === 'thinking') {
        emit({ type: 'agent_thinking', agentId, content: event.message });
      }
      if (event.type === 'tool_start') {
        emit({ type: 'agent_tool_call', agentId, tool: event.tool, args: event.args });
      }
      if (event.type === 'tool_end') {
        emit({ type: 'agent_tool_end', agentId, tool: event.tool, durationMs: event.duration });
      }
      if (event.type === 'tool_error') {
        emit({ type: 'agent_tool_error', agentId, tool: event.tool, error: event.error });
      }
    }

    return final;
  }

  private async *runGraphSequential(query: string, sharedHistory?: InMemoryChatHistory): AsyncGenerator<OrchestrationEvent> {
    const { depsByAgent, dependentsByAgent } = this.buildDependencyGraph();
    const outputs = new Map<string, string>();
    const results: Array<{ id: string; result: string }> = [];
    const order = this.config.agents.map(agent => agent.id);
    const remaining = new Map<string, Set<string>>();

    for (const [id, deps] of depsByAgent.entries()) {
      remaining.set(id, new Set(deps));
    }

    const started = new Set<string>();
    while (started.size < order.length) {
      const nextId = order.find(id => !started.has(id) && (remaining.get(id)?.size ?? 0) === 0);
      if (!nextId) break;

      const deps = Array.from(depsByAgent.get(nextId) ?? []);
      const input = this.formatAgentInput(query, deps, outputs);
      const entry = this.agents.get(nextId);
      if (!entry) {
        throw new Error(`Agent not initialized: ${nextId}`);
      }

      const queue = this.createEventQueue<OrchestrationEvent>();
      let output = '';

      void (async () => {
        queue.push({ type: 'agent_start', agentId: nextId });
        output = await this.runSingleAgent(nextId, entry.agent, input, sharedHistory, queue.push);
        queue.push({ type: 'agent_done', agentId: nextId, output });
        const dependents = Array.from(dependentsByAgent.get(nextId) ?? []);
        for (const dependent of dependents) {
          queue.push({ type: 'handoff', from: nextId, to: dependent, data: output });
          remaining.get(dependent)?.delete(nextId);
        }
        queue.close();
      })();

      for await (const event of queue.iterator()) {
        yield event;
      }

      results.push({ id: nextId, result: output });
      outputs.set(nextId, output);

      started.add(nextId);
    }

    const aggregated = this.aggregate(results);
    yield { type: 'orchestration_done', result: aggregated };
  }

  private async *runGraphParallel(query: string, sharedHistory?: InMemoryChatHistory): AsyncGenerator<OrchestrationEvent> {
    const { depsByAgent, dependentsByAgent } = this.buildDependencyGraph();
    const outputs = new Map<string, string>();
    const results = new Map<string, string>();
    const order = this.config.agents.map(agent => agent.id);
    const remaining = new Map<string, Set<string>>();

    for (const [id, deps] of depsByAgent.entries()) {
      remaining.set(id, new Set(deps));
    }

    const queue = this.createEventQueue<OrchestrationEvent>();
    const started = new Set<string>();
    let completed = 0;
    let inFlight = 0;

    const startAgent = (agentId: string) => {
      if (started.has(agentId)) return;
      started.add(agentId);
      const deps = Array.from(depsByAgent.get(agentId) ?? []);
      const input = this.formatAgentInput(query, deps, outputs);
      const entry = this.agents.get(agentId);
      if (!entry) {
        queue.push({ type: 'orchestration_done', result: `Agent not initialized: ${agentId}` });
        return;
      }

      queue.push({ type: 'agent_start', agentId });
      inFlight += 1;
      void (async () => {
        const output = await this.runSingleAgent(agentId, entry.agent, input, sharedHistory, queue.push);
        results.set(agentId, output);
        outputs.set(agentId, output);
        queue.push({ type: 'agent_done', agentId, output });

        const dependents = Array.from(dependentsByAgent.get(agentId) ?? []);
        for (const dependent of dependents) {
          queue.push({ type: 'handoff', from: agentId, to: dependent, data: output });
          remaining.get(dependent)?.delete(agentId);
        }

        completed += 1;
        inFlight -= 1;

        for (const id of order) {
          if ((remaining.get(id)?.size ?? 0) === 0 && !results.has(id)) {
            startAgent(id);
          }
        }

        if (completed === order.length && inFlight === 0) {
          const aggregated = this.aggregate(order.map(id => ({ id, result: results.get(id) ?? '' })));
          queue.push({ type: 'orchestration_done', result: aggregated });
          queue.close();
        }
      })();
    };

    for (const id of order) {
      if ((remaining.get(id)?.size ?? 0) === 0) {
        startAgent(id);
      }
    }

    for await (const event of queue.iterator()) {
      yield event;
    }
  }

  private createEventQueue<T>() {
    const events: T[] = [];
    let resolve: ((value: IteratorResult<T>) => void) | null = null;
    let closed = false;

    const push = (event: T) => {
      if (closed) return;
      if (resolve) {
        const pending = resolve;
        resolve = null;
        pending({ value: event, done: false });
      } else {
        events.push(event);
      }
    };

    const close = () => {
      closed = true;
      if (resolve) {
        resolve({ value: undefined as any, done: true });
      }
    };

    const iterator = async function* () {
      while (true) {
        if (events.length > 0) {
          yield events.shift() as T;
          continue;
        }
        if (closed) return;
        const next = await new Promise<IteratorResult<T>>((r) => {
          resolve = r;
        });
        if (next.done) return;
        yield next.value;
      }
    };

    return { push, close, iterator };
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
