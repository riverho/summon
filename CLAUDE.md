# CLAUDE.md

**Vision:** 🦞 Summon your agents in just one-line with Clawdbot. Assemble multi-agent bots for your workflow. Built for OpenClaw community.

## What is Summon AI?

A CLI framework for composing multi-agent bots. Not a financial analyst agent — that's just ONE example.

**Key Commands:**
- `summon compose "..."` — Quick agent from command line
- `summon run --ritual ./agent.yaml` — Run YAML-defined agent
- `summon components list` — See available personas/skills

## Remember

Summon AI is a **framework for building agents**, not a specific agent type.

---

## ⚠️ Workspace & File Paths (CRITICAL)

When spawned by OpenClaw/Brad, you're running in a **sandboxed environment**.

### Rules:
1. **Always use absolute paths** within `~/.openclaw/workspace/`
2. **This project lives at:** `/Users/river/.openclaw/workspace/projects/summon/`
3. **Never assume** `/Users/river/Projects/summon/` is accessible — it's outside the sandbox
4. **Write output files** to this project directory, not to arbitrary paths

### Example - Correct:
```
Write to: /Users/river/.openclaw/workspace/projects/summon/MY_OUTPUT.md
```

### Example - Wrong:
```
Write to: /Users/river/Projects/summon/MY_OUTPUT.md  ❌ (outside sandbox)
Write to: ~/Projects/summon/MY_OUTPUT.md  ❌ (outside sandbox)
```

### Why this matters:
OpenClaw's exec sandbox restricts file access. Paths outside allowed directories will fail silently or redirect to the workspace root, causing confusion.
