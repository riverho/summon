# AGENTS.md - Summon AI Framework Guide

**Vision:** 🦞 Summon your agents in just one-line with Clawdbot. Assemble multi-agent bots for your workflow. Built for OpenClaw community.

**What is Summon AI?**
A CLI tool for composing multi-agent bots that last by design. It's a framework for building composable, portable AI agents from the command line.

**Core Identity:**
- **CLI tool for AI agents** — One-line composition: `summon compose "..."`
- **Composable agents** — Build from personas + skills
- **Multi-agent orchestration** — Coordinate multiple agents
- **Memory that lasts** — Agents remember context across sessions
- **Built for the bot community** — Not corporations

## Project Structure

- **Framework:** Composible agents with portable YAML definitions
- **Composition:** Personas + skills merged into system prompts
- **Runtime:** Event-driven loop emitting `thinking`, `tool_start`, `tool_end`, `done`
- **Discovery:** `src/builtin/` → `~/.braddy/components/` → `.braddy/components/`

## Key Paths

- Core exports: `src/index.ts`
- Components: `src/components/` (types, registry, composer, composed-agent)
- Built-ins: `src/builtin/personas/`, `src/builtin/skills/`
- Runtime: `src/runtime/` (llm, memory, scratchpad, tools, config/env)
- CLI: `src/cli/index.ts`
- Examples: `examples/agents/`

## CLI Commands

- **Quick compose:** `summon compose "Analyze this" -p analyst -s finance`
- **Run with YAML:** `summon run --ritual ./my-agent.yaml`
- **List components:** `summon components list`

## NOT a Financial Analyst Agent

Summon AI is a **framework**, not a specific agent. The financial-analyst.yaml example is just ONE use case. Do not treat Summon as being "a financial analyst agent" — it can build ANY type of agent.
