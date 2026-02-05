# Summon AI Codebase Summary (as of 2026-02-04)

This summary reflects a scan of the local Summon AI framework in `/Users/river/.openclaw/workspace/projects/summon`.

## 1) Core Files and Their Purposes

**Entry points and docs**
- `src/index.ts`: Public API exports for components, composer, runtime, and tool registry.
- `src/cli/index.ts`: CLI entrypoint (`summon`) with commands for run/compose/components/models/sessions/MCP.
- `README.md`: High-level usage, YAML ritual format, CLI examples, and directory structure.
- `AGENTS.md`, `CODEX.md`, `CLAUDE.md`: Vision and guidance for tooling/agent contexts.
- `WIP.md`: Historical note of initial scaffold and capabilities.

**Components system (core architecture)**
- `src/components/types.ts`: Zod schemas and types for personas, skills, model config, workflow, guardrails, and runtime events.
- `src/components/registry.ts`: Component discovery/loading, YAML parsing/validation, and path resolution.
- `src/components/composer.ts`: Resolves `$ref` components, binds tools, builds system prompt, and produces `ComposedAgentSpec`.
- `src/components/composed-agent.ts`: Runtime agent loop (tool calls, retries, summarization, final answer generation).

**Runtime**
- `src/runtime/llm.ts`: Multi-provider LLM abstraction (OpenAI/Anthropic/Google/xAI/Ollama) with retry/backoff, tools binding, and “fast model” mapping.
- `src/runtime/tools.ts`: Global tool registry and built-in stub tools (financial/web/file + failing tool).
- `src/runtime/memory.ts`: In-memory chat history with LLM summarization and relevant message selection.
- `src/runtime/chat-history.ts`: On-disk session history (JSON) and session IDs.
- `src/runtime/session.ts`: Per-query JSONL session logs, tool result storage, and summaries.
- `src/runtime/mcp-client.ts`: MCP server manager (simplified client stub; spawns servers, lists tools).
- `src/runtime/config.ts`, `src/runtime/env.ts`: Settings persistence and API key management.

**Built-in components & tools**
- `src/builtin/personas/*.yaml`: Built-in personas (note one disabled file).
- `src/builtin/skills/*.yaml`: Built-in skill definitions (finance, web-search, file, git).
- `src/builtin/skills/*/index.ts`: Tool implementations and registry registration.
- `src/builtin/mcp/mcp-servers.yaml`: MCP server config template (Context7, filesystem, GitHub, Postgres, Puppeteer).

**Examples**
- `examples/agents/financial-analyst.yaml`: Example ritual including workflow and guardrails.

## 2) Recent Changes (Git Log)

Last 5 commits:
- **2026-02-02**: Added `CODEX.md` vision doc for Codex context.
- **2026-02-02**: Updated `AGENTS.md`, added `CLAUDE.md`, clarified Summon as a CLI framework (not a financial analyst agent).
- **2026-02-01**: Added workflow/guardrails config support; updated types, composer, composed-agent; updated financial analyst example; default model changed to `gpt-4o`.
- **2026-02-01**: Code review fixes: model naming, tool_calls null handling, Node compatibility (child_process), tsconfig updates; added `IMPLEMENTATION_PLAN.md` and `To_Codex.md`.
- **2026-01-31**: Added `.env` to `.gitignore`.

## 3) Current Capabilities

**CLI**
- `summon run`: Run from YAML ritual, supports sessions (`--session`, `--session-auto`, `--continue`, `--new-session`), JSON output, verbose tool logs.
- `summon compose`: Quick compose via component IDs.
- `summon components list`, `summon skills`, `summon personas`: Registry listing.
- `summon models`: Lists configured models by available API keys.
- `summon sessions`: List/show/clear/delete session history.
- `summon mcp`: Manage MCP servers (list/status/start/stop/restart/tools/add/remove/enable/disable).

**Composition**
- Portable YAML rituals with personas + skills + model + workflow + guardrails.
- `$ref` resolution from component registry.
- System prompt assembly with persona behavior + skill prompt fragments + tool descriptions.
- Skill-based tool binding; warns on missing tools.

**Runtime execution**
- Event-driven agent loop (`thinking`, `tool_start`, `tool_end`, `tool_error`, `answer_start`, `done`).
- Tool call retry logic and per-tool summary generation for context compaction.
- Session logging to `~/.summon_mem/sessions/runs` as JSONL.
- In-memory history summarization and relevance selection via LLM.

**Tooling**
- Built-in tool modules for:
  - Finance (Alpha Vantage integration; stub data when no key).
  - Web search (Tavily or Exa; stub when no key).
  - File operations (read/write/list/create directory).
  - Git operations (status/log/diff/branch/search).
- MCP server configuration and lifecycle management (Context7 enabled by default).

## 4) TODOs / Incomplete / Gaps

**Explicit TODOs**
- `src/orchestration/orchestrator.ts`: `initialize()` and `run()` are placeholders.

**Stubs / Partial implementations**
- `src/runtime/mcp-client.ts`: MCP client is a simplified stub (no real JSON-RPC handshake; tool discovery is mocked).
- `src/runtime/tools.ts`: Stub `financial_search`, `web_search`, `file_read`, `file_write`, and a `failing_tool` exist for testing and may overlap with real tools.

**Configuration / naming mismatches**
- `README.md` still references `braddy://` path prefix, but code uses `summon://` in `resolvePath()` and CLI messages.
- Example YAML comments in `examples/agents/financial-analyst.yaml` still mention `braddy` CLI usage.
- Built-in finance skill YAML requires `financial_search`, but the real finance module registers tools like `get_price_snapshot` and `get_financial_metrics_snapshot`. The runtime stub provides `financial_search`, so this works only via stub unless the YAML is updated.
- `README.md` shows a default model `gpt-5.2`, while code defaults to `gpt-4o`.

**Operational caveats**
- Web search and finance tools fall back to stub data without API keys.
- Some personas are disabled (`analyst.yaml.DISABLED`).

---

If you want, I can also draft a “next steps” checklist (e.g., align README/example paths, update skill/tool IDs, and flesh out the orchestrator).
