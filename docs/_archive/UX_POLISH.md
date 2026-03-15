# Summon UX Polish — Design Doc

**Goal:** Zero-friction agent summoning — install once, run anywhere, smart defaults, graceful degradation.

**Principles:**
- **No bloat** — Every feature earns its place
- **Minimal interaction** — One-time setup, then invisible
- **Progressive disclosure** — Simple by default, powerful when needed
- **Fail gracefully** — Works partially without full config

---

## 1. Global CLI Access (Run Anywhere)

### Current State
```bash
cd /Users/river/.openclaw/workspace/projects/summon
bun run src/cli/index.ts run "query" --ritual ...
```

### Target State
```bash
# Any folder, any terminal
summon "Analyze AAPL"                          # Quick mode
summon run "Analyze AAPL" --ritual financial   # Full mode
summon "Analyze AAPL" --quick                  # No ritual, compose on fly
```

### Implementation
```bash
# Install once
curl -fsSL https://summon.ai/install | bash
# Or: npm install -g summon
# Or: bun install -g summon

# Creates:
# /usr/local/bin/summon → ~/.summon/bin/summon
# ~/.summon/ → config, sessions, memory, cache
```

---

## 2. Smart Defaults (Works Without Full Setup)

### No Auth? No Problem.
```bash
$ summon "What is AI?"
⚠️  No LLM API key found. Running in DEMO mode.
   → Set OPENAI_API_KEY for live responses
   → Or run: summon setup

[DEMO] Simulated response:
AI (Artificial Intelligence) is...
```

### No Ritual? Compose on Fly.
```bash
$ summon "Research Tesla stock"
🦞 Quick compose: researcher persona + finance skill
   (No ritual specified, using defaults)

→ Set default ritual: summon config set ritual.default financial-researcher
```

### No Tools? Mock Mode.
```bash
$ summon run "Get AAPL price" --ritual financial.yaml
⚠️  ALPHAVANTAGE_API_KEY not set. Tool calls will be simulated.
   → Run: summon auth add alphavantage
```

---

## 3. Interactive Onboarding (One-Time)

### Entry Points
```bash
# First run anywhere
$ summon
🦞 Welcome to Summon! Let's set you up.

# Or explicit
$ summon init
$ summon setup
```

### Onboarding Flow (Minimal Steps)

```
Step 1/4: LLM Provider
──────────────────────
Choose your default LLM:
  [1] OpenAI (GPT-4o)
  [2] Anthropic (Claude)
  [3] OpenRouter (multi-provider)
  [4] Skip for now (demo mode)

> 3

OpenRouter API key: sk-or-v1-****
✓ Verified

Step 2/4: Data Location
──────────────────────
Where should Summon store sessions and memory?
  [1] Default: ~/.summon/
  [2] Custom path

> 1
✓ Created ~/.summon/{sessions,memory,cache,credentials}

Step 3/4: Default Ritual (Optional)
───────────────────────────────────
Choose a default agent personality:
  [1] General researcher
  [2] Code reviewer
  [3] Financial analyst
  [4] Skip (specify per-run)

> 3
✓ Downloaded financial-analyst ritual

Step 4/4: Optional Tools
────────────────────────
Add API keys for enhanced capabilities?
  [1] Skip (add later)
  [2] AlphaVantage (stocks)
  [3] Tavily (web search)
  [4] All of the above

> 1

🎉 Setup complete! Try: summon "What is the P/E of AAPL?"
```

### Config Persistence
```yaml
# ~/.summon/config.yaml
version: "1.0.0"

# LLM settings
llm:
  default_provider: openrouter
  default_model: openai/gpt-4o-mini
  api_keys:
    openrouter: "${SUMMON_OPENROUTER_KEY}"

# Storage paths  
storage:
  base_path: "~/.summon"
  sessions: "${storage.base_path}/sessions"
  memory: "${storage.base_path}/memory"
  cache: "${storage.base_path}/cache"
  credentials: "${storage.base_path}/credentials"

# Default ritual
defaults:
  ritual: "financial-analyst"
  
# Onboarding state
onboarding:
  completed: true
  version: "1.0.0"
  date: "2026-02-18"
```

---

## 4. Daily Use Patterns

### Pattern A: Quick Query (No Flags)
```bash
$ summon "Summarize Bitcoin whitepaper"
→ Uses default ritual
→ Saves to session history
→ Returns answer
```

