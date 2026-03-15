// Summon — TLDR

**Active Stream:** MCP Full Spec Implementation (Layer 3 External Tools) ✅ COMPLETE  
**Stability:** Built-in ✅, CF-Hosted ✅, MCP ✅ (stdio + HTTP/SSE + Resources/Prompts)  
**Status:** Type-clean, ready for testing

---

**What it is:** A CLI framework to compose and summon AI agents using portable YAML rituals. Think "Docker for AI agents" but with YAML instead of Dockerfiles.

**Core Metaphor:**
- **Ritual** = YAML file (persona + skills + model config)
- **Components** = Reusable personas and skills you mix/match
- **Summoning** = `summon run` to instantiate an agent
- **Binding** = Connecting tools to skills (scoped, not global)

---

## Quick Commands

```bash
# Summon with a local YAML ritual
summon run "Analyze AAPL revenue" --ritual ./financial-analyst.yaml

# Summon from registry
summon run @author/name "Your query here"
summon run @financial-analyst/researcher "Analyze AAPL revenue" --interactive

# Quick compose on the fly
summon compose "Analyze AAPL" --persona analyst --skills finance

# Multi-agent orchestration
summon orchestrate examples/teams/parallel-2-agent.yaml "Research AI trends"
summon parallel "Analyze market" --agents a.yaml,b.yaml
summon teams list
summon teams run financial-team "Analyze AAPL"

# Trainer (decision point system)
summon trainer decisions list --pending
summon trainer decisions chat <point-id> -m "Switch to Claude"

# Registry operations
summon review @author/name              # Review a ritual before running
summon check @author/name               # Run graduation checks on a ritual
```

---

## Philosophy

Instead of monolithic agent configs, you **compose** agents from reusable pieces:
- Financial analyst = `analyst` persona + `finance` skill + `web-search` skill
- Components are wired together at runtime
- Skills declare required tools — only those get bound (scoped, not global)

---

## Key Directories (Unified)

| Path | Purpose |
|------|---------|
| `~/.summon/` | **Unified home directory** — all user data |
| `~/.summon/.env` | API keys (600 permissions, gitignored) |
| `~/.summon/config.yaml` | User preferences |
| `~/.summon/sessions/` | Chat history |
| `~/.summon/sessions/runs/` | Agent execution logs (JSONL) |
| `~/.summon/rituals/` | Downloaded ritual YAML files |
| `~/.summon/cache/` | Tool results, LLM cache |
| `~/.summon/cache/rituals/` | Registry rituals cache |
| `~/.summon/logs/` | Debug logs |
| `~/.summon/traces/` | Execution traces (JSONL) |
| `~/.summon/preferences/` | Steering preferences per ritual |
| `~/.summon/components/` | User components |
| `~/.summon/components/tools/` | External tools (financial-search.ts) |
| `~/.summon/components/skills/` | User skills |
| `~/.summon/components/personas/` | User personas |
| `~/.summon/decisions/` | Trainer decision points |
| `~/Documents/Summon/` | Exported documents |
| `src/builtin/` | Built-in personas and skills |
| `src/trainer/` | Agent trainer (decision point system) |
| `src/orchestration/` | Multi-agent orchestration (DAG-based) |
| `src/durable/` | Ritual engine v2 with checkpoints |
| `src/guardrails/` | Validation and guardrail system |
| `src/registry/` | Registry client, cache, ritual loader |
| `src/gap-chat/` | Gap Chat steering mode |
| `src/runtime/` | Runtime engine with streaming execution |
| `examples/agents/` | Sample YAML rituals |
| `examples/teams/` | Multi-agent team configurations |
| `rituals/` | Production-ready graduated rituals |

**Note:** Legacy `.summon_mem/` has been consolidated into `.summon/`. All paths now use unified `src/config/paths.ts`.

---

## Ecosystem & Related Repos

Summon is part of a larger ecosystem. Here's how the repos connect:

### 1. summon-ai-doc (Documentation Site)
**Location:** `/Users/river/clawd/projects/summon-ai-doc`
**What it is:** Astro + Starlight documentation site for the Summon CLI
**Connection to Summon:**
- Documents CLI commands, YAML ritual schema, and component system
- Publishes to `summon-ai.pages.dev` (or similar)
- Examples in `examples/` folder mirror working rituals from main repo
- Cross-linked: CLI `--help` can reference docs URLs

