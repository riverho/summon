# Summon — Future Plan: Cloudflare Edge Deployment

**Date:** 2026-02-14
**Status:** Research Complete, Implementation Pending

---

## Executive Summary

Summon's architecture maps cleanly onto Cloudflare's edge platform. Hundreds of agents can start working in <1 second using Durable Objects (not per-agent Worker deploys). CF infrastructure cost is negligible (~$0.02 per 1,000 task executions) — the real cost is LLM inference ($60-100 per 1,000 tasks depending on complexity mix).

---

## Current State (Local-First)

| Layer | Implementation | Location |
|-------|---------------|----------|
| Agent spawning | Mocked (`openclaw-client.ts`) | `src/runtime/openclaw-client.ts` |
| Checkpoints | JSON files on disk | `~/.summon/rituals/{id}/chk-*.json` |
| Billing/credits | JSON file per user | `~/.summon/billing/{userId}.json` |
| Metrics | JSON daily files | `~/.summon/metrics/metrics-*.json` |
| Storage adapter | `LocalStorageAdapter` (JSONL) | `src/storage/local.ts` |
| Orchestration | In-process `Promise.all` fan-out | `src/durable/ritual-engine-v2.ts` |

No Cloudflare SDK, no `wrangler.toml`, no D1/KV/R2 clients exist in the repo today. AO patterns are proven separately at `ao-cf1.shape02174.workers.dev`.

---

## Target Architecture: Cloudflare Edge

### Key Architectural Decision

**Do NOT deploy one Worker per agent.** Worker script deploys take 5-10 seconds each.

Instead:

```
3 Worker scripts (one per agent type: claude, codex, kimi)
  └── 100+ Durable Objects (one per agent session)
       └── Each DO holds its own state, checkpoint, context
       └── Instantiation: <1ms per DO
```

**100 agents running within 1 second? Yes.**

### Primitive Mapping

| Summon Component | CF Primitive | Why |
|---|---|---|
| `RitualEngineV2` | **Workflows** | Durable steps with automatic checkpoint/resume — replaces `CheckpointManager` entirely |
| `ContextManager` per agent | **Durable Objects** | One DO per agent session, state survives crashes, single-writer consistency |
| `CheckpointManager` | **DO Storage** or **Workflows built-in** | Replaces filesystem-based JSON checkpoints |
| `AgentFactory.spawnSubAgent()` | **Workers + DO instantiation** | Create DO on demand, route task via fetch |
| Task fan-out (`Promise.all(batch)`) | **Queues** | Decouple task dispatch from execution, free retry semantics |
| `CreditSystem` cost tracking | **AI Gateway** | Per-request cost logging, rate limiting, provider fallback — free |
| `MetricsCollector` | **D1** | SQL queries over ritual/task history, agent performance stats |
| Large outputs (ritual artifacts) | **R2** | Zero egress fees, S3-compatible, unlimited size |
| Agent config, shared prompts | **KV** | Read-heavy, globally replicated in ~60 seconds |
| `ComposedAgent` runtime | **CF Agents SDK** (`@cloudflare/agents`) | Built-in tool calling, memory, state machines, human-in-the-loop on Durable Objects |

### LLM Routing Strategy

| Task Complexity | Route To | Via |
|---|---|---|
| `trivial` / `simple` | Workers AI (Llama 3.x 7B-70B) | Direct — cheap, low latency |
| `moderate` | Mistral / Groq | AI Gateway — fast, mid-quality |
| `complex` / `deep` | Anthropic / OpenAI | AI Gateway — high quality, cached |

AI Gateway provides: universal endpoint, request caching, rate limiting, fallback routing, cost tracking — all free.

---

## Realistic Constraints

### Hard Walls

| Constraint | Limit | Impact on Summon |
|---|---|---|
| Worker memory | 128 MB per isolate | Cannot hold full ritual context tree in memory. Must stream from DO storage. |
| DO serialization | Single-threaded per object | Coordinator DO receiving 100 task-completion callbacks processes them sequentially. Design with batching. |
| Workers AI quality | 7B-70B open models only | Fine for `trivial`/`simple` tasks. `complex`/`deep` must route to Anthropic/OpenAI via AI Gateway. |
| D1 write throughput | ~1,000 writes/sec per database | SQLite single-writer. Fine for metrics/audit. Not for hot-path state mutations. |
| KV consistency | Eventually consistent (~60s) | Never use KV for agent state that multiple agents mutate. Use DOs. |
| Queues message size | 128 KB | Task payloads with large context must reference R2 objects, not inline data. |
| Worker CPU (Standard) | 30ms | Enough for routing/dispatch. LLM calls use Unbound (30s CPU) or external API. |
| Workflows concurrency | ~1,000 active instances (beta) | Limits concurrent rituals in beta. Expect increase at GA. |

### Not Problems

| Concern | Reality |
|---|---|
| Cold starts | ~0ms. V8 isolates, not containers. |
| Concurrent requests | No hard cap on Workers Paid. Thousands in-flight simultaneously. |
| Script count | 500K per dispatch namespace with Workers for Platforms. |
| Global distribution | 300+ PoPs. Agents run near the user, not in us-east-1. |

