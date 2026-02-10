# CONTEXT_BRIEF — Summon multi-agent orchestration + storage (checkpoint)

Date: 2026-02-06

## Goal
Complete Summon’s multi-agent orchestration layer and unify local persistence for sessions/orchestration runs.

## What’s done (recent milestones)

### Orchestration
- Implemented DAG validation (cycle detection) for `listenFrom` + `outputTo`.
- Implemented DAG-aware execution:
  - `runGraphParallel` and `runGraphSequential`
  - emits `handoff` events when upstream outputs satisfy downstream deps
- Added upstream context formatting injected into downstream agent input:
  - Adds `Upstream context:` blocks with `[dep]` outputs.
- Orchestration event stream supported:
  - `agent_start`, `agent_thinking`, `agent_tool_call`
  - `agent_tool_end` (durationMs)
  - `agent_tool_error` (error)
  - `agent_done`, `handoff`, `orchestration_done`

### CLI
- Added `summon orchestrate <teamYaml> <query> [--verbose|--json]`.
- Added `examples/teams/`:
  - `parallel-1-agent.yaml` (ritual-based)
  - `parallel-2-agent-smoke.yaml` (no-tools, validates handoff + termination)
  - `sequential-2-agent-handoff.yaml` (no-tools, validates listenFrom)

### Storage
- Implemented `LocalStorageAdapter` writing session events to:
  - `~/.summon_mem/sessions/<sessionId>.jsonl`
  - `~/.summon_mem/sessions/<sessionId>.meta.json`
- Reimplemented `ChatHistoryManager` on top of `StorageAdapter` so there is a single persistence path.
- Added helpers in `src/storage/local.ts`: list/clear/delete sessions.

### Tests
- Added Bun tests for orchestrator:
  - no-tools parallel DAG smoke emits `handoff` + `orchestration_done`
  - cycle detection throws

## Key files
- `src/orchestration/orchestrator.ts`
- `src/orchestration/types.ts`
- `src/cli/index.ts`
- `src/storage/local.ts`
- `src/runtime/chat-history.ts`
- `src/orchestration/orchestrator.test.ts`
- `STATUS.md` / `REVIEW.md`

## Commands (sanity)
- `bun run typecheck`
- `bun test`
- Orchestrate smoke:
  - `bun run src/cli/index.ts orchestrate examples/teams/parallel-2-agent-smoke.yaml "hello" --json`
  - `bun run src/cli/index.ts orchestrate examples/teams/sequential-2-agent-handoff.yaml "hello" --json`

## What’s next (pick order)
1) Implement **hierarchical/coordinator** orchestration pattern.
2) Persist orchestration runs via storage (write `OrchestrationEvent` stream to `StorageAdapter` as session events; optionally add `summon orchestrate --session <id>`).
3) Reduce log spam: make tool registration prints conditional (quiet/json mode).

## Notes / constraints
- There is no “mock LLM” provider; deterministic smoke runs avoid LLM calls by using `skills: []` so the agent returns a predictable `No tools available` message.
