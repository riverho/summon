import { describe, expect, test } from 'bun:test';
import { AgentOrchestrator } from './orchestrator.js';
import { ComposedAgent } from '../components/composed-agent.js';

function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  return (async () => {
    for await (const v of iter) out.push(v);
    return out;
  })();
}

describe('AgentOrchestrator', () => {
  test('parallel DAG emits handoff and orchestration_done (no-tools smoke)', async () => {
    const orchestrator = new AgentOrchestrator({
      name: 'smoke',
      version: '1.0.0',
      orchestration: {
        pattern: 'parallel',
        maxAgents: 5,
        maxIterations: 5,
        timeoutMs: 60_000,
      },
      agents: [
        {
          id: 'a',
          outputTo: ['b'],
          persona: {
            role: 'A',
            goal: 'Say hi',
            backstory: 'test',
          },
          skills: [],
        },
        {
          id: 'b',
          persona: {
            role: 'B',
            goal: 'Ack',
            backstory: 'test',
          },
          skills: [],
        },
      ],
      output: {
        format: 'markdown',
        aggregator: 'concatenate',
      },
    });

    await orchestrator.initialize();
    const events = await collect(orchestrator.run('hello'));

    expect(events.some(e => (e as any).type === 'agent_start')).toBe(true);
    expect(events.some(e => (e as any).type === 'handoff')).toBe(true);

    const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
    expect(done).toBeTruthy();
    expect(typeof done.result).toBe('string');
    expect(done.result.length).toBeGreaterThan(0);
  });

  test('hierarchical runs coordinator then emits implicit handoff to others', async () => {
    const orchestrator = new AgentOrchestrator({
      name: 'hier',
      version: '1.0.0',
      orchestration: {
        pattern: 'hierarchical',
        maxAgents: 5,
        maxIterations: 5,
        timeoutMs: 60_000,
        coordinatorPlanOverride: {
          run: ['worker'],
          pattern: 'parallel',
          final: null,
          handoffs: [],
        },
      },
      agents: [
        { id: 'coord', persona: { role: 'C', goal: 'x', backstory: 'x' }, skills: [] },
        { id: 'worker', persona: { role: 'W', goal: 'x', backstory: 'x' }, skills: [] },
      ],
      output: { format: 'markdown', aggregator: 'concatenate' },
    } as any);

    await orchestrator.initialize();
    const events = await collect(orchestrator.run('hello'));

    // coordinator start should appear before worker start
    const coordStartIdx = events.findIndex(e => (e as any).type === 'agent_start' && (e as any).agentId === 'coord');
    const workerStartIdx = events.findIndex(e => (e as any).type === 'agent_start' && (e as any).agentId === 'worker');
    expect(coordStartIdx).toBeGreaterThanOrEqual(0);
    expect(workerStartIdx).toBeGreaterThanOrEqual(0);
    expect(coordStartIdx).toBeLessThan(workerStartIdx);

    // implicit handoff should exist
    expect(events.some(e => (e as any).type === 'handoff' && (e as any).from === 'coord' && (e as any).to === 'worker')).toBe(true);

    const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
    expect(done).toBeTruthy();
  });

  test('hierarchical injects coordinator planning contract into coordinator system prompt', async () => {
    const orchestrator = new AgentOrchestrator({
      name: 'hier-inject',
      version: '1.0.0',
      orchestration: {
        pattern: 'hierarchical',
        maxAgents: 5,
        maxIterations: 5,
        timeoutMs: 60_000,
      },
      agents: [
        { id: 'coord', persona: { role: 'C', goal: 'x', backstory: 'x' }, skills: [] },
        { id: 'worker', persona: { role: 'W', goal: 'x', backstory: 'x' }, skills: [] },
      ],
    } as any);

    await orchestrator.initialize();
    const spec = (orchestrator as any).agents.get('coord')?.spec;
    expect(spec).toBeTruthy();
    expect(String(spec.systemPrompt)).toMatch(/Coordinator Planning Contract/i);
    expect(String(spec.systemPrompt)).toMatch(/\"run\"/);
  });

  test('hierarchical follows coordinatorPlanOverride (run subset + final)', async () => {
    const orchestrator = new AgentOrchestrator({
      name: 'hier-plan',
      version: '1.0.0',
      orchestration: {
        pattern: 'hierarchical',
        maxAgents: 5,
        maxIterations: 5,
        timeoutMs: 60_000,
        coordinatorPlanOverride: {
          run: ['workerA'],
          pattern: 'sequential',
          final: 'final',
          handoffs: [],
        },
      },
      agents: [
        { id: 'coord', persona: { role: 'C', goal: 'x', backstory: 'x' }, skills: [] },
        { id: 'workerA', persona: { role: 'A', goal: 'x', backstory: 'x' }, skills: [] },
        { id: 'workerB', persona: { role: 'B', goal: 'x', backstory: 'x' }, skills: [] },
        { id: 'final', persona: { role: 'F', goal: 'x', backstory: 'x' }, skills: [] },
      ],
      output: { format: 'markdown', aggregator: 'concatenate' },
    } as any);

    await orchestrator.initialize();
    const events = await collect(orchestrator.run('hello'));

    // should start workerA + final, but NOT workerB
    expect(events.some(e => (e as any).type === 'agent_start' && (e as any).agentId === 'workerA')).toBe(true);
    expect(events.some(e => (e as any).type === 'agent_start' && (e as any).agentId === 'final')).toBe(true);
    expect(events.some(e => (e as any).type === 'agent_start' && (e as any).agentId === 'workerB')).toBe(false);

    const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
    expect(done).toBeTruthy();
  });

  test('cycle detection rejects cyclic graphs', () => {
    expect(() =>
      new AgentOrchestrator({
        name: 'cycle',
        version: '1.0.0',
        orchestration: { pattern: 'parallel', maxAgents: 5, maxIterations: 5, timeoutMs: 60_000 },
        agents: [
          { id: 'a', outputTo: ['b'], persona: { role: 'A', goal: 'x', backstory: 'x' }, skills: [] },
          { id: 'b', outputTo: ['a'], persona: { role: 'B', goal: 'x', backstory: 'x' }, skills: [] },
        ],
      } as any)
    ).toThrow(/cycle/i);
  });

  test('guardrails stop orchestration when maxEvents exceeded', async () => {
    const orchestrator = new AgentOrchestrator({
      name: 'guardrails',
      version: '1.0.0',
      orchestration: {
        pattern: 'parallel',
        maxAgents: 5,
        maxIterations: 5,
        timeoutMs: 60_000,
        maxEvents: 1,
      },
      agents: [
        { id: 'a', persona: { role: 'A', goal: 'x', backstory: 'x' }, skills: [] },
      ],
    } as any);

    await orchestrator.initialize();
    const events = await collect(orchestrator.run('hello'));

    const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
    expect(done).toBeTruthy();
    expect(String(done.result)).toMatch(/maxEvents/i);
  });

  test('per-agent timeout stops slow agents', async () => {
    const originalRun = ComposedAgent.prototype.run;
    ComposedAgent.prototype.run = async function* () {
      await new Promise(resolve => setTimeout(resolve, 50));
      yield {
        type: 'done',
        answer: '[slow] ok',
        toolCalls: [],
        iterations: 1,
      } as any;
    };

    try {
      const orchestrator = new AgentOrchestrator({
        name: 'timeouts',
        version: '1.0.0',
        orchestration: {
          pattern: 'sequential',
          maxAgents: 5,
          maxIterations: 5,
          timeoutMs: 60_000,
          perAgentTimeoutMs: 10,
        },
        agents: [
          { id: 'slow', persona: { role: 'S', goal: 'x', backstory: 'x' }, skills: [] },
        ],
      } as any);

      await orchestrator.initialize();
      const events = await collect(orchestrator.run('hello'));
      const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
      expect(done).toBeTruthy();
      expect(String(done.result)).toMatch(/timed out/i);
    } finally {
      ComposedAgent.prototype.run = originalRun;
    }
  });

  test('external cancellation stops orchestration', async () => {
    const originalRun = ComposedAgent.prototype.run;
    ComposedAgent.prototype.run = async function* () {
      await new Promise(resolve => setTimeout(resolve, 50));
      yield {
        type: 'done',
        answer: '[slow] ok',
        toolCalls: [],
        iterations: 1,
      } as any;
    };

    try {
      const orchestrator = new AgentOrchestrator({
        name: 'cancel',
        version: '1.0.0',
        orchestration: {
          pattern: 'sequential',
          maxAgents: 5,
          maxIterations: 5,
          timeoutMs: 60_000,
        },
        agents: [
          { id: 'slow', persona: { role: 'S', goal: 'x', backstory: 'x' }, skills: [] },
        ],
      } as any);

      await orchestrator.initialize();
      const controller = new AbortController();
      const eventsPromise = collect(orchestrator.run('hello', undefined, { signal: controller.signal }));
      controller.abort('user cancelled');
      const events = await eventsPromise;

      const done = [...events].reverse().find(e => (e as any).type === 'orchestration_done') as any;
      expect(done).toBeTruthy();
      expect(String(done.result)).toMatch(/cancel/i);
    } finally {
      ComposedAgent.prototype.run = originalRun;
    }
  });
});
