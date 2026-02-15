# AO Agent (Agent Orchestrator)

Multi-agent orchestration specialist for Summon. Manages ephemeral sub-agents for complex workflows with checkpointing and observability.

## Quick Start

```bash
# Run AO with a test ritual
summon run ao --ritual ./examples/rituals/ao-test.yaml

# Or pass a goal and ritual inline
summon run ao "Analyze this codebase" --ritual summon://ao-agent
```

## Features

- **Parallel Execution**: Automatically parallelizes independent tasks
- **Smart Agent Selection**: Chooses optimal agent (claude/codex/kimi) per task type
- **Dependency DAG**: Builds and executes task dependencies correctly
- **Checkpointing**: Saves progress every 30 seconds
- **Cost Tracking**: Monitors token usage and costs per agent

## Ritual Format

```yaml
goal: Describe what you want to achieve

tasks:
  - id: unique-task-id
    type: task-type
    description: What this task does
    complexity: trivial | simple | moderate | complex
    dependsOn: [other-task-id]  # Optional dependencies
    agent: claude | codex | kimi | opencode  # Optional override
```

## Architecture

```
User Request
    ↓
AO Agent parses ritual
    ↓
Builds dependency DAG
    ↓
Spawns agents for ready tasks
    ↓
Aggregates outputs
    ↓
Reports results + costs
```

## Phase 1 Deliverables

- [x] `ao-agent.yaml` ritual definition
- [x] `ritual-orchestration` skill
- [x] `agent-spawning` skill
- [x] `checkpoint-management` skill
- [x] `observability` skill
- [x] Basic entry point (`src/agents/ao-agent.ts`)
- [ ] Full sessions_spawn integration
- [ ] D1 checkpoint persistence
- [ ] WebSocket progress streaming

## Next Steps (Phase 2+)

1. **Cloudflare Worker**: Deploy AO as a CF Worker with D1 for checkpoints
2. **Web Dashboard**: Real-time ritual monitoring at agents.summon-ai.com
3. **Agent Factory**: Interactive trainer creation flow
