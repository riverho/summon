# Closing the Gap: Agentic Workflow → True Agent

**Date:** 2026-03-01  
**Status:** ✅ GAP CLOSED  

---

## The Hairline Gap (Identified)

### Before (Agentic Workflow)
```
Human: "Analyze AAPL"
    ↓
summon: Executes ritual → Returns result
    ↓
Human: "That didn't work"
    ↓
Human: "/pivot"  ←── Human must trigger
    ↓
summon: Changes strategy
```

**Gap:** Who closes the feedback loop? **Human does.**

### After (True Agent)
```
Human: "Monitor my portfolio"  ←── One-time goal
    ↓
summon-agent: Spawns persistent goal
    ↓
[Self-monitoring loop]
    ├─ Track: Tool success rate
    ├─ Track: Human interventions
    ├─ Track: Latency
    ↓
Agent: "Success rate 40%, below 70% threshold"
    ↓
Agent: Auto-triggers /evaluate  ←── AGENT initiates
    ↓
Agent: "Propose switching to alternative tools"
    ↓
Human: "Approve" / "Reject"  ←── Human gate, but agent-initiated
    ↓
Agent: Adapts or continues
```

**Gap closed:** Agent closes the feedback loop.

---

## Implementation: Self-Monitoring Layer

### 1. Self-Monitor (summon)
**File:** `src/agent/self-monitor.ts`

```typescript
class SelfMonitor {
  recordExecution(trace)     // Track every tool call
  evaluate(goalId)           // Self-evaluate health
  autoSteer(evaluation)      // Propose /commands
}
```

**Metrics tracked:**
- Tool success rate (did tools work?)
- Human interventions (did human have to steer?)
- Replanning events (how often strategy changed?)
- Latency (performance degradation?)

### 2. True Agent Runtime (summon)
**File:** `src/agent/runtime.ts`

```typescript
class TrueAgentRuntime {
  execute(ritual, context)   // Wraps standard execution
  checkAndPropose()          // Check if steering needed
}
```

**Integration:** Wraps `executeRitual()` with self-monitoring.

### 3. Agent CLI (summon)
**File:** `src/cli/agent-commands.ts`

```bash
summon agent create -n portfolio -o "Monitor daily"
summon agent run portfolio -r river@watcher
summon agent health portfolio
```

### 4. Self-Attention (attention-layer)
**File:** `scripts/self-attention.py`

```bash
self-attention.py create portfolio "Monitor daily"
self-attention.py check portfolio
self-attention.py apply portfolio --approve
```

**Mirrors TypeScript logic** for attention-layer integration.

---

## Self-Evaluation Logic

### Health States

| Health | Trigger | Action | Human Gate? |
|--------|---------|--------|-------------|
| **healthy** | All metrics good | continue | No |
| **degraded** | 1-2 issues | /evaluate or /branch | Yes |
| **failing** | Too many interventions | /pivot | Yes |

### Thresholds (Configurable)

```yaml
thresholds:
  min_success_rate: 0.7      # 70% tool success
  max_latency: 5000          # 5 seconds
  max_interventions: 3       # 3 human steers = failing
```

---

## Example: True Agent in Action

### Scenario: Portfolio Monitoring Agent

**Step 1: Create Goal**
```bash
summon agent create \
  -n portfolio-monitor \
  -o "Monitor AAPL, TSLA, NVDA daily, alert on 5% moves"
```

**Step 2: Agent Self-Monitors**
```
[Day 1] Tool success: 100% → continue
[Day 2] Tool success: 85% → continue  
[Day 3] Tool success: 40% → DEGRADED
```

**Step 3: Agent Initiates Steering**
```
Agent: ⚡ Auto-steer triggered
Action: /evaluate
Reason: Tool success rate 40% below threshold 70%

Proposal: Yahoo Finance API failing frequently. 
          Recommend switching to AlphaVantage backup.

Human approval required:
> summon agent approve portfolio-monitor
> summon agent reject portfolio-monitor
```

**Step 4: Adapt or Continue**
- **Approve:** Agent switches to AlphaVantage, resets metrics
- **Reject:** Agent continues with Yahoo, logs human preference

---

## Comparison: Before vs After

| Aspect | Before (Workflow) | After (True Agent) |
|--------|-------------------|-------------------|
| **Goal setting** | Human per-query | Human once, agent persists |
| **Monitoring** | Human watches | Self-monitors automatically |
| **Failure detection** | Human notices | Auto-detects via metrics |
| **Steering trigger** | Human initiates | Agent initiates, human approves |
| **Learning** | None | Tracks performance, adapts |
| **Scale** | 1:1 human-agent | 1 human : N agent goals |

---

## Key Insight

> **The attention layer pattern works for both human and agent.**

- **Human-managed:** `!MAP.md → TLDR.md → Human /command → Action`
- **Agent-managed:** `Goal → Metrics → Self-eval → /command → Human gate → Action`

Same `/commands`, different trigger.

---

## What's New (Files Created)

| File | Purpose |
|------|---------|
| `summon/src/agent/self-monitor.ts` | Track metrics, evaluate, propose actions |
| `summon/src/agent/runtime.ts` | True agent wrapper around executeRitual |
| `summon/src/cli/agent-commands.ts` | CLI for agent mode |
| `attention-layer/scripts/self-attention.py` | Python mirror for attention integration |

---

## Verification

**Test it:**
```bash
# 1. Create agent goal
cd ~/.openclaw/workspace/projects/summon
summon agent create -n test -o "Test objective"

# 2. Run with self-monitoring
summon agent run test -r river@yfinance-researcher -q "Analyze AAPL"

# 3. Check health
summon agent health test

# 4. Force degradation (simulate failures)
# Edit ~/.summon/agent/metrics.json, lower success_rate

# 5. See auto-steer trigger
summon agent health test  # Should propose /evaluate
```

---

## Status

**✅ GAP CLOSED**

Agentic workflow → True agent

- Self-evaluation: ✅
- Auto-steering: ✅  
- Human gate (approval): ✅
- Persistent goals: ✅
- OpenClaw scalable: ✅

**summon is now a true agent system.**

---

*Gap closed 2026-03-01 — Self-monitoring layer operational*
