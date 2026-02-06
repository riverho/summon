import { ComposedAgent } from '../components/composed-agent.js';
import { composeAgent } from '../components/composer.js';
import { createComponentRegistry, loadAgentComposition, resolvePath } from '../components/registry.js';
import type { InMemoryChatHistory } from '../runtime/memory.js';
import type { ComposedAgentSpec } from '../components/composer.js';
import { CoordinatorPlanSchema, type CoordinatorPlan, MultiAgentConfigSchema, type AgentNode, type MultiAgentConfig, type OrchestrationEvent, toAgentComposition } from './types.js';

type PauseStage = 'coordinator' | 'handoff' | 'final';

type RunGuard = {
  emit: (event: OrchestrationEvent) => void;
  emitDone: (result: string) => void;
  emitPause: (stage: PauseStage, message?: string) => void;
  stop: (message: string) => void;
  isStopped: () => boolean;
};

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
      let spec = composeAgent(composition);

      // Node-level model override (optional)
      if (node.model?.primary) {
        (spec as any).model = node.model.primary;
      }

      // Coordinator prompt injection (hierarchical pattern)
      // We inject a strict planning contract into the *coordinator* system prompt
      // so it outputs a machine-readable plan.
      if (this.config.orchestration.pattern === 'hierarchical') {
        const firstId = this.config.agents[0]?.id;
        if (firstId && node.id === firstId) {
          const contract = `\n\n## Coordinator Planning Contract (STRICT)\n\nYou are the **Coordinator** for a multi-agent run.\n\nYou MUST output a plan as STRICT JSON (no prose).\nPrefer wrapping in a \`\`\`json code block.\n\nSchema:\n{\n  \"run\": [\"agentId\", ...],\n  \"pattern\": \"parallel\" | \"sequential\",\n  \"final\": \"agentId\" | null,\n  \"handoffs\": [{\"from\": \"a\", \"to\": \"b\"}]\n}\n\nRules:\n- Use only agentIds from this team: ${this.config.agents.map(a => a.id).join(', ')}\n- \"run\" must NOT include yourself (${node.id}).\n- If you choose \"final\", it must be one of the agentIds (not yourself).\n- Keep \"handoffs\" empty unless you are certain.\n- If unsure, choose a minimal safe plan: {\"run\": [${JSON.stringify(this.config.agents.slice(1).map(a => a.id)[0] ?? '')}], \"pattern\": \"parallel\", \"final\": null, \"handoffs\": []}\n`;

          spec = { ...spec, systemPrompt: `${spec.systemPrompt}${contract}` };
        }
      }

      const agent = ComposedAgent.create(spec);
      this.agents.set(node.id, { node, spec, agent });
    }

    // Registry currently unused; kept for future checks.
    void registry;
  }

  async *run(
    query: string,
    sharedHistory?: InMemoryChatHistory,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<OrchestrationEvent> {
    if (this.agents.size === 0) {
      await this.initialize();
    }

    switch (this.config.orchestration.pattern) {
      case 'parallel':
        yield* this.runGraphParallel(query, sharedHistory, options?.signal);
        return;
      case 'sequential':
        yield* this.runGraphSequential(query, sharedHistory, options?.signal);
        return;
      case 'hierarchical':
        yield* this.runHierarchical(query, sharedHistory, options?.signal);
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
    spec: ComposedAgentSpec,
    query: string,
    sharedHistory: InMemoryChatHistory | undefined,
    emit: (event: OrchestrationEvent) => void,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<string> {
    let final = '';
    const { controller, cleanup } = this.createLinkedAbortController(options?.signal);
    const agent = ComposedAgent.create(spec, controller.signal);
    const iterator = agent.run(query, sharedHistory, `${this.config.name}:${agentId}`)[Symbol.asyncIterator]();
    const timeoutMs = options?.timeoutMs;
    const deadline = timeoutMs ? Date.now() + timeoutMs : null;

    try {
      while (true) {
        const timeLeft = deadline ? Math.max(0, deadline - Date.now()) : undefined;
        if (deadline && timeLeft === 0) {
          controller.abort(`Agent "${agentId}" timed out after ${timeoutMs}ms.`);
          throw new Error(`Agent "${agentId}" timed out after ${timeoutMs}ms.`);
        }

        const next = await this.nextWithTimeout(iterator.next(), timeLeft);
        if (next.done) break;
        const event = next.value;

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
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error);
      const message = rawMessage.includes('Timeout while awaiting agent output') && timeoutMs
        ? `Agent "${agentId}" timed out after ${timeoutMs}ms.`
        : rawMessage;
      final = `[${agentId}] ${message}`;
      try {
        await iterator.return?.(undefined);
      } catch {
        // ignore iterator cleanup errors
      }
    } finally {
      cleanup();
    }

    return final;
  }

  private extractCoordinatorPlan(text: string): CoordinatorPlan | null {
    if (this.config.orchestration.coordinatorPlanOverride) {
      return CoordinatorPlanSchema.parse(this.config.orchestration.coordinatorPlanOverride);
    }

    // Try ```json ...``` fenced block first
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
    if (fenced?.[1]) {
      const obj = this.parseStrictJsonObject(fenced[1]);
      if (!obj) return null;
      try {
        return CoordinatorPlanSchema.parse(obj);
      } catch {
        return null;
      }
    }

    const obj = this.parseStrictJsonObject(trimmed);
    if (!obj) return null;
    try {
      return CoordinatorPlanSchema.parse(obj);
    } catch {
      return null;
    }
  }

  private parseStrictJsonObject(text: string): unknown | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  private validateCoordinatorPlan(plan: CoordinatorPlan, coordinatorId: string): CoordinatorPlan {
    const agentIds = new Set(this.config.agents.map(agent => agent.id));
    const run = plan.run.filter(id => typeof id === 'string' && id.length > 0);

    if (run.length === 0) {
      throw new Error('Coordinator plan "run" must include at least one agent id.');
    }

    const runSet = new Set(run);
    if (runSet.size !== run.length) {
      throw new Error('Coordinator plan "run" contains duplicate agent ids.');
    }

    for (const id of run) {
      if (!agentIds.has(id)) throw new Error(`Coordinator plan references unknown agent "${id}".`);
      if (id === coordinatorId) throw new Error('Coordinator plan "run" must not include the coordinator.');
    }

    if (plan.final) {
      if (!agentIds.has(plan.final)) {
        throw new Error(`Coordinator plan "final" references unknown agent "${plan.final}".`);
      }
      if (plan.final === coordinatorId) {
        throw new Error('Coordinator plan "final" must not be the coordinator.');
      }
    }

    for (const handoff of plan.handoffs ?? []) {
      if (!agentIds.has(handoff.from)) {
        throw new Error(`Coordinator plan handoff references unknown agent "${handoff.from}".`);
      }
      if (!agentIds.has(handoff.to)) {
        throw new Error(`Coordinator plan handoff references unknown agent "${handoff.to}".`);
      }
      if (handoff.to === coordinatorId) {
        throw new Error('Coordinator plan handoff target must not be the coordinator.');
      }
      if (handoff.from === handoff.to) {
        throw new Error(`Coordinator plan handoff "${handoff.from}" -> "${handoff.to}" is invalid.`);
      }
    }

    return { ...plan, run };
  }

  private async *runHierarchical(
    query: string,
    sharedHistory?: InMemoryChatHistory,
    signal?: AbortSignal
  ): AsyncGenerator<OrchestrationEvent> {
    const order = this.config.agents.map(agent => agent.id);
    const coordinatorId = order[0];
    if (!coordinatorId) {
      yield { type: 'orchestration_done', result: '' };
      return;
    }

    const coordQueue = this.createEventQueue<OrchestrationEvent>();
    const { controller, cleanup: cleanupSignal } = this.createLinkedAbortController(signal);
    const guard = this.createRunGuard(coordQueue, controller.abort.bind(controller));
    const cleanupTimers = this.applyRunTimeouts(controller, guard);

    void (async () => {
      try {
        const coordinator = this.agents.get(coordinatorId);
        if (!coordinator) {
          guard.emitDone(`Agent not initialized: ${coordinatorId}`);
          return;
        }

        let coordOutput = '';
        guard.emit({ type: 'agent_start', agentId: coordinatorId });
        coordOutput = await this.runSingleAgent(
          coordinatorId,
          coordinator.spec,
          query,
          sharedHistory,
          guard.emit,
          { signal: controller.signal, timeoutMs: coordinator.node.timeoutMs ?? this.config.orchestration.perAgentTimeoutMs }
        );
        guard.emit({ type: 'agent_done', agentId: coordinatorId, output: coordOutput });
        if (guard.isStopped()) return;

        if (this.shouldPauseAfter('coordinator')) {
          guard.emitPause('coordinator', `Paused after coordinator (${coordinatorId}).`);
          return;
        }

        const seededOutputs = new Map<string, string>();
        seededOutputs.set(coordinatorId, coordOutput);

        const rawPlan = this.extractCoordinatorPlan(coordOutput);
        if (!rawPlan) {
          guard.emitDone('Coordinator did not return a valid JSON plan.');
          return;
        }

        let plan: CoordinatorPlan;
        try {
          plan = this.validateCoordinatorPlan(rawPlan, coordinatorId);
        } catch (error) {
          guard.emitDone(`Invalid coordinator plan: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }

        const workers = plan.run;
        const finalId = plan.final && plan.final !== coordinatorId ? plan.final : null;
        const allowedAgents = new Set<string>([...workers, ...(finalId ? [finalId] : [])]);

        // Coordinator hands off to all downstream agents (implicit context).
        const implicitTargets = Array.from(allowedAgents);
        for (const id of implicitTargets) {
          guard.emit({ type: 'handoff', from: coordinatorId, to: id, data: coordOutput });
          if (guard.isStopped()) return;
        }

        const extraDeps = new Map<string, Set<string>>();
        for (const id of allowedAgents) {
          extraDeps.set(id, new Set([coordinatorId]));
        }

        for (const handoff of plan.handoffs ?? []) {
          if (!allowedAgents.has(handoff.to)) continue;
          const set = extraDeps.get(handoff.to) ?? new Set<string>();
          set.add(handoff.from);
          extraDeps.set(handoff.to, set);
        }

        if (finalId && allowedAgents.has(finalId)) {
          const set = extraDeps.get(finalId) ?? new Set<string>();
          for (const id of workers) set.add(id);
          extraDeps.set(finalId, set);
        }

        const pattern = plan.pattern ?? 'parallel';
        const runner = pattern === 'sequential'
          ? this.runGraphSequential(query, sharedHistory, controller.signal, {
              allowedAgents,
              seededOutputs,
              extraDeps,
            })
          : this.runGraphParallel(query, sharedHistory, controller.signal, {
              allowedAgents,
              seededOutputs,
              extraDeps,
            });

        for await (const ev of runner) {
          if (guard.isStopped()) return;
          if (ev.type === 'orchestration_pause') {
            guard.emitPause(ev.stage, ev.message);
            return;
          }
          if (ev.type === 'orchestration_done') {
            guard.emitDone(ev.result);
            return;
          }
          guard.emit(ev);
        }
      } catch (e) {
        guard.emitDone(`Hierarchical run failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    try {
      for await (const ev of coordQueue.iterator()) {
        yield ev;
      }
    } finally {
      cleanupTimers();
      cleanupSignal();
    }
  }

  private async *runGraphSequential(
    query: string,
    sharedHistory?: InMemoryChatHistory,
    signal?: AbortSignal,
    options?: {
      allowedAgents?: Set<string>;
      seededOutputs?: Map<string, string>;
      extraDeps?: Map<string, Set<string>>;
    }
  ): AsyncGenerator<OrchestrationEvent> {
    const allowedAgents = options?.allowedAgents ?? new Set(this.config.agents.map(agent => agent.id));
    const seededOutputs = options?.seededOutputs ?? new Map<string, string>();
    const { depsByAgent: baseDeps } = this.buildDependencyGraph();
    const depsByAgent = new Map<string, Set<string>>();
    const dependentsByAgent = new Map<string, Set<string>>();
    const outputs = new Map<string, string>(seededOutputs);
    const results: Array<{ id: string; result: string }> = [];
    const order = this.config.agents.map(agent => agent.id).filter(id => allowedAgents.has(id));

    for (const id of order) {
      dependentsByAgent.set(id, new Set());
      const merged = new Set<string>(baseDeps.get(id) ?? []);
      for (const dep of options?.extraDeps?.get(id) ?? []) {
        merged.add(dep);
      }
      for (const dep of merged) {
        if (!allowedAgents.has(dep) && !seededOutputs.has(dep)) {
          yield { type: 'orchestration_done', result: `Invalid plan: missing dependency "${dep}" for agent "${id}".` };
          return;
        }
      }
      depsByAgent.set(id, merged);
    }

    for (const [id, deps] of depsByAgent.entries()) {
      for (const dep of deps) {
        if (allowedAgents.has(dep)) {
          dependentsByAgent.get(dep)?.add(id);
        }
      }
    }
    const remaining = new Map<string, Set<string>>();

    for (const [id, deps] of depsByAgent.entries()) {
      const filtered = new Set(Array.from(deps).filter(dep => allowedAgents.has(dep)));
      remaining.set(id, filtered);
    }

    const queue = this.createEventQueue<OrchestrationEvent>();
    const { controller, cleanup: cleanupSignal } = this.createLinkedAbortController(signal);
    const guard = this.createRunGuard(queue, controller.abort.bind(controller));
    const cleanupTimers = this.applyRunTimeouts(controller, guard);

    void (async () => {
      try {
        const started = new Set<string>();
        while (started.size < order.length) {
          if (guard.isStopped()) return;
          const nextId = order.find(id => !started.has(id) && (remaining.get(id)?.size ?? 0) === 0);
          if (!nextId) break;

          const deps = Array.from(depsByAgent.get(nextId) ?? []);
          const input = this.formatAgentInput(query, deps, outputs);
          const entry = this.agents.get(nextId);
          if (!entry) {
            guard.emitDone(`Agent not initialized: ${nextId}`);
            return;
          }

          guard.emit({ type: 'agent_start', agentId: nextId });
          const output = await this.runSingleAgent(
            nextId,
            entry.spec,
            input,
            sharedHistory,
            guard.emit,
            { signal: controller.signal, timeoutMs: entry.node.timeoutMs ?? this.config.orchestration.perAgentTimeoutMs }
          );
          guard.emit({ type: 'agent_done', agentId: nextId, output });

          const dependents = Array.from(dependentsByAgent.get(nextId) ?? []);
          for (const dependent of dependents) {
            guard.emit({ type: 'handoff', from: nextId, to: dependent, data: output });
            remaining.get(dependent)?.delete(nextId);
            if (guard.isStopped()) return;
          }

          results.push({ id: nextId, result: output });
          outputs.set(nextId, output);
          started.add(nextId);
        }

        const aggregated = this.aggregate(results);
        if (this.shouldPauseAfter('final')) {
          guard.emitPause('final', 'Paused after final aggregation.');
          return;
        }
        guard.emitDone(aggregated);
      } catch (e) {
        guard.emitDone(`Sequential run failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    })();

    try {
      for await (const event of queue.iterator()) {
        yield event;
      }
    } finally {
      cleanupTimers();
      cleanupSignal();
    }
  }

  private async *runGraphParallel(
    query: string,
    sharedHistory?: InMemoryChatHistory,
    signal?: AbortSignal,
    options?: {
      allowedAgents?: Set<string>;
      seededOutputs?: Map<string, string>;
      extraDeps?: Map<string, Set<string>>;
    }
  ): AsyncGenerator<OrchestrationEvent> {
    const allowedAgents = options?.allowedAgents ?? new Set(this.config.agents.map(agent => agent.id));
    const seededOutputs = options?.seededOutputs ?? new Map<string, string>();
    const { depsByAgent: baseDeps } = this.buildDependencyGraph();
    const depsByAgent = new Map<string, Set<string>>();
    const dependentsByAgent = new Map<string, Set<string>>();
    const outputs = new Map<string, string>(seededOutputs);
    const results = new Map<string, string>();
    const order = this.config.agents.map(agent => agent.id).filter(id => allowedAgents.has(id));

    for (const id of order) {
      dependentsByAgent.set(id, new Set());
      const merged = new Set<string>(baseDeps.get(id) ?? []);
      for (const dep of options?.extraDeps?.get(id) ?? []) {
        merged.add(dep);
      }
      for (const dep of merged) {
        if (!allowedAgents.has(dep) && !seededOutputs.has(dep)) {
          yield { type: 'orchestration_done', result: `Invalid plan: missing dependency "${dep}" for agent "${id}".` };
          return;
        }
      }
      depsByAgent.set(id, merged);
    }

    for (const [id, deps] of depsByAgent.entries()) {
      for (const dep of deps) {
        if (allowedAgents.has(dep)) {
          dependentsByAgent.get(dep)?.add(id);
        }
      }
    }
    const remaining = new Map<string, Set<string>>();

    for (const [id, deps] of depsByAgent.entries()) {
      const filtered = new Set(Array.from(deps).filter(dep => allowedAgents.has(dep)));
      remaining.set(id, filtered);
    }

    const queue = this.createEventQueue<OrchestrationEvent>();
    const { controller, cleanup: cleanupSignal } = this.createLinkedAbortController(signal);
    const guard = this.createRunGuard(queue, controller.abort.bind(controller));
    const cleanupTimers = this.applyRunTimeouts(controller, guard);
    const started = new Set<string>();
    let completed = 0;
    let inFlight = 0;

    const startAgent = (agentId: string) => {
      if (started.has(agentId) || guard.isStopped()) return;
      started.add(agentId);
      const deps = Array.from(depsByAgent.get(agentId) ?? []);
      const input = this.formatAgentInput(query, deps, outputs);
      const entry = this.agents.get(agentId);
      if (!entry) {
        guard.emitDone(`Agent not initialized: ${agentId}`);
        return;
      }

      guard.emit({ type: 'agent_start', agentId });
      inFlight += 1;
      void (async () => {
        const output = await this.runSingleAgent(
          agentId,
          entry.spec,
          input,
          sharedHistory,
          guard.emit,
          { signal: controller.signal, timeoutMs: entry.node.timeoutMs ?? this.config.orchestration.perAgentTimeoutMs }
        );
        results.set(agentId, output);
        outputs.set(agentId, output);
        guard.emit({ type: 'agent_done', agentId, output });

        const dependents = Array.from(dependentsByAgent.get(agentId) ?? []);
        for (const dependent of dependents) {
          guard.emit({ type: 'handoff', from: agentId, to: dependent, data: output });
          remaining.get(dependent)?.delete(agentId);
          if (guard.isStopped()) return;
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
          if (this.shouldPauseAfter('final')) {
            guard.emitPause('final', 'Paused after final aggregation.');
            return;
          }
          guard.emitDone(aggregated);
        }
      })();
    };

    for (const id of order) {
      if ((remaining.get(id)?.size ?? 0) === 0) {
        startAgent(id);
      }
    }

    try {
      for await (const event of queue.iterator()) {
        yield event;
      }
    } finally {
      cleanupTimers();
      cleanupSignal();
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

  private createLinkedAbortController(parentSignal?: AbortSignal): { controller: AbortController; cleanup: () => void } {
    const controller = new AbortController();
    if (!parentSignal) {
      return { controller, cleanup: () => {} };
    }
    if (parentSignal.aborted) {
      controller.abort(parentSignal.reason);
      return { controller, cleanup: () => {} };
    }
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', onAbort);
    return { controller, cleanup: () => parentSignal.removeEventListener('abort', onAbort) };
  }

  private applyRunTimeouts(controller: AbortController, guard: RunGuard): () => void {
    const timeoutMs = this.config.orchestration.timeoutMs;
    const timer = setTimeout(() => {
      controller.abort(`Orchestration timed out after ${timeoutMs}ms.`);
      guard.stop(`Orchestration timed out after ${timeoutMs}ms.`);
    }, timeoutMs);

    const onAbort = () => {
      guard.stop(controller.signal.reason ? String(controller.signal.reason) : 'Orchestration cancelled.');
    };
    controller.signal.addEventListener('abort', onAbort);

    return () => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', onAbort);
    };
  }

  private createRunGuard(
    queue: { push: (event: OrchestrationEvent) => void; close: () => void },
    abort: (reason?: string) => void
  ): RunGuard {
    const maxEvents = this.config.orchestration.maxEvents;
    const maxOutputChars = this.config.orchestration.maxOutputChars;
    const pauseAfter = new Set(this.config.orchestration.pauseAfter ?? []);
    let eventCount = 0;
    let outputChars = 0;
    let stopped = false;

    const emitDone = (result: string) => {
      if (stopped) return;
      const resultText = this.sanitizeFinalResult(result, maxOutputChars, outputChars);
      queue.push({ type: 'orchestration_done', result: resultText });
      stopped = true;
      queue.close();
    };

    const emitPause = (stage: PauseStage, message?: string) => {
      if (stopped) return;
      const msg = message ?? `Paused after ${stage}.`;
      queue.push({ type: 'orchestration_pause', stage, message: msg });
      stopped = true;
      queue.push({ type: 'orchestration_done', result: msg });
      queue.close();
      abort(msg);
    };

    const stop = (message: string) => {
      if (stopped) return;
      stopped = true;
      queue.push({ type: 'orchestration_done', result: message });
      queue.close();
      abort(message);
    };

    const emit = (event: OrchestrationEvent) => {
      if (stopped) return;
      const eventSize = this.estimateEventChars(event);
      if (maxEvents && eventCount + 1 > maxEvents) {
        stop(`Orchestration stopped: maxEvents (${maxEvents}) exceeded.`);
        return;
      }
      if (maxOutputChars && outputChars + eventSize > maxOutputChars) {
        stop(`Orchestration stopped: maxOutputChars (${maxOutputChars}) exceeded.`);
        return;
      }

      queue.push(event);
      eventCount += 1;
      outputChars += eventSize;

      if (event.type === 'handoff' && pauseAfter.has('handoff')) {
        emitPause('handoff', 'Paused after handoff.');
      }
    };

    return {
      emit,
      emitDone,
      emitPause,
      stop,
      isStopped: () => stopped,
    };
  }

  private shouldPauseAfter(stage: PauseStage): boolean {
    return (this.config.orchestration.pauseAfter ?? []).includes(stage);
  }

  private estimateEventChars(event: OrchestrationEvent): number {
    try {
      return JSON.stringify(event).length;
    } catch {
      return 0;
    }
  }

  private sanitizeFinalResult(result: string, maxOutputChars?: number, currentChars: number = 0): string {
    if (!maxOutputChars) return result;
    const remaining = maxOutputChars - currentChars;
    if (remaining <= 0) {
      return `Orchestration stopped: maxOutputChars (${maxOutputChars}) exceeded.`;
    }
    if (result.length > remaining) {
      return `${result.slice(0, Math.max(0, remaining - 24))}... [truncated]`;
    }
    return result;
  }

  private async nextWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    if (!timeoutMs) return promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('Timeout while awaiting agent output.'));
          }, timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
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
