# Summon — TLDR

**What it is:** A CLI framework to compose and summon AI agents using portable YAML rituals. Think "Docker for AI agents" but with YAML instead of Dockerfiles.

**Core Metaphor:**
- **Ritual** = YAML file (persona + skills + model config)
- **Components** = Reusable personas and skills you mix/match
- **Summoning** = `summon run` to instantiate an agent
- **Binding** = Connecting tools to skills (scoped, not global)

---

## Quick Commands

```bash
# Summon with a YAML ritual
summon run "Analyze AAPL revenue" --ritual ./financial-analyst.yaml

# Quick compose on the fly
summon compose "Analyze AAPL" --persona analyst --skills finance

# List available components
summon components list
summon skills list
summon personas list
```

---

## Philosophy

Instead of monolithic agent configs, you **compose** agents from reusable pieces:
- Financial analyst = `analyst` persona + `finance` skill + `web-search` skill
- Components are wired together at runtime
- Skills declare required tools — only those get bound (scoped, not global)

---

## Key Directories

| Path | Purpose |
|------|---------|
| `~/.summon_mem/sessions/` | Chat history |
| `~/.summon_mem/components/` | User-installed skills/personas |
| `~/.braddy/` | User global components (legacy?) |
| `src/builtin/` | Built-in personas and skills |
| `examples/agents/` | Sample YAML rituals |

---

## Architecture

- **Clawdbot is the primary interface** — users interact via chat (WhatsApp, Telegram, Discord)
- I orchestrate summon sessions via `sessions_spawn` / `sessions_send`
- CLI is available but secondary to chat-based control

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
```

---

## Current State

- **Location:** `~/.openclaw/workspace/projects/summon/`
- **Primary dev target:** Yes (per MEMORY.md)
- **Linked globally:** `bun link` makes `summon` command available
- **Tagline:** "🦞 Summon your agents in just one-line with Clawdbot"

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

## Project Notes

### 2026-02-13 — AO Stage 4 Complete
- AO (Agent Orchestrator) evolved from dashboard to cloud-backed durability
- Stage 4: CF Worker + D1 Database + multi-agent orchestration
- Patterns proven but kept separate from Summon (stability priority)
- Full integration analysis in `notes/AO_INTEGRATION.md`

### Previous
- *Add ongoing work, blockers, or decisions here...*

---

## Links

- **Repo:** `/Users/river/clawd/projects/summon` (canonical)
- **Workspace copy:** `~/.openclaw/workspace/projects/summon`
- **Doc site:** `/Users/river/clawd/projects/summon-ai-doc`

---

*Last updated: 2026-02-13 (AO Stage 4 complete)*
