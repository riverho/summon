# Summon — Polished UX (Ready to Test)

## 🎯 Design Goals Achieved

| Goal | Solution |
|------|----------|
| **Run anywhere** | Global CLI via `npm install -g` + `~/.summon/` config |
| **Works without setup** | Demo mode + graceful degradation |
| **Minimal interaction** | One-time `summon setup` wizard |
| **No re-prompting** | Config saved to `~/.summon/config.yaml` |
| **No bloat** | Progressive disclosure, smart defaults |

---

## 🚀 Quick Start (3 Options)

### Option 1: Zero Setup (Demo Mode)
```bash
npm install -g summon
summon "What is AI?"
# Works immediately in demo mode
```

### Option 2: Quick Setup (Recommended)
```bash
npm install -g summon
summon setup
# 4-step wizard → full features

summon "Analyze AAPL stock"
```

### Option 3: Advanced (Current)
```bash
cd projects/summon
bun run src/cli/summon.ts "Query" --ritual path/to/ritual.yaml
```

---

## 🎨 User Experience Flow

### First Run
```
$ summon
🦞 Welcome to Summon!
   Run `summon setup` to get started, or try:
   summon "What is AI?" --quick
```

### Setup Wizard (4 steps, 2 minutes)
```
$ summon setup

Step 1/4: LLM Provider
[1] OpenAI  [2] Anthropic  [3] OpenRouter  [4] Skip (demo)
> 3
OpenRouter API key: sk-or-v1-****
✓ Verified

Step 2/4: Data Location (Enter for default)
> ~/.summon/
✓ Created directories

Step 3/4: Default Ritual
[1] General  [2] Code reviewer  [3] Financial  [4] Skip
> 3

Step 4/4: Optional Tools
[1] Skip  [2] AlphaVantage  [3] Tavily  [4] All
> 1

🎉 Setup complete! Try: summon "What is the P/E of AAPL?"
```

### Daily Use (Zero Friction)
```bash
# Quick query (uses defaults)
summon "Summarize Bitcoin whitepaper"

# Specific ritual
summon "Review this PR" --ritual code-reviewer

# List sessions
summon sessions list

# Check auth
summon auth list
```

---

## 🛠️ New Commands

### summon setup
Interactive 4-step onboarding wizard.

### summon config
```bash
summon config get llm.default_model
summon config set llm.default_model claude-sonnet-4
summon config list
```

### summon auth
```bash
summon auth list        # Show configured keys
summon auth add tavily  # Add new key
summon auth remove ...  # Remove key
```

### summon sessions
```bash
summon sessions list              # Recent sessions
summon sessions show <id>         # Full history
summon sessions export <id> --pdf # Export to PDF
```

---

## 📁 File Structure (After Setup)

```
~/.summon/
├── config.yaml              # Main config
├── credentials/
│   ├── openrouter.enc       # Encrypted API keys
│   ├── alphavantage.enc
│   └── tavily.enc
├── sessions/                # Chat history
│   └── 2026-02-18/
│       └── sess-abc123.jsonl
├── memory/                  # Long-term memory
├── cache/                   # LLM + tool cache
├── rituals/                 # Downloaded defaults
│   ├── financial-analyst.yaml
│   └── code-reviewer.yaml
└── logs/
    └── summon.log
```

---

## 🧪 Test the Polished UX

```bash
# 1. Test demo mode (no setup)
cd /Users/river/.openclaw/workspace/projects/summon
bun run src/cli/summon.ts "What is AI?"

# 2. Test setup wizard
bun run src/cli/summon.ts setup

# 3. Test with credentials
export OPENROUTER_API_KEY=sk-or-v1-...
bun run src/cli/summon.ts "Analyze KO stock" \
  --ritual /Users/river/.openclaw/workspace/projects/summon-academy/rituals/single-agent/financial-researcher-graduated/ritual.yaml
```

---

## ✅ Implementation Status

| Component | Status | File |
|-----------|--------|------|
| Setup wizard | ✅ | `src/cli/setup.ts` |
| Polished CLI entry | ✅ | `src/cli/summon.ts` |
| Config persistence | ✅ | `~/.summon/config.yaml` |
| Demo mode | ✅ | Built into entry point |
| Graceful degradation | ✅ | Warnings, no blocking |
| Config commands | ✅ | `summon config *` |
| Auth commands | ✅ | `summon auth *` |
| Sessions commands | 🔄 | Skeleton implemented |

---

## 🎯 Use Cases Covered

| User Type | Experience |
|-----------|------------|
| **New user** | `npm install -g summon` → `summon setup` → ready in 2 min |
| **Casual** | `summon "Quick question"` (uses defaults, no flags) |
| **Power user** | Full flags: `--ritual`, `--verbose`, `--model` |
| **No API key** | Demo mode works, prompts to upgrade |
| **Team** | Share rituals in repo, everyone uses same YAML |

---

## 📝 Next Steps

1. **Test the setup wizard**: `bun run src/cli/summon.ts setup`
2. **Test demo mode**: `bun run src/cli/summon.ts "Hello"`
3. **Verify typecheck**: `bun run typecheck`
4. **Install globally**: `bun link` → `summon --help`

---

*No bloat. Just summon.* 🦞