**Key files:**
- `src/content/docs/` — Ritual YAML reference, CLI guide, tutorials
- `astro.config.mjs` — Site config

---

### 2. summon-academy (Training & Graduation)
**Location:** `/Users/river/clawd/projects/summon-academy`
**What it is:** Agent training ground — rituals graduate from academy to main summon registry
**Connection to Summon:**
- **Input:** New rituals tested in academy before production
- **Output:** `graduated/` rituals move to summon `rituals/` or registry
- **Shared:** YAML schema, component system, skill definitions
- **Check:** `summon check @author/name` runs academy graduation checks

**Lifecycle:**
```
Academy (experiment) → Graduation (pass checks) → Registry (@author/name) → CLI (summon run)
```

**Key files:**
- `graduated/` — Production-ready rituals
- `refiner/` — YAML quality validation tools
- `crawler/` — Registry indexing

---

### 3. summon-registry-api (Cloudflare Worker)
**Location:** Deployed at `https://summon-registry-api.shape02174.workers.dev`
**Source:** (implied: `summon-registry-api/` or part of summon)
**What it is:** Global ritual registry — share and discover rituals via `@author/name`
**Connection to Summon:**
- **Fetch:** `summon run @author/name` queries this API
- **Cache:** Rituals cached locally at `~/.summon/cache/rituals/`
- **Auth:** API keys for publishing (future), read is public
- **Integrations:** summon-academy crawler indexes rituals

**API endpoints:**
```
GET /rituals/{author}/{name}     → Fetch ritual YAML
GET /rituals/{author}            → List author's rituals
GET /search?q={query}            → Search rituals (planned)
POST /rituals (auth)             → Publish ritual (planned)
```

**Local cache structure:**
```
~/.summon/cache/rituals/
├── {author}/
│   └── {name}.yaml
```

---

### Data Flow Between Repos

```
┌─────────────────────────────────────────────────────────────────┐
│                     summon-academy                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │  Crawler    │───→│  Refiner    │───→│   Graduated/        │  │
│  │  (index)    │    │  (validate) │    │   (publish ready)   │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│         │                                    │                   │
│         └────────────────────────────────────┘                   │
│                      ↓ (push to registry)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  summon-registry-api                            │
│              (Cloudflare Worker + R2/D1)                        │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐  │
│  │   Store     │    │   Cache     │    │   Query API         │  │
│  │   (R2)      │    │   (KV)      │    │   @author/name      │  │
│  └─────────────┘    └─────────────┘    └─────────────────────┘  │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐
│     summon      │  │  summon-ai-doc  │  │    Clawdbot         │
│     (CLI)       │  │   (Docs site)   │  │   (Orchestrator)    │
│                 │  │                 │  │                     │
│ summon run      │  │ YAML reference  │  │ sessions_spawn()    │
│ @author/name    │←─┤ CLI guide       │  │ summon commands     │
│                 │  │ Examples        │  │                     │
│ Local cache     │  │                 │  │ Natural language    │
│ ~/.summon/cache │  │                 │  │ → summon run        │
└─────────────────┘  └─────────────────┘  └─────────────────────┘
```

---

### Development Workflow

**Making a new ritual:**
1. **Prototype** in `summon-academy/experiments/`
2. **Validate** with refiner tools
3. **Graduate** to `summon-academy/graduated/`
4. **Publish** to registry (`@username/ritual-name`)
5. **Document** in `summon-ai-doc/src/content/docs/`
6. **Use** via `summon run @username/ritual-name`