### Pattern B: Specific Ritual
```bash
$ summon "Review this PR" --ritual code-reviewer
→ Uses specified ritual
→ Context-aware for code review
```

### Pattern C: Ad-hoc Compose
```bash
$ summon compose "Plan a trip to Japan" --persona planner --skills travel,research
→ Composes ritual on the fly
→ No YAML file needed
```

### Pattern D: Continue Session
```bash
$ summon "What about Kyoto?" --continue
→ Detects follow-up
→ Loads previous session context
```

---

## 5. Environment Checking (Auto, No Prompt)

### On Every Run
```typescript
async function checkEnvironment(): Promise<EnvStatus> {
  const checks = {
    config: exists('~/.summon/config.yaml'),
    llm_key: hasApiKey(config.llm.default_provider),
    default_ritual: exists(config.defaults.ritual),
  };
  
  if (!checks.config) {
    // Silent: just works in demo mode
    return { mode: 'demo', warnings: ['Run `summon setup` for full features'] };
  }
  
  if (!checks.llm_key) {
    return { mode: 'limited', warnings: ['LLM key missing, using mock mode'] };
  }
  
  return { mode: 'full' };
}
```

### Warnings (Non-Blocking)
```
$ summon "Query"
⚠️  Tavily API key expired. Web search disabled.
   → Run: summon auth refresh tavily

✓ Answer (without web search):
...
```

---

## 6. Interactive Commands (When Needed)

### summon config
```bash
$ summon config get llm.default_model
openai/gpt-4o-mini

$ summon config set llm.default_model claude-sonnet-4
✓ Updated

$ summon config list
llm.default_model = claude-sonnet-4
defaults.ritual = financial-analyst
storage.base_path = ~/.summon
```

### summon auth
```bash
$ summon auth list
✓ openrouter: ************c13
✓ alphavantage: ************INJ
⚠ tavily: expired
✗ google: not set

$ summon auth add tavily
Tavily API key: tvly-****
✓ Verified and saved

$ summon auth remove alphavantage
✓ Removed
```

### summon sessions
```bash
$ summon sessions list
┌─────────────────┬─────────────┬──────────────────────────┐
│ Session ID      │ Date        │ Preview                  │
├─────────────────┼─────────────┼──────────────────────────┤
│ sess-abc123     │ 2 hours ago │ "AAPL earnings analysis" │
│ sess-def456     │ Yesterday   │ "Bitcoin research"       │
└─────────────────┴─────────────┴──────────────────────────┘

$ summon sessions show sess-abc123
[Full session history]

$ summon sessions export sess-abc123 --pdf
✓ Exported to ./sess-abc123.pdf
```

---

## 7. File Structure (After Setup)

```
~/.summon/
├── config.yaml              # Main config
├── credentials/
│   ├── openrouter.enc       # Encrypted API keys
│   ├── alphavantage.enc
│   └── tavily.enc
├── sessions/
│   ├── 2026-02-18/
│   │   └── sess-abc123.jsonl
│   └── 2026-02-17/
├── memory/
│   ├── long-term.jsonl      # Learned patterns
│   └── preferences.yaml     # User preferences
├── cache/
│   ├── llm/
│   └── tools/
├── rituals/
│   ├── financial-analyst.yaml  # Downloaded defaults
│   └── code-reviewer.yaml
└── logs/
    └── summon.log
```

---

## 8. Implementation Priority

### Phase 1: Core Experience
1. [ ] Global CLI install (`npm install -g`)
2. [ ] Auto-config discovery (`~/.summon/config.yaml`)
3. [ ] Demo mode (works without API keys)
4. [ ] `summon setup` wizard

### Phase 2: Polish
1. [ ] `summon config` commands
2. [ ] `summon auth` commands
3. [ ] `summon sessions` commands
4. [ ] Smart defaults & graceful degradation

### Phase 3: Advanced
1. [ ] Auto-ritual selection based on query
2. [ ] Context-aware follow-up detection
3. [ ] Cloud sync for sessions

---

## Use Cases

| User | Workflow |
|------|----------|
| **New user** | `npm install -g summon` → `summon setup` → `summon "Hello"` |
| **Casual** | `summon "Quick question"` (uses defaults) |
| **Power user** | `summon run ... --ritual custom.yaml --verbose` |
| **Team** | Share rituals in repo, `summon run --ritual ./team/ritual.yaml` |
| **No auth** | Works in demo mode, prompts to upgrade when ready |

---

*Design: Minimal setup, maximum utility. No bloat.*