---

## Cost Model at Scale

### Scenario: 100 concurrent agents, 10 tasks each = 1,000 task executions

| Component | Usage | Cost |
|---|---|---|
| Workers (Unbound) requests | 2,000 requests | $0.00004 |
| Workers CPU time | 500 CPU-seconds | $0.01 |
| Durable Objects requests | 5,000 requests | $0.00075 |
| DO Storage | 5 MB | $0.001/month |
| Workers AI (simple tasks) | 2M tokens | ~$22.00 |
| External LLM (complex tasks) | 500 tasks x 16K tokens | ~$40-80 |
| AI Gateway | 1,000 LLM calls | $0.00 (free) |
| D1 (metrics/audit) | 1,000 writes + 5,000 reads | $0.006 |
| Queues | 2,000 messages | $0.0008 |
| R2 (artifacts) | 100 MB | $0.0015/month |
| **CF Infrastructure Total** | | **~$0.02** |
| **Total with LLM Inference** | | **~$60-100** |

At 10,000 tasks/day, the CF infrastructure bill would be under $10/month. Cost is dominated entirely by LLM providers.

---

## Workers for Platforms (Multi-Tenant Future)

When Summon becomes a hosted service where each user/team gets isolated agent workers:

- **500,000 scripts per dispatch namespace** — each tenant gets their own isolated Worker
- Full environment isolation (separate KV, secrets, DO namespaces per tenant)
- Programmatic deploy via REST API (no Wrangler needed)
- Dispatch Worker routes `user-123.summon.ai/api` to that user's Worker

**Current stage:** Overkill for single-developer CLI. Essential when hosting Summon as a platform.

---

## Migration Path

### Phase 1: Storage Adapter

Implement `CloudflareStorageAdapter` (the `StorageAdapter` interface in `src/storage/types.ts` is already designed to be swappable via `SUMMON_STORAGE` env var):

- Sessions/chat history → D1
- Checkpoints → DO Storage
- Metrics → D1
- Billing → D1
- Large artifacts → R2
- Config/prompts → KV

### Phase 2: Ritual Engine on Workflows

Port `RitualEngineV2` to Cloudflare Workflows:

- Each ritual = one Workflow instance
- Each task = one `step.do()` call (durable, retryable)
- Parallel fan-out = `Promise.all()` on `step.do()` calls
- Crash recovery = automatic (Workflows built-in)
- `CheckpointManager` → eliminated (Workflows handles this)
- `autoCheckpointInterval` → eliminated

### Phase 3: Agent Sessions on Durable Objects

Wrap each agent session in a Durable Object:

- One DO class per agent type (claude, codex, kimi)
- DO manages own state lifecycle, context, tool calls
- WebSocket hibernation for long-running sessions
- Consider `@cloudflare/agents` SDK as base class

### Phase 4: LLM Routing via AI Gateway

Replace direct LLM calls with AI Gateway:

- Universal endpoint for all providers
- Cache repeated prompts (exact-match or semantic)
- Rate-limit free-tier users at gateway level
- Automatic fallback between providers
- Cost tracking without application logic

### Phase 5: Real OpenClaw Integration

Replace mock mode in `openclaw-client.ts`:

- `sessions_spawn` → CF Worker + DO instantiation
- `sessions_list` → D1 query
- `sessions_history` → DO storage read
- `sessions_send` → DO fetch or WebSocket

### Phase 6: Multi-Tenant (Workers for Platforms)

- Dispatch Worker as front door
- Per-tenant Workers behind it
- Per-session DOs within each tenant's Worker
- Tenant isolation via separate KV/DO namespaces

---

## Key References

| Resource | URL |
|---|---|
| Workers Limits | https://developers.cloudflare.com/workers/platform/limits/ |
| Durable Objects | https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Workers AI Models | https://developers.cloudflare.com/workers-ai/models/ |
| CF Agents SDK | https://developers.cloudflare.com/agents/ |
| D1 Database | https://developers.cloudflare.com/d1/ |
| R2 Storage | https://developers.cloudflare.com/r2/ |
| Queues | https://developers.cloudflare.com/queues/ |
| KV | https://developers.cloudflare.com/kv/ |
| Workflows | https://developers.cloudflare.com/workflows/ |
| AI Gateway | https://developers.cloudflare.com/ai-gateway/ |
| Workers for Platforms | https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/ |
| Pricing | https://www.cloudflare.com/plans/developer-platform/ |

---

## Decision

**Cloudflare is the right deployment target for Summon.** The architecture already thinks in the right patterns (DAG execution, checkpoints, agent routing, credit tracking). CF makes them durable and global instead of local. The gap is implementation, not design.

**When to start:** When user demand justifies the complexity. The local-first CLI works today. Port to CF when users need:
1. Parallel multi-agent rituals that survive crashes
2. Team collaboration on rituals
3. Hosted multi-tenant service
4. Global low-latency agent execution

---

*Generated from codebase analysis + Cloudflare platform research, 2026-02-14*
