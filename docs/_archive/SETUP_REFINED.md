# Summon Setup & Directory Structure

## Unified Directory Structure

```
~/.summon/
├── .env                    # API keys (600 permissions, gitignored)
├── config.yaml             # User preferences
├── sessions/               # Chat history
│   └── runs/              # Agent execution logs (JSONL)
├── rituals/                # Downloaded ritual YAML files
├── cache/                 # Tool results, LLM cache
├── logs/                  # Debug logs
├── components/             # User components
│   ├── tools/             # External tools (financial-search.ts, etc.)
│   ├── skills/            # User skills
│   └── personas/          # User personas
└── decisions/             # Trainer decision points

~/Documents/Summon/         # Exported documents
```

## Memory & Sessions

### Session Storage
- **Primary**: `~/.summon/sessions/` - Chat history and session metadata
- **Runs**: `~/.summon/sessions/runs/` - JSONL execution logs

### Why Dual Locations?
**Legacy issue:** The codebase previously used two locations:
- `~/.summon/` (new, formalized setup)
- `~/.summon_mem/` (legacy, now deprecated)

**Fix applied:** All code now uses `~/.summon/` exclusively via `src/config/paths.ts`

### Chat History
```typescript
// Now uses: ~/.summon/sessions/{sessionId}.json
```

## Setup Commands

```bash
# First run - interactive setup
summon setup

# Check configuration
summon config --location

# Health check
summon doctor

# Run with ritual
summon run "Query" --ritual path/to/ritual.yaml
```

## External Tools

Place external tools in:
```
~/.summon/components/tools/financial-search.ts
```

## Blaze Mode (Parallel)

```bash
# Enable Blaze mode for parallel execution
/ao start
```

### Blaze Configuration
```json
// ~/.openclaw/ao/config/ao.json
{
  "mode": "blaze",
  "workers": [
    {
      "id": "local-primary",
      "url": "http://localhost:18789",
      "capabilities": ["codex", "claude", "kimi"],
      "priority": 1
    }
  ]
}
```

## Code Quality

### Consolidated Files
| File | Purpose |
|------|---------|
| `src/config/paths.ts` | Unified path definitions |
| `src/cli/setup-formal.ts` | Interactive wizard |
| `src/runtime/tools.ts` | Real AlphaVantage API |

### Removed Bloat
- Duplicate session storage
- Legacy `.summon_mem` references
- Stub tools with random data
- Duplicate path definitions

### Fixed Issues
- ✅ Tesla ticker extraction (name → TSLA mapping)
- ✅ Clean output format (`[Answer]` prefix)
- ✅ Real AlphaVantage API integration
- ✅ Default model selection (GLM-5)
