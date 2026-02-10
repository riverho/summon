# Implementation Plan: Multi-Agent CLI Orchestration Commands

## Goal
Add lightweight orchestration-focused CLI ergonomics without requiring users to handcraft a team YAML for common workflows.

## Scope
- Add `summon parallel` command.
- Add `summon teams` subcommand group with `list` and `run`.
- Reuse existing orchestrator execution/persistence behavior from CLI.

## Technical Approach

1. **Extract shared orchestration execution path in CLI**
   - Introduce a helper that accepts parsed multi-agent config + query + standard orchestration CLI flags.
   - Keep event persistence (`user`, orchestration `system` events, final `assistant`) identical to existing `orchestrate` behavior.
   - Reuse this helper for `orchestrate`, `parallel`, and `teams run` to avoid divergence.

2. **Implement `summon parallel`**
   - Command signature:
     - `summon parallel "query" --agents a.yaml,b.yaml [--model gpt-4o]`
   - Parse comma-separated ritual paths from `--agents`.
   - Build an in-memory multi-agent config:
     - `orchestration.pattern = parallel`
     - one agent node per ritual path
     - optional node-level model override from `--model`
   - Generate stable, deduplicated agent IDs from ritual filenames.
   - Execute through the shared orchestration helper.

3. **Implement `summon teams` command group**
   - `summon teams list`
     - Resolve `summon://examples/teams`
     - List `*.yaml` / `*.yml` files as available team names.
   - `summon teams run <team-name> "query"`
     - Resolve `<team-name>` to `examples/teams/<team-name>.yaml|.yml`.
     - Parse YAML and execute through shared orchestration helper.

## Compatibility and UX Notes
- Preserve existing `orchestrate` output/options semantics (`--verbose`, `--json`, `--quiet`, session flags).
- Use same persistence flow so `summon sessions show` continues to work for new commands.
- Keep command wiring in `src/cli/index.ts` to match current command patterns.

## Validation
- Run `bun run typecheck` after implementation.
- Smoke-check help/command wiring manually if needed:
  - `bun run src/cli/index.ts parallel --help`
  - `bun run src/cli/index.ts teams list`