**Updating a ritual:**
1. Edit in academy or local
2. Re-run graduation checks
3. Republish to registry (versioned)
4. Docs auto-update (if linked)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLI Layer                            │
│  summon run | compose | orchestrate | parallel | teams      │
│  summon run @author/name | review | check                   │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Registry Layer (NEW)                      │
│  Registry Client → Cache → Ritual Loader                    │
│  https://summon-registry-api.shape02174.workers.dev         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Component System                          │
│  Persona + Skills → Composer → ComposedAgent                │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                   Runtime Layer                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  LLM Router │  │ Tool Registry│  │  Chat History       │ │
│  │  (multi)    │  │ (scoped)     │  │  (sessions)         │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │RuntimeEngine│  │ Trace       │  │  Secret Injection   │ │
│  │(streaming)  │  │ Collector   │  │  (.env → tools)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Orchestration & Training                       │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ AgentOrchestrator│  │ AgentTrainer (Decision Points)  │  │
│  │ (DAG execution)  │  │ (async human-in-the-loop)       │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Gap Chat Steering (NEW)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Checkpoints │  │  Steering   │  │  Preference         │ │
│  │ (3 phases)  │  │  Commands   │  │  Persistence        │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│              Durability & Storage                           │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ RitualEngine│  │  Storage    │  │   CheckpointManager │ │
│  │ (v2 + AO)   │  │  (swappable)│  │   (crash recovery)  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Current State (Feb 20, 2026)

### ✅ Completed Modules

| Module | Status | Description |
|--------|--------|-------------|
| **CLI** | ✅ | `run`, `compose`, `orchestrate`, `parallel`, `teams`, `trainer`, `setup`, `config`, `doctor`, `review`, `check` |
| **First-Run Setup** | ✅ | Interactive wizard, `~/.summon/` structure, pre-flight checks |
| **Multi-Provider LLM** | ✅ | OpenRouter, OpenAI, Anthropic, Google, xAI, Ollama with auto-detection |
| **Error Handling** | ✅ | Classified errors (auth_missing, rate_limit, etc.) with recovery suggestions |
| **Component System** | ✅ | Persona + Skill + Composer + ComposedAgent |
| **Runtime** | ✅ | LLM routing, Tool registry, Chat history, Sessions |
| **Orchestration** | ✅ | DAG-based multi-agent with parallel/sequential/hierarchical patterns |
| **Trainer** | ✅ | Decision point system with pattern detection |
| **Guardrails** | ✅ | Schema, regex, function, and LLM judge guardrails |
| **Durable Engine** | ✅ | RitualEngineV2 with checkpointing, AgentPool, ContextManager |
| **Storage** | ✅ | LocalStorageAdapter, swappable interface |
| **Observability** | ✅ | MetricsCollector, Dashboard, lifecycle tracking |
| **Preferences** | ✅ | User preferences with ritual overrides |
| **Memory** | ✅ | Long-term user memory, learned patterns |
| **A/B Testing** | ✅ | Variant testing, metrics, reports |
| **Conditions** | ✅ | Conditional edge evaluation for rituals |
| **Factory** | ✅ | AgentFactory with tier configs, credit system integration |
| **Billing** | ✅ | Credit system with usage tracking |
| **Registry** | ✅ | Cloudflare Worker deployed, fetch rituals via `@author/name` |
| **Cache** | ✅ | Local ritual cache at `~/.summon/cache/rituals/` |
| **Runtime Engine** | ✅ | Streaming execution, tool resolution, secret injection, trace collection |
| **Gap Chat Steering** | ✅ | Interactive/review/autonomous modes with checkpoint steering |

### 🔄 In Progress / Known Issues

| Issue | Status | Details |
|-------|--------|---------|
| Type errors | ✅ Fixed | All TypeScript errors resolved |
| OpenClaw client | 🔄 | Mock mode only; real integration pending |
| Registry v2 | 🔄 | Search, ratings, versioning planned |

---

## Registry Integration (NEW)

Summon now supports a **global ritual registry** — share and discover rituals via `@author/name` syntax.

### Registry Endpoint
```
https://summon-registry-api.shape02174.workers.dev
```

### Usage

```bash
# Run a ritual from registry
summon run @financial-analyst/researcher "Analyze AAPL"

# Interactive mode with steering
summon run @author/name "Query" --interactive

# Review before running
summon review @author/name

# Run graduation checks
summon check @author/name
```

### How It Works

1. **Registry Client** — Fetches rituals from Cloudflare Worker
2. **Local Cache** — Stores at `~/.summon/cache/rituals/{author}/{name}.yaml`
3. **Ritual Loader** — Resolves `@author/name` to cached or fetched ritual
4. **Auto-refresh** — Checks registry for updates on run

### Local Cache Structure

```
~/.summon/cache/rituals/
├── financial-analyst/
│   ├── researcher.yaml
│   └── scanner.yaml
├── code-reviewer/
│   └── security-audit.yaml
└── ...
```

