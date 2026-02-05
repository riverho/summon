import { describe, expect, test } from 'bun:test';
import { AgentOrchestrator } from './orchestrator.js';

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
});
