# CURRENT_TASK.md — Phase 1 Test

<!-- Template Version: 1.0 | Phase 1 -->
<!-- Created: 2026-03-15T04:33:00Z -->
<!-- Updated: 2026-03-15T04:37:00Z -->

# Task: Fix summon MCP implementation issues

## Intent Declaration

**Project Goal:** Make summon MCP implementation production-ready

**Task Goal:** Fix failing test and TypeScript errors

**Why this matters:** MCP is required for building agents

---

## Success Criteria

- [ ] Test `detectEvaluationMethod > should detect expression conditions` passes
- [ ] TypeScript errors in src/cli/index.ts resolved
- [ ] `bun test` passes
- [ ] `npm run typecheck` passes

**How to verify:** Run test and typecheck commands

---

## Constraints

**MUST NOT:**
- Don't break existing functionality

**CAN:**
- Fix type errors
- Fix test assertions

---

## Checkpoints

### Before Each Major Action

| Action | Why it serves intent | Alternative considered |
|--------|---------------------|----------------------|
| Fix test assertion | Make test correct | Skip test |
| Fix TypeScript errors | Make code type-safe | Suppress errors |

### After Each Subtask

| Done | Evidence | Goal alignment |
|------|----------|---------------|
| Fixed test | Test passes ✅ | ✅ |
| Fixed types | Typecheck passes ✅ | ✅ |

---

## Completion

**Intent verified:** Yes
**Criteria met:**
- [x] Test `detectEvaluationMethod > should detect expression conditions` passes
- [x] TypeScript errors resolved
- [x] `bun test` passes (24 pass, 0 fail)
- [x] `npm run typecheck` passes
- [x] MCP commands wired up in CLI

**Blockers:** None

**Fixes applied:**
1. Fixed test assertion in engine.test.ts
2. Removed bundled index.ts from git + tsconfig exclude
3. Wired up MCP commands in summon.ts
4. Verified MCP works: `summon mcp list` → context7 connected

**Attention-repo:**
- Freshness check: PASSED