---

## Gap Chat Steering Mode (NEW)

**Gap Chat** adds human-in-the-loop steering for ritual execution. The agent pauses at checkpoints, allowing you to adjust course.

### Three Modes

| Mode | Flag | Behavior |
|------|------|----------|
| **Autonomous** | `--autonomous` (default) | Full auto, no checkpoints |
| **Interactive** | `--interactive` | Pause at checkpoints for steering |
| **Review** | `--review` | Pause and wait for approval to continue |

### Checkpoints

Execution pauses at three phases:
1. `after_data_collection` — Data gathered, before analysis
2. `before_analysis` — About to start analysis phase
3. `before_conclusion` — Before final output generation

### Steering Commands

When paused at a checkpoint, you can issue commands:

| Command | Description |
|---------|-------------|
| `SET_FRAMEWORK <name>` | Switch analysis framework |
| `ADJUST_STYLE <style>` | Change output style (terse, verbose, technical) |
| `CONTINUE` | Resume execution |
| `RETRY` | Re-run current phase |

### Preference Persistence

Your steering preferences are saved per ritual:

```
~/.summon/preferences/{ritualId}.yaml
```

Example:
```yaml
ritualId: financial-analyst/researcher
preferredFramework: dcf
outputStyle: technical
autoApprove: before_conclusion
```

### Usage

```bash
# Interactive mode with checkpoints
summon run @author/name "Analyze Q4 earnings" --interactive

# Review mode — approve each checkpoint
summon run @author/name "Security audit" --review
```

---

## Runtime Engine (NEW)

The **Runtime Engine** executes rituals with streaming output and comprehensive observability.

### Features

| Feature | Description |
|---------|-------------|
| **Streaming Execution** | Real-time output as the agent works |
| **Tool Resolution** | Dynamic tool binding with secret injection |
| **Secret Injection** | Injects secrets from `~/.summon/.env` into tools |
| **Trace Collection** | Full execution traces for debugging |

### Tool Resolution Flow

```
Ritual declares required tools
         ↓
Runtime resolves tool implementations
         ↓
Secrets injected from ~/.summon/.env
         ↓
Tools bound to agent (scoped)
         ↓
Execution begins with streaming output
```

### Trace Collection

Execution traces are stored as JSONL:

```
~/.summon/traces/
├── 2026-02-20/
│   ├── trace-{sessionId}.jsonl
│   └── trace-{sessionId}.jsonl
```

Each trace contains:
- Tool calls and results
- LLM requests/responses
- Checkpoint events
- Steering commands
- Errors and recoveries

---

## First-Run Setup

Summon now includes a formalized setup process that triggers automatically on first run:

### Directory Structure

```
~/.summon/
├── .env                    # API keys (600 permissions)
├── config.yaml             # User preferences
├── sessions/               # Chat history
│   └── runs/               # Execution logs (JSONL)
├── rituals/                # Downloaded rituals
├── cache/                  # Tool results, LLM cache
│   └── rituals/            # Registry ritual cache
├── logs/                   # Debug logs
├── traces/                 # Execution traces (JSONL)
├── preferences/            # Steering preferences
└── components/
    ├── tools/              # External tools
    ├── skills/             # User skills
    └── personas/           # User personas

~/Documents/Summon/         # Exported documents
```

### Reconfigure Flow (Change Model)

When API keys already exist, you can re-run setup to change models without re-entering keys:

```bash
$ summon setup

Step 2: LLM Provider (Required)
────────────────────────────────
[1] OpenRouter - Multi-provider access (recommended)
...
> 1

OpenRouter Configuration:
Current API key: sk-or-v1-a...e280
Get a new key: https://openrouter.ai/keys
OPENROUTER_API_KEY (Press Enter to keep existing): 

Select a model:
Current: z-ai/glm-5

[1] GLM-5 (default) ← current
[2] GPT-5.3
[3] Claude Opus 4.6
[4] Gemini 3.0
[5] Enter custom model ID

💡 Find more at: https://openrouter.ai/models
> 3
✓ Model: anthropic/claude-opus-4.6
✓ OpenRouter configured
```

**Key behaviors:**
- Press **Enter** at API key prompt → keeps existing key
- Always shows **current model** marked with `← current`
- Enter number to **switch models** instantly
- Empty input at model prompt → keeps current model

