# Multi-Agent Implementation Plan for Summon

**Generated:** 2026-02-04  
**Based on:** multi-agent-analysis.md + Claude Code session output  
**Target:** Enable 3-5 sub-agents in scope

---

## Executive Summary

Extend Summon framework to support real multi-agent orchestration with spawning and sessions. The orchestrator stub (`src/orchestration/orchestrator.ts`) needs full implementation.

**Sweet spot:** 3-5 specialized agents with clear handoff points.

---

## 1. New CLI Commands

```bash
# Run multi-agent orchestration from config
summon orchestrate team.yaml "Your query"

# Run multiple agents in parallel (quick mode)
summon parallel agent1.yaml agent2.yaml "query"

# Named team composition
summon teams list
summon teams run research-team "Analyze market trends"
```

---

## 2. Configuration Format

### Multi-Agent YAML (`team.yaml`)

```yaml
name: research-team
version: '1.0.0'
description: A team of agents working together

orchestration:
  pattern: parallel | sequential | hierarchical
  maxAgents: 5          # Hard cap
  maxIterations: 20
  timeoutMs: 120000

agents:
  - id: researcher
    ritual: $ref:rituals/researcher.yaml
    # OR inline:
    persona: $ref:personas/researcher
    skills: [$ref:skills/web-search, $ref:skills/data-analysis]
    outputTo: [synthesizer]  # Route output to next agent

  - id: analyst
    ritual: $ref:rituals/analyst.yaml
    outputTo: [synthesizer]

  - id: synthesizer
    persona: $ref:personas/synthesizer
    skills: [$ref:skills/report-writing]
    listenFrom: [researcher, analyst]  # Wait for these

sharedContext:
  - query
  - researchResults
  - analysis

output:
  format: markdown | json | structured
  aggregator: last | first | concatenate | summarize
```

---

## 3. TypeScript Interfaces

```typescript
// src/orchestration/types.ts

export interface MultiAgentConfig {
  name: string;
  version: string;
  description?: string;
  orchestration: OrchestrationConfig;
  agents: AgentNode[];
  sharedContext?: string[];
  output?: OutputConfig;
}

export interface OrchestrationConfig {
  pattern: 'parallel' | 'sequential' | 'hierarchical';
  maxAgents?: number;      // Default: 5
  maxIterations?: number;  // Default: 20
  timeoutMs?: number;      // Default: 120000
}

export interface AgentNode {
  id: string;
  ritual?: string;         // $ref to ritual YAML
  persona?: PersonaOrRef;  // Inline persona
  skills?: SkillOrRef[];   // Inline skills
  model?: ModelConfig;
  outputTo?: string[];     // Agent IDs to send output
  listenFrom?: string[];   // Agent IDs to wait for
}

export interface OutputConfig {
  format: 'markdown' | 'json' | 'structured';
  aggregator: 'last' | 'first' | 'concatenate' | 'summarize';
}

// Events for orchestration
export type OrchestrationEvent =
  | { type: 'agent_start'; agentId: string }
  | { type: 'agent_thinking'; agentId: string; content: string }
  | { type: 'agent_tool_call'; agentId: string; tool: string; args: unknown }
  | { type: 'agent_done'; agentId: string; output: string }
  | { type: 'handoff'; from: string; to: string; data: unknown }
  | { type: 'orchestration_done'; result: string };
```

---

## 4. Orchestrator Implementation

