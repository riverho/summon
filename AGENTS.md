# AGENTS.md - Braddy Workspace Guide

Purpose: build and maintain the Braddy composable agent framework and its portable YAML agents.

## Project Snapshot

- Framework: composable agents with portable YAML definitions (persona + skills + config).
- Composition: personas + skills merged into a system prompt; skills declare required tools.
- Runtime: event-driven loop yields `thinking`, `tool_start`, `tool_end`, `done`.
- Component discovery (priority): `src/builtin/` -> `~/.braddy/components/` -> `.braddy/components/`.

## Key Paths

- Core exports: `src/index.ts`
- Components: `src/components/` (types, registry, composer, composed-agent)
- Built-ins: `src/builtin/personas/`, `src/builtin/skills/`
- Runtime: `src/runtime/` (llm, memory, scratchpad, tools, config/env)
- CLI: `src/cli/index.ts`
- Examples: `examples/agents/`

## YAML Agent Format (portable)

Required sections:
- `persona`: role, goal, backstory, behavior (style, priorities, avoidances)
- `skills`: list of skill entries with `requiredTools` and `promptFragment`
- `model`: provider, model, maxIterations

See: `examples/agents/financial-analyst.yaml` for a complete agent file.

## Tool Binding Rules

- Skills declare `requiredTools`.
- Only declared tools get bound to the composed agent.
- Tool registration happens via the global tool registry in user code.

## CLI Usage

- Run with YAML config:
  - `braddy run "Analyze AAPL" --config ./examples/agents/financial-analyst.yaml`
- Quick compose from components:
  - `braddy compose "Analyze AAPL" --persona analyst --skills finance`
- List components:
  - `braddy components list`

## Coding Conventions

- Keep YAML agent files self-contained and portable.
- Add new personas/skills to `src/builtin/` and document in README if user-facing.
- Favor explicit schemas in `src/components/types.ts` when extending formats.
- Preserve event types emitted by runtime; add new ones only with clear use cases.

## Verification Notes

- Type checking passes; CLI help runs; built-ins are discoverable.
- If you change discovery rules or YAML schema, update README and example YAMLs.

