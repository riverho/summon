# Changelog

All notable changes to the Summon project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [0.5.0] - 2026-02-20

### Added

#### Registry Integration
- Cloudflare Worker registry API deployed at `https://summon-registry-api.shape02174.workers.dev`
- `summon run @author/name` syntax to fetch and run rituals from registry
- Local ritual cache at `~/.summon/cache/rituals/`
- Registry client with automatic cache management
- Ritual loader for resolving `@author/name` references

#### Gap Chat Steering Mode
- Three execution modes: `--autonomous` (default), `--interactive`, `--review`
- Checkpoint system with three phases:
  - `after_data_collection` — after data gathering
  - `before_analysis` — before analysis phase
  - `before_conclusion` — before final output
- Steering commands: `SET_FRAMEWORK`, `ADJUST_STYLE`, `CONTINUE`, `RETRY`
- Preference persistence to `~/.summon/preferences/{ritualId}.yaml`

#### Runtime Engine
- Streaming execution for real-time output
- Tool resolution with scoped binding
- Secret injection from `~/.summon/.env` into tools
- Trace collection to `~/.summon/traces/` (JSONL format)

#### New CLI Commands
- `summon run @author/name --interactive` — run registry ritual with steering
- `summon review @author/name` — review ritual metadata before execution
- `summon check @author/name` — run graduation checks on a ritual

### Changed

#### Directory Structure
- Added `~/.summon/traces/` — execution traces (JSONL)
- Added `~/.summon/preferences/` — steering preferences per ritual
- Added `~/.summon/cache/rituals/` — cached registry rituals
- `~/.summon/.env` — secrets file with 600 permissions

### Technical

- New source modules:
  - `src/registry/` — Registry client, cache, ritual loader
  - `src/gap-chat/` — Gap Chat steering mode implementation
  - `src/runtime/` — Runtime engine with streaming execution

## [0.4.0] - 2026-02-18

### Added
- Multi-provider LLM support (OpenRouter, OpenAI, Anthropic, Google, xAI, Ollama)
- Interactive setup wizard with `summon setup`
- Reconfigure flow — change models without re-entering API keys
- `summon config --location` command
- `summon doctor` health check command
- Classified error handling with recovery suggestions

### Changed
- Unified directory structure — consolidated `.summon_mem/` into `.summon/`
- Single source of truth for paths at `src/config/paths.ts`
- External tools moved to `~/.summon/components/tools/`
- Tool naming: `alphavantage_api` → `financial_search`, `tavily_search` → `web_search`
- Clean output format (`[Answer]` prefix)

### Fixed
- Tesla ticker extraction (name → TSLA mapping)
- Real AlphaVantage API integration (no random data)
- Default model selection (GLM-5)
- Double setup loop issue
- Output format duplication

## [0.3.0] - 2026-02-13

### Added
- Durable RitualEngineV2 with checkpointing
- AgentPool for multi-agent management
- ContextManager for state persistence
- AgentOrchestrator for DAG-based execution
- AgentTrainer with decision point system
- Guardrails system (schema, regex, function, LLM judge)
- MetricsCollector and Dashboard
- A/B Testing framework
- Conditions for ritual edge evaluation
- AgentFactory with tier configs
- Billing and credit system

## [0.2.0] - 2026-02-10

### Added
- Component system (Persona + Skill + Composer)
- Multi-agent orchestration patterns
- Team configurations
- Parallel and sequential execution modes
- Built-in personas and skills

## [0.1.0] - 2026-02-05

### Added
- Initial CLI with `run`, `compose` commands
- YAML ritual structure
- Basic LLM routing
- Session management
- First-run setup foundation