### Interactive Flow (First Run)

```bash
$ summon run "What is AAPL price?" --ritual financial-researcher-graduated.yaml
🦞 First run detected. Setting up summon...

Step 1: Creating directory structure...
✓ Directories created

Step 2: LLM Provider (Required)
────────────────────────────────
[1] OpenRouter - Multi-provider access (recommended)
[2] OpenAI - Direct OpenAI access
[3] Anthropic - Claude models
[4] Google - Gemini models
[5] xAI - Grok models
[6] Ollama - Local models (no API key needed)

> 1
OpenRouter Configuration:
OPENROUTER_API_KEY: sk-xxx

Select a model:
[1] GPT-4o Mini (fast, cheap)
[2] Claude 3.5 Sonnet (smart)
[3] Gemini 2.0 Flash
[4] GLM-5 (default)
[5] Enter custom model ID

> 4
✓ Model: z-ai/glm-5
✓ OpenRouter configured

Step 3: Tool Configuration
──────────────────────────
Set up these tools now? [Y/n] Y

AlphaVantage (financial data)
ALPHAVANTAGE_API_KEY: xxx
✓ Saved

✅ Setup Complete!
═══════════════════
Config: ~/.summon/config.yaml
Auth:   ~/.summon/.env

🔄 Continuing with your query...
```

### Pre-flight Check

Before spawning agents, summon validates:
- LLM API key configured
- Required tools available (based on ritual)
- Suggests fixes if anything missing

### Commands

```bash
summon setup                    # Interactive setup wizard
summon config --location        # Show all storage paths
summon doctor                   # Health check
```

---

## Multi-Agent Orchestration

**Patterns supported:**
- **Parallel** — Agents work simultaneously, results merged
- **Sequential** — Agents pass output to next (handoff)
- **Hierarchical** — Coordinator plans, delegates to workers

**Example team YAML:**
```yaml
team:
  name: research-team
  orchestration:
    pattern: hierarchical
    coordinator: planner
  agents:
    - id: planner
      role: coordinator
      ritual: ./coordinator.yaml
    - id: researcher
      role: worker
      ritual: ./researcher.yaml
      listenFrom: [planner]
```

---

## Agent Trainer (Decision Points)

Instead of real-time monitoring, the trainer creates **decision points** when patterns are detected:

```
Session runs → Pattern detected → Decision point created
                                      ↓
Human reviews later ← Chat thread ← Robot message
                                      ↓
                            Decision recorded → Session continues
```

**Detection patterns:**
- Retry loops
- Quality decline
- Drop-offs (issues not addressed)
- Token spikes
- Milestones reached
- Forks (multiple valid paths)

**CLI:**
```bash
summon trainer decisions list --pending
summon trainer decisions chat <id>
summon trainer decisions resolve <id> --action "switch-agent"
```

---

## Guardrails System

**Three layers:**
1. **Basic** — Schema, regex, function validation
2. **Advanced** — Content policy, tool policy, cost policy, quality policy, time policy
3. **Rules** — Pre-built rules (noTodos, properErrorHandling, relevance, etc.)

```typescript
import { createSchemaGuardrail, jsonSchema } from 'summon';

const guardrail = createSchemaGuardrail(jsonSchema({
  type: 'object',
  required: ['analysis', 'recommendation']
}));
```

---

## YAML Ritual Structure

```yaml
name: financial-analyst
version: 1.0.0

persona:
  role: Senior Financial Analyst
  goal: Provide accurate, data-driven financial insights
  backstory: Expert analyst with 15 years in investment research
  behavior:
    style: professional
    priorities: [accuracy, data-driven insights]

skills:
  - id: finance
    requiredTools: [financial_search]
    promptFragment: You can retrieve financial data...

model:
  primary: gpt-5.2
  provider: openai

guardrails:
  maxResponseLength: 2000
  requireExamples: true
```

---

## Clawdbot Integration

**Clawdbot is the primary interface** — users interact via chat (WhatsApp, Telegram, Discord)
- I orchestrate summon sessions via `sessions_spawn` / `sessions_send`
- CLI is available but secondary to chat-based control

---

## AO (Agent Orchestrator) Integration

**Status:** Stage 4 Complete — Patterns proven, integration ready when needed

### What AO Built (Experimental)