```typescript
// src/orchestration/orchestrator.ts

import { ComposedAgent } from '../components/composed-agent.js';
import { MultiAgentConfig, OrchestrationEvent, AgentNode } from './types.js';

export class AgentOrchestrator {
  private config: MultiAgentConfig;
  private agents: Map<string, ComposedAgent> = new Map();
  private context: Map<string, unknown> = new Map();
  private messageQueue: Array<{ from: string; to: string; data: unknown }> = [];

  constructor(config: MultiAgentConfig) {
    this.config = config;
    this.validateConfig();
  }

  private validateConfig(): void {
    const { agents, orchestration } = this.config;
    
    // Enforce hard cap
    if (agents.length > (orchestration.maxAgents || 5)) {
      throw new Error(`Too many agents: ${agents.length}. Max allowed: ${orchestration.maxAgents || 5}`);
    }

    // Validate agent references
    const agentIds = new Set(agents.map(a => a.id));
    for (const agent of agents) {
      for (const target of agent.outputTo || []) {
        if (!agentIds.has(target)) {
          throw new Error(`Agent "${agent.id}" outputs to unknown agent "${target}"`);
        }
      }
    }
  }

  async initialize(): Promise<void> {
    for (const agentConfig of this.config.agents) {
      const agent = await this.createAgent(agentConfig);
      this.agents.set(agentConfig.id, agent);
    }
  }

  async *run(query: string): AsyncGenerator<OrchestrationEvent> {
    this.context.set('query', query);

    switch (this.config.orchestration.pattern) {
      case 'parallel':
        yield* this.runParallel(query);
        break;
      case 'sequential':
        yield* this.runSequential(query);
        break;
      case 'hierarchical':
        yield* this.runHierarchical(query);
        break;
    }
  }

  private async *runParallel(query: string): AsyncGenerator<OrchestrationEvent> {
    // Run all agents simultaneously
    const promises = Array.from(this.agents.entries()).map(
      async ([id, agent]) => {
        yield { type: 'agent_start' as const, agentId: id };
        const result = await this.runAgent(agent, query);
        yield { type: 'agent_done' as const, agentId: id, output: result };
        return { id, result };
      }
    );

    const results = await Promise.all(promises);
    const aggregated = this.aggregateResults(results);
    
    yield { type: 'orchestration_done', result: aggregated };
  }

  private async *runSequential(query: string): AsyncGenerator<OrchestrationEvent> {
    let currentInput = query;
    
    for (const [id, agent] of this.agents) {
      yield { type: 'agent_start' as const, agentId: id };
      
      const result = await this.runAgent(agent, currentInput);
      this.context.set(`${id}_output`, result);
      
      yield { type: 'agent_done' as const, agentId: id, output: result };
      
      // Pass output to next agent
      currentInput = result;
    }

    yield { type: 'orchestration_done', result: currentInput };
  }

  private async *runHierarchical(query: string): AsyncGenerator<OrchestrationEvent> {
    // First agent is coordinator
    const [coordinatorId, coordinator] = Array.from(this.agents.entries())[0];
    
    yield { type: 'agent_start' as const, agentId: coordinatorId };
    
    // Coordinator decides which specialists to invoke
    // ... implementation details
    
    yield { type: 'orchestration_done', result: 'TODO' };
  }

  private aggregateResults(results: Array<{ id: string; result: string }>): string {
    const { aggregator } = this.config.output || { aggregator: 'last' };
    
    switch (aggregator) {
      case 'first':
        return results[0]?.result || '';
      case 'last':
        return results[results.length - 1]?.result || '';
      case 'concatenate':
        return results.map(r => `[${r.id}]\n${r.result}`).join('\n\n');
      case 'summarize':
        // TODO: Use LLM to summarize
        return results.map(r => r.result).join('\n---\n');
    }
  }
}
```

---

## 5. Implementation Phases

### Phase 1: Core Types & Validation (Day 1)
- [ ] Create `src/orchestration/types.ts` with interfaces
- [ ] Add Zod schemas for YAML validation
- [ ] Implement config validation in orchestrator

### Phase 2: Orchestrator Core (Day 2-3)
- [ ] Implement `AgentOrchestrator.initialize()`
- [ ] Implement parallel pattern (simplest)
- [ ] Implement sequential pattern
- [ ] Add event streaming via async generators

### Phase 3: CLI Integration (Day 4)
- [ ] Add `summon orchestrate` command
- [ ] Add `summon parallel` command
- [ ] Add `summon teams` commands

### Phase 4: Hierarchical Pattern (Day 5)
- [ ] Implement coordinator delegation logic
- [ ] Add message passing between agents
- [ ] Handle agent dependencies (`listenFrom`)

### Phase 5: Polish & Documentation (Day 6)
- [ ] Example team configs
- [ ] Unit tests for orchestrator
- [ ] Error handling and timeouts
- [ ] Update README

---

## 6. Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Max agents | Hard cap of 5 | Sweet spot from analysis; complexity explodes beyond |
| Event model | Async generators | Matches existing `ComposedAgent` pattern |
| Config format | YAML with $ref | Consistent with existing rituals |
| Patterns | 3 (parallel/sequential/hierarchical) | Covers common use cases |
| Backwards compat | Yes | Single-agent rituals unchanged |

---

## 7. Integration Points

### With Existing Code
- `ComposedAgent` — unchanged, orchestrator wraps it
- `registry.ts` — extend to load team configs
- `cli/index.ts` — add new commands
- `runtime/session.ts` — extend for multi-agent session logs

### New Files
```
src/orchestration/
├── types.ts           # Interfaces and schemas
├── orchestrator.ts    # Main orchestrator class
├── patterns/
│   ├── parallel.ts    # Parallel execution
│   ├── sequential.ts  # Pipeline execution
│   └── hierarchical.ts # Coordinator pattern
└── index.ts           # Public exports
```

---

## 8. Example Usage

```bash
# Create a research team
summon orchestrate examples/teams/research-team.yaml "Analyze Q4 earnings for NVDA"

# Quick parallel run
summon parallel examples/agents/researcher.yaml examples/agents/analyst.yaml "Market trends 2026"

# List available teams
summon teams list
```

---

*Reconstructed from Claude Code session output + multi-agent-analysis.md*
