# Summon Multi-Provider Setup - Complete

## What's Been Implemented

### 1. LLM Provider Support (6 providers)

| Provider | Env Var | Model Env Var | Setup URL |
|----------|---------|---------------|-----------|
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | https://openrouter.ai/keys |
| OpenAI | `OPENAI_API_KEY` | `OPENAI_MODEL` | https://platform.openai.com/api-keys |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` | https://console.anthropic.com/settings/keys |
| Google | `GOOGLE_API_KEY` | `GOOGLE_MODEL` | https://makersuite.google.com/app/apikey |
| xAI | `XAI_API_KEY` | `XAI_MODEL` | https://x.ai/api |
| Ollama | `OLLAMA_BASE_URL` | `OLLAMA_MODEL` | https://ollama.com |

### 2. Auto-Detection Priority

1. `DEFAULT_LLM_PROVIDER` env var (explicit override)
2. `OPENROUTER_API_KEY` (if set)
3. `OPENAI_API_KEY` (if set)
4. `ANTHROPIC_API_KEY` (if set)
5. `GOOGLE_API_KEY` (if set)
6. `XAI_API_KEY` (if set)
7. `OLLAMA_BASE_URL` (if set)

### 3. Model Routing

**Explicit prefixes** (bypass auto-detection):
- `openai/gpt-4o-mini` → OpenRouter
- `claude-3-5-sonnet` → Anthropic direct
- `gemini-2.0-flash` → Google direct
- `ollama:llama3.2` → Ollama local

**Auto-routing** by provider detection + model env var

### 4. Interactive Setup Flow

```bash
$ summon setup

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
[7] Skip (configure later)

> 1
OpenRouter API key: sk-or-v1-****

Select a model:
[1] GPT-4o Mini (fast, cheap)
[2] Claude 3.5 Sonnet (smart)
[3] Gemini 2.0 Flash
[4] GLM-5 (default)
[5] Enter custom model ID

💡 Find more at: https://openrouter.ai/keys
> 1
✓ Model: openai/gpt-4o-mini
✓ OpenRouter configured

Step 3: Tool Configuration (Optional)
─────────────────────────────────────
These tools enhance your rituals:
  • Tavily Search - Web search for news and research
  • AlphaVantage - Real-time stock quotes and financial data

Set up these tools now? [Y/n] Y

Tavily Search
Get free key: https://tavily.com
TAVILY_API_KEY: tvly-****
✓ Saved

AlphaVantage
Get free key: https://www.alphavantage.co/support/#api-key
ALPHAVANTAGE_API_KEY: ****
✓ Saved

✓ Configuration saved

✅ Setup Complete!
═══════════════════

Your data is stored in:
  Config:     ~/.summon/config.yaml
  Auth:       ~/.summon/.env (gitignored)
  Sessions:   ~/.summon/sessions/
  Rituals:    ~/.summon/rituals/
  Docs:       ~/Documents/Summon/

Configured:
  LLM:        OpenRouter
  Tools:      Tavily, AlphaVantage

Next steps:
  summon run "What is AAPL price?" --ritual <path>
```

### 5. Directory Structure

```
~/.summon/
├── .env                    # API keys (600 permissions)
├── config.yaml             # User preferences
├── sessions/               # Chat history
├── rituals/                # Downloaded rituals
├── cache/                  # Tool results, LLM cache
└── logs/                   # Debug logs

~/Documents/Summon/         # Exported documents
```

### 6. New Commands

```bash
# Interactive setup
summon setup

# Show storage locations
summon config --location

# Health check
summon doctor

# First run auto-trigger
summon run "Query" --ritual <path>
```

### 7. Configuration Template

```bash
# Copy template
cp .env.example ~/.summon/.env

# Edit
nano ~/.summon/.env
```

Template includes all providers with comments and setup URLs.

## Files Modified

1. `src/cli/setup-formal.ts` - Multi-provider setup wizard
2. `src/runtime/llm.ts` - Provider auto-detection and routing
3. `src/cli/index.ts` - Setup commands integration
4. `.env.example` - Comprehensive template

## Test Command

```bash
# 1. Clean slate
rm -rf ~/.summon

# 2. Run (triggers setup)
cd /Users/river/.openclaw/workspace/projects/summon
bun run src/cli/index.ts run "What is AAPL price?" \
  --ritual /Users/river/.openclaw/workspace/projects/summon-academy/rituals/single-agent/financial-researcher-graduated/ritual.yaml

# 3. Interactive setup will guide you through:
#    - Provider selection
#    - API key entry
#    - Model selection
#    - Tool configuration
```

## No Bloat Principles Applied

1. ✅ **One-time setup** - Config saved, not repeated
2. ✅ **Clear locations** - Printed on completion
3. ✅ **Provider choice** - 6 options, user picks one
4. ✅ **Model selection** - Sensible defaults + custom option
5. ✅ **Tool awareness** - Only asks for what ritual needs
6. ✅ **Auto-detection** - No manual provider specification needed
7. ✅ **Backwards compatible** - Old env vars still work

## Next Steps for River

1. Delete `~/.summon` to test fresh setup
2. Run `summon run` command
3. Follow interactive prompts
4. Verify AAPL price query works
5. Check `~/Documents/Summon/` for exports