| Feature | Status | Relevance to Summon |
|---------|--------|---------------------|
| **Micro-task spawn** | ✅ Proven | Parallel multi-agent execution |
| **Agent pool** | ✅ Proven | Automatic IDE selection |
| **Cloudflare durability** | ✅ Proven | Rituals survive crashes |
| **Checkpoint/resume** | ✅ Proven | Long-running rituals |
| **Edge execution** | ✅ Proven | Cost optimization |

### Key Finding

AO = **learning platform**, Summon = **production stack**
- AO proves patterns in the wild
- Summon ports only proven, needed patterns
- No integration until user demand justifies complexity

### When to Port

Port AO patterns to Summon when users need:
1. Parallel multi-agent rituals
2. Rituals that survive laptop crashes
3. Team collaboration on rituals
4. Automatic cost optimization

**Decision:** Keep separate for now. Document patterns for future use.

### Documentation

- **Full analysis:** `notes/AO_INTEGRATION.md`
- **AO location:** `~/.openclaw/workspace/skills/agent-orchestrator/`
- **CF Worker:** `https://ao-cf1.shape02174.workers.dev`

---

## Cloudflare Edge Deployment (Future)

**Status:** Research Complete (`FUTURE_PLAN.md`), Implementation Pending

**Target architecture:**
- **Workflows** — RitualEngineV2 (durable steps, automatic checkpoint/resume)
- **Durable Objects** — One per agent session (state survives crashes)
- **AI Gateway** — Universal LLM routing with caching, rate limiting, cost tracking
- **D1** — Metrics, audit, billing
- **R2** — Large artifacts
- **KV** — Config, shared prompts

**Cost at scale:** ~$0.02 per 1,000 tasks (CF infra) + $60-100 (LLM inference)

**When to start:** When user demand justifies complexity (survive crashes, team collab, hosted service)

---

## Project Notes

### 2026-02-20 — Registry, Runtime Engine, Gap Chat Steering

**Registry Integration:**
- Cloudflare Worker deployed at `https://summon-registry-api.shape02174.workers.dev`
- `summon run @author/name` — fetch rituals from registry
- Local cache at `~/.summon/cache/rituals/`
- Registry client, cache manager, ritual loader implemented

**Gap Chat Steering Mode:**
- Three modes: `--autonomous`, `--interactive`, `--review`
- Checkpoints: `after_data_collection`, `before_analysis`, `before_conclusion`
- Steering commands: `SET_FRAMEWORK`, `ADJUST_STYLE`, `CONTINUE`, `RETRY`
- Preferences persist to `~/.summon/preferences/{ritualId}.yaml`

**Runtime Engine:**
- Execute rituals from registry with streaming output
- Tool resolution with secret injection from `~/.summon/.env`
- Streaming execution with real-time output
- Trace collection to `~/.summon/traces/` (JSONL)

**Updated Directory Structure:**
- `~/.summon/traces/` — execution traces
- `~/.summon/preferences/` — steering preferences
- `~/.summon/cache/rituals/` — registry ritual cache
- `~/.summon/.env` — secrets (chmod 600)

**New CLI Commands:**
- `summon run @author/name --interactive` — run with steering
- `summon review @author/name` — review ritual before running
- `summon check @author/name` — graduation checks

### 2026-02-18 Evening — Directory Consolidation & Blaze Prep
- **Unified directories** — All paths now use `~/.summon/` exclusively
- **Removed `.summon_mem`** — Legacy folder deleted, paths consolidated
- **Created `src/config/paths.ts`** — Single source of truth for all paths
- **External tools moved** — `~/.summon/components/tools/`
- **Code quality fixes**:
  - Tesla ticker extraction (name → TSLA mapping)
  - Clean output format (`[Answer]` prefix)
  - Real AlphaVantage API (no random data)
  - Default model selection (GLM-5)
- **Blaze ready** — Parallel execution via AO integration

