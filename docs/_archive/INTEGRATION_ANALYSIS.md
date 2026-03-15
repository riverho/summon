# Summon + Summon-Academy Integration Analysis

**Date:** 2026-02-18
**Status:** Interactive setup not working, need architectural fix

---

## Current Issues

### 1. Interactive Setup Not Triggering
- Warning shows: "Missing tools: alphavantage_api, tavily_search"
- But no interactive prompt appears
- Agent continues with degraded functionality (0 tool calls)

**Root Cause:** `process.stdin` is already consumed by agent runtime, can't read user input mid-execution.

### 2. Architecture Gap
- summon-academy has training, guardrails, acquisition design
- summon CLI doesn't integrate with these capabilities
- Missing connection between "graduated rituals" and runtime

### 3. Error Handling
- Silent failures (0 tool calls, no error)
- No clear path from "missing tools" to "setup completed"
- User has to manually debug

---

## Blaze Mode Analysis

### Parallel Workstreams

#### Stream A: Training System (summon-academy)
- **Status:** TUI complete, E2E working, first acquisition done
- **Gap:** Not integrated with summon CLI
- **Need:** Export graduated rituals to summon-compatible format

#### Stream B: Guardrails (summon-academy)
- **Status:** 5-layer design complete (GUARDRAIL_DESIGN.md)
- **Gap:** Not implemented in summon runtime
- **Need:** Integrate guardrails into ComposedAgent

#### Stream C: Interactive Setup (summon CLI)
- **Status:** Code written but not working
- **Gap:** stdin conflict with agent runtime
- **Need:** Pre-flight check before agent spawn

#### Stream D: Error Handling & Observability
- **Status:** Basic logging exists
- **Gap:** No clear error recovery path
- **Need:** Structured error types + recovery suggestions

---

## Proposed Solutions

### Solution 1: Pre-Flight Check (Recommended)
Instead of interactive setup mid-run, do pre-flight:

```bash
$ summon run "Query" --ritual financial.yaml

🔍 Pre-flight Check
───────────────────
✓ LLM API key (OpenRouter)
✗ AlphaVantage API key (required for financial-data skill)
✗ Tavily API key (required for web-research skill)

⚠️  2 required tools missing.

Options:
  [1] Run setup now (interactive)
  [2] Continue without tools (limited results)
  [3] Cancel

> 1
🔧 Setup:
   Setup location [~/.summon]: 
   ALPHAVANTAGE_API_KEY: xxx
   TAVILY_API_KEY: xxx
✓ Saved to ~/.summon/.env

🔄 Re-running with full capabilities...
[Agent runs with tools]
```

### Solution 2: External Setup Command
Force explicit setup before run:

```bash
$ summon run "Query" --ritual financial.yaml
⚠️  Missing: alphavantage_api, tavily_search
   Run: summon setup --tools alphavantage,tavily
   Or:  summon setup --interactive

$ summon setup --interactive
[Interactive setup]

$ summon run "Query" --ritual financial.yaml
[Works with tools]
```

### Solution 3: Config-Based Setup
Store setup state in config, check on every run:

```yaml
# ~/.summon/config.yaml
setup:
  completed: false
  missing_tools: [alphavantage_api, tavily_search]

# On run, if not completed:
# Show warning + quick setup command
# Don't block, but remind
```

---

## Integration Points

### summon-academy → summon

| Academy Feature | Summon Integration |
|-----------------|-------------------|
| Graduated rituals | `~/.summon/rituals/` or `summon rituals list` |
| Training sessions | `summon sessions list` (unified) |
| Guardrails | Runtime validation in ComposedAgent |
| Tool registry | `tools/_custom/` auto-discovery |

### File Structure

```
~/.summon/
├── config.yaml              # User preferences + setup state
├── .env                     # API keys (auto-created)
├── rituals/                 # Graduated + custom rituals
│   ├── financial-researcher-graduated.yaml
│   └── code-reviewer.yaml
├── sessions/                # Chat history
└── cache/                   # Tool results, LLM responses
```

---

## Implementation Plan

### Phase 1: Fix Setup (Immediate)
1. Move interactive setup to PRE-run (not mid-run)
2. Add `summon setup` command with proper CLI
3. Store setup state in config
4. Pre-flight check before agent spawn

### Phase 2: Integrate Academy (Week 1)
1. Copy graduated rituals to `~/.summon/rituals/`
2. Unify session storage (academy + summon)
3. Add `summon rituals list` command
4. Auto-discover tools from `tools/_custom/`

### Phase 3: Guardrails (Week 2)
1. Implement pre-flight validation
2. Add runtime guardrails to ComposedAgent
3. Quality checks on outputs
4. Cost tracking integration

### Phase 4: Blaze Mode (Week 3)
1. Enable distributed training
2. Parallel ritual development
3. Automated graduation pipeline

---

## Immediate Fix

For the current issue, implement Solution 1 (Pre-flight Check):

```typescript
// In summon run command, BEFORE agent.spawn:
const check = await preFlightCheck(options.ritual);
if (!check.ok) {
  const action = await promptUser(check.missing);
  if (action === 'setup') {
    await runInteractiveSetup();
    // Re-run check
    const recheck = await preFlightCheck(options.ritual);
    if (!recheck.ok) {
      console.log('Setup incomplete. Continuing with limited functionality.');
    }
  }
}
// Then continue with agent spawn
```

---

## Blaze Mode Command

```bash
# Start parallel analysis
/ao start

# Split into workstreams
/worker 1: analyze summon-academy training integration
/worker 2: fix summon CLI interactive setup
/worker 3: implement guardrails in ComposedAgent
/worker 4: design unified session storage

# Coordinate results
/coordinate results

# Code review
/review all
```

---

## Conclusion

The current approach of interactive setup mid-run won't work due to stdin conflicts. We need:

1. **Pre-flight validation** before agent spawn
2. **Explicit setup command** (`summon setup`)
3. **Integration layer** between academy and summon
4. **Unified config** in `~/.summon/`

Ready to implement with blaze mode.