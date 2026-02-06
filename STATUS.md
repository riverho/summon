# Status

Milestone 1 - Orchestrator DAG + Events (DONE)

Changed
- Implemented dependency graph validation and cycle detection for listenFrom/outputTo wiring.
- Added DAG-aware sequential and parallel execution with routing and handoff events.
- Emitted orchestration events for agent_start, agent_thinking, agent_tool_call, agent_done, handoff, orchestration_done.
- Added upstream context formatting for downstream inputs.

Files touched
- src/orchestration/orchestrator.ts
- STATUS.md
- REVIEW.md

Commands to run
- bun run typecheck

Milestone 2 - Examples + Smoke (IN PROGRESS)

Added
- examples/teams/parallel-1-agent.yaml
- examples/teams/parallel-2-agent-smoke.yaml (no tools; validates handoff events)
- examples/teams/sequential-2-agent-handoff.yaml (no tools; validates listenFrom)

How to run (exact commands)

1) 1-agent (uses ritual; requires API keys for real model/tooling):

```bash
cd /Users/river/.openclaw/workspace/projects/summon
bun run src/cli/index.ts orchestrate examples/teams/parallel-1-agent.yaml "Analyze AAPL revenue growth" --verbose
```

2) Smoke (no tools; should terminate deterministically even without API keys):

```bash
cd /Users/river/.openclaw/workspace/projects/summon
bun run src/cli/index.ts orchestrate examples/teams/parallel-2-agent-smoke.yaml "hello" --json
bun run src/cli/index.ts orchestrate examples/teams/sequential-2-agent-handoff.yaml "hello" --json
bun run src/cli/index.ts orchestrate examples/teams/hierarchical-2-agent-smoke.yaml "hello" --json
```

Next steps (approval needed)
1) Dynamic hierarchical planning: coordinator outputs JSON plan; orchestrator follows it (DONE with plan override for tests).
2) Persist orchestration runs via StorageAdapter (DONE).
3) Reduce tool-registration log noise in CLI (respect --quiet/--json).
4) Improve coordinator prompting: inject a “STRICT JSON plan” instruction into coordinator system prompt when hierarchical.

Requests (waiting)
- Need approval to read example agent rituals under `examples/agents/` (at least `financial-analyst.yaml`) to reference correctly and to choose/create a minimal no-tools ritual for deterministic smoke config.
- Need approval to read LLM runtime/model config files (likely under `src/runtime/`) to confirm if a no-API/mock model exists for deterministic smoke runs.

Milestone 3 - Orchestration Hardening (DONE)

Changed
- Enforced overall run timeout, optional per-agent timeout, and cancellation via AbortController.
- Added guardrails: `maxEvents` + `maxOutputChars` to stop runaway logs safely.
- Added pause points: `orchestration.pauseAfter` supports `coordinator`, `handoff`, `final` (emits `orchestration_pause` + `orchestration_done`).
- Centralized orchestration guard logic with truncation for oversized final output.

Tests added/updated
- `maxEvents` guardrail stops run.
- Per-agent timeout stops slow agent.
- External cancellation stops orchestration.

Config additions (team YAML)
- `orchestration.perAgentTimeoutMs`
- `orchestration.maxEvents`
- `orchestration.maxOutputChars`
- `orchestration.pauseAfter`
- `agents[].timeoutMs`

Commands run
- `bun run typecheck`
- `bun test`

Milestone 2 - Hierarchical Planning + Orchestration Persistence + CLI UX (DONE)

Changed
- Enforced strict JSON coordinator plans with validation; hierarchical runs now execute the planned subset through the DAG runner with coordinator context injected.
- Added plan validation errors when dependencies are missing or IDs are invalid.
- Orchestrate CLI now supports `--quiet`, respects `--quiet/--json` for logging, and suppresses tool registration noise unless `--verbose` is set.

Files touched
- src/orchestration/orchestrator.ts
- src/orchestration/orchestrator.test.ts
- src/cli/index.ts
- STATUS.md

Commands run
- `bun run typecheck`
- `bun test`

Next steps
1) Add a small example team YAML that demonstrates strict JSON coordinator planning.
2) Consider emitting plan diagnostics (parsed plan) in verbose mode for easier debugging.
3) Add a CLI flag to disable persistence for orchestration runs.