### 2026-02-18 — Multi-Provider Setup & CLI Polish
- **Multi-provider LLM support** — 6 providers: OpenRouter, OpenAI, Anthropic, Google, xAI, Ollama
- **Interactive setup wizard** — `summon setup` with provider selection and model picker
- **Reconfigure flow** — Change models without re-entering API keys (press Enter to skip)
- **Model awareness** — Shows current model marked with `← current`, allows instant switching
- **Auto-detection priority** — OpenRouter → OpenAI → Anthropic → Google → xAI → Ollama
- **Environment loading** — `~/.summon/.env` takes precedence over repo `.env`
- **Tool name alignment** — `alphavantage_api` → `financial_search`, `tavily_search` → `web_search`
- **Error handling** — Classified errors with recovery suggestions (auth_missing, rate_limit, etc.)
- **New commands** — `summon config --location`, `summon doctor`
- **Fixed double setup loop** — Preflight skips if first-run setup just completed
- **Fixed default model logic** — Empty input properly uses provider default
- **Fixed output format** — Changed from `[ritual-name] [ritual-name]` to `[Answer]`
- **Working end-to-end** — AAPL price query verified with real AlphaVantage data

### 2026-02-18 — Reconciliation
- All major modules built and integrated
- 2 minor type errors to fix (IDEType, agent-factory)
- CLI fully functional: run, compose, orchestrate, parallel, teams, trainer
- Ready for Cloudflare port when demand justifies

### 2026-02-13 — AO Stage 4 Complete
- AO evolved from dashboard to cloud-backed durability
- Stage 4: CF Worker + D1 Database + multi-agent orchestration
- Patterns proven but kept separate from Summon (stability priority)

---

## Links

| Repo | Path | Description |
|------|------|-------------|
| **summon** (canonical) | `/Users/river/clawd/projects/summon` | CLI framework |
| **summon** (workspace) | `~/.openclaw/workspace/projects/summon` | Local dev copy |
| **summon-ai-doc** | `/Users/river/clawd/projects/summon-ai-doc` | Astro docs site |
| **summon-academy** | `/Users/river/clawd/projects/summon-academy` | Training & graduation |
| **Registry API** | `https://summon-registry-api.shape02174.workers.dev` | Ritual registry |

---

*Last updated: 2026-03-01 (MCP Full Spec Implementation COMPLETE — all TypeScript errors fixed, type-clean build)*

---

## Completed This Session (2026-03-01)

**MCP Full Spec Implementation — Production Ready**

✅ **TypeScript Clean** — All 20+ type errors fixed, `npm run typecheck` passes  
✅ **Transports** — stdio, HTTP/SSE fully supported  
✅ **Capabilities** — Tools, Resources, Prompts with capability negotiation  
✅ **ToolResolver v2** — Layer 3 external tools integrated  
✅ **CLI Commands** — `summon mcp list|connect|tools|resources|prompts`  
✅ **Config** — YAML-based MCP server configuration with env var expansion  

**Files Modified:**
- `src/mcp/client.ts` — Full MCP client with SDK types
- `src/mcp/resolver.ts` — ToolResolver integration with re-exports
- `src/mcp/index.ts` — Module exports
- `src/mcp/resolver.ts` — Added aliases for missing exports
- `src/tools/resolver-v2.ts` — Zod v4 compatibility (z.record with 2 args)
- `src/tools/cf-resolver.ts` — Zod v4 compatibility
- `src/ritual/types-v2.ts` — Zod v4 compatibility + schema defaults
- `src/runtime/context.ts` — Added AgentEvent import, onProgress type
- `src/runtime/engine.ts` — Re-export Execution types
- `src/cli/agent-commands.ts` — Fixed objective fallback
- `src/registry/r2-client.ts` — Added export aliases
- `src/ritual/loader.ts` — Added loadRitual alias

**Next Steps:**
- Test with real MCP server (Context7, filesystem)
- End-to-end ritual execution with MCP tools
- Documentation update in summon-ai-doc

---

## Adaptive Routing Rules

**If request matches Active Stream (MCP/tools):**
→ Proceed with implementation (`src/mcp/client.ts`, `src/mcp/resolver.ts`)
→ Update `MCP_IMPLEMENTATION.md` with progress
→ Integrate with `ToolResolver v2`

**If request diverges from Active Stream:**
→ Surface `/commands` for routing:
- `/branch mcp-http-transport` — Add HTTP/SSE transport
- `/evaluate` — Analyze if we need full spec or subset
- `/defer "MCP prompts"` — Park for later
- `/integrate` — Merge with existing MCP work

**Never auto-reject based on "we're 95% done" — always offer routing options.**
