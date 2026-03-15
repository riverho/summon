# Summon Setup Process — Design Document

**Goal:** Zero-friction onboarding with clear separation of user data from repo

**Principle:** No bloat, just essential

---

## Current Problem

| Issue | Current State | Target State |
|-------|---------------|--------------|
| Auth location | `summon/.env` (repo) | `~/.summon/.env` (user home) |
| Setup trigger | Manual | Auto-detect on first run |
| Dependencies | Manual install | Auto-install on ritual load |
| Locations | Unclear | Clearly reported |

---

## Proposed Setup Flow

### Entry Points

```bash
# 1. First run auto-trigger
$ summon run "Query" --ritual financial.yaml
🦞 First run detected. Setting up summon...
[Interactive setup starts]

# 2. Explicit setup
$ summon setup
[Interactive setup starts]

# 3. Missing requirement trigger
$ summon run "Query" --ritual financial.yaml
⚠️  Missing: alphavantage_api, tavily_search
🔧 Run setup? [Y/n] 
[Interactive setup for missing only]
```

### Setup Steps (Minimal)

```
Step 1: Create Directory Structure
─────────────────────────────────
✓ Created ~/.summon/
  ├── .env              (API keys - never committed)
  ├── config.yaml       (preferences)
  ├── sessions/         (chat history)
  ├── rituals/          (your rituals)
  └── docs/             (saved outputs)

Step 2: LLM Provider (Required)
──────────────────────────────
Choose your LLM provider:
  [1] OpenRouter (recommended - multi-provider)
  [2] OpenAI
  [3] Anthropic
  [4] Skip (configure later)

> 1
OpenRouter API key: sk-or-v1-****
✓ Verified and saved

Step 3: Ritual-Specific Tools (Optional)
───────────────────────────────────────
This ritual requires:
  • financial_search (AlphaVantage)
  • web_search (Tavily)

Set up now? [Y/n] 

AlphaVantage API key (get free: https://...): ****
✓ Saved

Tavily API key (get free: https://...): ****
✓ Saved

Step 4: Complete
───────────────
✅ Setup complete!

Your data is stored in:
  Config:     ~/.summon/config.yaml
  Auth:       ~/.summon/.env (gitignored)
  Sessions:   ~/.summon/sessions/
  Rituals:    ~/.summon/rituals/
  Docs:       ~/Documents/Summon/ (or ~/.summon/docs/)

Next steps:
  summon run "What is AAPL price?" --ritual financial-researcher
```

---

## Directory Structure

```
~/.summon/                      # User data (never in repo)
├── .env                        # API keys (600 permissions)
├── config.yaml                 # User preferences
├── sessions/                   # Chat history
│   └── 2026-02-18/
│       └── sess-abc123.jsonl
├── rituals/                    # User's rituals
│   └── financial-researcher.yaml
├── cache/                      # Tool results, LLM cache
│   └── tavily/
└── logs/
    └── summon.log

~/Documents/Summon/             # Exported documents (default)
├── exports/
│   ├── analysis-2026-02-18.pdf
│   └── report-2026-02-18.md
└amed sessions/
    ├── AMEX-Research.json
    └── Code-Review.json
```

---

## Implementation Checklist

### Phase 1: Core Setup
- [ ] Move `.env` detection from repo to `~/.summon/.env`
- [ ] Auto-detect first run (check `~/.summon/config.yaml`)
- [ ] Interactive setup wizard
- [ ] Save to `~/.summon/` with proper permissions

### Phase 2: Ritual-Aware Setup
- [ ] Parse ritual YAML for required tools
- [ ] Map tool names to setup URLs
- [ ] Conditional prompts (only ask for what's needed)

### Phase 3: Clear Reporting
- [ ] Print directory structure on completion
- [ ] Add `summon config --location` command
- [ ] Add `summon doctor` for diagnostics

### Phase 4: Dependencies
- [ ] Auto-install tool dependencies on first use
- [ ] Check node_modules existence
- [ ] Run npm install if needed

---

## Commands

```bash
# Main setup
summon setup

# Check health
d summon doctor
# Output:
#   ✓ Config: ~/.summon/config.yaml
#   ✓ Auth: ~/.summon/.env (3 keys set)
#   ✓ Sessions: ~/.summon/sessions/ (12 sessions)
#   ⚠️  Missing: TAVILY_API_KEY

# Show locations
summon config --location
# Output:
#   Config:     ~/.summon/config.yaml
#   Auth:       ~/.summon/.env
#   Sessions:   ~/.summon/sessions/
#   Rituals:    ~/.summon/rituals/
#   Cache:      ~/.summon/cache/
#   Docs:       ~/Documents/Summon/
```

---

## No Bloat Principles

1. **Don't ask if already configured** — Check `~/.summon/` first
2. **Don't install unused tools** — Only what's in the ritual
3. **Don't repeat setup** — One-time per machine
4. **Don't obscure locations** — Print clearly on completion
5. **Don't auto-migrate** — Warn user, let them decide

---

## Migration Path (for current users)

```bash
# Detect existing repo .env
$ summon run "Query"
⚠️  Found .env in summon repo. Migrate to ~/.summon/? [Y/n]

Migrating:
  ✓ Created ~/.summon/
  ✓ Copied API keys
  ✓ Updated .gitignore

Please delete repo .env manually when ready.
```

---

## Summary

| Feature | Essential? | Implementation |
|---------|-----------|----------------|
| ~/.summon/ directory | ✅ Yes | Create on first run |
| Interactive API setup | ✅ Yes | For missing tools only |
| Clear location reporting | ✅ Yes | Print on setup complete |
| Auto dependency install | 🟡 Nice-to-have | npm install if missing |
| Migration from repo .env | 🟡 Nice-to-have | Warn, don't auto |
| Tool aliasing | 🟡 Nice-to-have | Map names automatically |

---

*Design complete. Ready to implement.*