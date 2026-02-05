# Review — Multi-Agent Orchestration + Storage (Summon)

Date: 2026-02-06

## Snapshot

Milestone 1 work landed locally (uncommitted at time of review) in `src/orchestration/orchestrator.ts` plus a new `STATUS.md`.

The orchestrator has moved from a simple parallel/sequential runner to a **DAG-aware runner** that:
- validates wiring (`listenFrom` + `outputTo`) and rejects cycles
- runs **graph-sequential** and **graph-parallel** schedules
- emits a usable **OrchestrationEvent** stream
- formats upstream outputs into downstream agent input (`Upstream context:` blocks)

This is directionally correct and aligns with `MULTI_AGENT_IMPLEMENTATION_PLAN.md`.

## What’s good

1) **Cycle detection + dependency graph**
- `assertDAG()` and `buildDependencyGraph()` cover the core correctness requirement.

2) **Graph scheduling**
- Sequential: picks next ready node in the declared order.
- Parallel: starts all ready nodes and launches dependents as they become ready.

3) **Event stream is now meaningful**
- Emits: `agent_start`, `agent_thinking`, `agent_tool_call`, `agent_done`, `handoff`, and final `orchestration_done`.

4) **Input compaction via upstream-context formatting**
- Handoff happens via text artifact (agent output) without long chat relays.

## Gaps / Risks

1) **Tool end / tool error events aren’t exposed**
- Currently emits only `tool_start` as `agent_tool_call`. We probably want to also emit `tool_end` and `tool_error` at orchestration layer for observability.

2) **No persistence integration yet**
- `ChatHistoryManager` writes JSON sessions to `~/.summon_mem/sessions/*.json`.
- `LocalStorageAdapter` writes JSONL session events to `~/.summon_mem/sessions/*.jsonl`.
- These are parallel systems; they should converge (either wrap ChatHistoryManager on storage adapter, or retire it).

3) **No team YAML examples committed**
- The CLI has `summon orchestrate`, but without `examples/teams/*.yaml` it’s harder to validate quickly.

4) **Potential deadlock edge case**
- If no node is initially ready (all have deps) the parallel runner will start none and never close the queue. Cycle detection should prevent true deadlock, but a misconfigured graph could still lead to “no ready node” situations if deps reference missing outputs.

5) **No tests**
- At least add a deterministic smoke test that runs orchestration without any external keys.

## Smallest safe next increment (recommended)

1) Commit Milestone 1 changes with `bun run typecheck` green.
2) Add `examples/teams/` with 2–3 minimal configs:
   - `parallel-1-agent.yaml`
   - `parallel-2-agent-handoff.yaml`
   - `sequential-2-agent.yaml`
3) Add a smoke command script (or bun test) that runs orchestrate with a “no-tools” agent and asserts `orchestration_done` exists.
4) Decide storage unification plan:
   - Option A: re-implement ChatHistoryManager on top of `StorageAdapter`.
   - Option B: treat ChatHistoryManager as “UI session history” and StorageAdapter as “system events” (but then document it clearly).

## Addendum (Milestone 2)

- `examples/teams/*.yaml` now exists (parallel + sequential + no-tools smoke).
- Recommended smoke runs are documented in `STATUS.md`.

## Test checklist

Run locally:
- `bun run typecheck`

Smoke orchestrate:
- `bun run src/cli/index.ts orchestrate examples/teams/parallel-1-agent.yaml "hello" --json` and confirm:
  - it terminates
  - it prints `orchestration_done`

Handoff behavior:
- `parallel-2-agent-handoff.yaml` where agent B depends on agent A:
  - confirm `handoff` events emitted
  - confirm B input contains `Upstream context:` block

Cycle detection:
- create a 2-node mutual dependency graph and confirm it throws a cycle error.
