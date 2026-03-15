# Next Priority Plan (Step 0 / No Bloat)

## Recommended Order

1. Runtime (registry -> execute)
2. Secrets (`~/.summon/.env` + `summon secrets`)
3. Trace (JSONL collector + `summon stats`)
4. Graduation (`summon check` + gate in `summon publish`)

## Why This Order

### 1) Runtime first
- Fastest path to core user value: user can actually run rituals from registry.
- Turns deployed registry from "storage" into usable product.
- Can ship as a thin slice: fetch ritual, resolve tools, execute.

Estimated effort: 1.5-2.5 days

Unblocks:
- End-to-end loop: discover -> run
- Real usage data generation (needed before graduation has meaning)
- Integration points for secrets + trace hooks

### 2) Secrets second
- Runtime without secrets blocks many real tools (finance/search/provider keys).
- MVP secret model is small and proven (`.env` + `chmod 600`).
- Keeps Step 0 scope tight: no vault, no cloud sync, no policy engine.

Estimated effort: 0.5-1 day

Unblocks:
- Practical execution of API-backed rituals
- Cleaner runtime errors (`Missing KEY -> summon secrets add KEY`)

### 3) Trace third
- Useful only once runtime is used; before that it captures little value.
- Needed to compute objective checks for graduation (runs, success rate).
- Keep minimal: one trace/file JSONL, span timing, token/cost counters, auto cleanup.

Estimated effort: 1-1.5 days

Unblocks:
- `summon stats` for real reliability numbers
- Data foundation for publish gate

### 4) Graduation fourth
- Depends on trace stats + ritual/tool validation.
- Delivers quality gate at publish time, but only meaningful after enough executions exist.
- Small, deterministic checks fit Step 0 (no AI reviewer, no subjective scoring).

Estimated effort: 0.5-1 day

Unblocks:
- Trustable publish flow
- Simple draft -> published state change with hard checks

## Dependency Graph (Minimal)

- Runtime: depends on existing registry API
- Secrets: independent module, consumed by runtime/tools
- Trace: depends on runtime execution hooks
- Graduation: depends on trace stats + ritual/tool validation
- Publish gate: depends on graduation result

## Step 0 Guardrails (to prevent bloat)

- Do not add encrypted vault, cloud secret sync, or RBAC now.
- Do not add advanced tracing backends (OTel, DB, dashboards) now.
- Do not add manual/AI review tiers now.
- Ship each step with one CLI entrypoint and one acceptance test path.

## Suggested Acceptance Milestones

1. Runtime: `summon run @author/name` works against registry ritual.
2. Secrets: `summon secrets add/list/remove` + runtime key resolution works.
3. Trace: each run writes `~/.summon/traces/{traceId}.jsonl`; `summon stats` returns aggregates.
4. Graduation: `summon check` enforces 5 checks; `summon publish` blocks on failure.
