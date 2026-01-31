# Summon CLI - Implementation Plan

Based on code review findings, this prioritized checklist addresses issues in order of execution dependency and impact.

---

## 🚨 Immediate Fixes (Critical)

These must be resolved before the application can run.

### 1. Fix Broken Module Exports in CLI Entry Point
**File:** `src/cli/index.ts` (lines 178-182)

**What:** Update export paths from non-existent `./llm.js` to correct `./runtime/llm.js` (and others)

**Effort:** Small

**Dependencies:** None

- [ ] Change `export * from './llm.js';` → `export * from './runtime/llm.js';`
- [ ] Change `export * from './config.js';` → `export * from './runtime/config.js';`
- [ ] Change `export * from './env.js';` → `export * from './runtime/env.js';`
- [ ] Change `export * from './memory.js';` → `export * from './runtime/memory.js';`
- [ ] Change `export * from './scratchpad.js';` → `export * from './runtime/scratchpad.js';`
- [ ] Change `export * from './tools.js';` → `export * from './runtime/tools.js';`

---

### 2. Fix Non-existent Default Model
**File:** `src/runtime/llm.ts` (lines 28-30)

**What:** Replace invalid model names with valid ones (gpt-4o, gpt-4o-mini, claude-sonnet-4-20250514, etc.)

**Effort:** Small

**Dependencies:** None

- [ ] Change `DEFAULT_MODEL = 'gpt-5.2'` → `DEFAULT_MODEL = 'gpt-4o'`
- [ ] Change `FAST_MODELS['openai'] = 'gpt-4.1'` → `FAST_MODELS['openai'] = 'gpt-4o-mini'`
- [ ] Change `FAST_MODELS['anthropic'] = 'claude-haiku-4-5'` → `FAST_MODELS['anthropic'] = 'claude-sonnet-4-20250514'`
- [ ] Change `FAST_MODELS['google'] = 'gemini-3-flash-preview'` → `FAST_MODELS['google'] = 'gemini-2.5-flash'`
- [ ] Change `FAST_MODELS['xai'] = 'grok-4-1-fast-reasoning'` → `FAST_MODELS['xai'] = 'grok-3'`

---

### 3. Fix Hardcoded Placeholder Model Names
**File:** `src/cli/index.ts` (lines 33, 37, 40, 43)

**What:** Replace invalid model names in model provider configurations

**Effort:** Small

**Dependencies:** #2 (establish valid model naming convention)

- [ ] Change `'claude-sonnet-4-5-20250929'` → `'claude-sonnet-4-20250514'`
- [ ] Change `'gemini-3-pro-preview'` → `'gemini-2.5-pro'`
- [ ] Change `'grok-4-1-reasoning'` → `'grok-3'`
- [ ] Change `'llama3'` → `'llama3.3'`

---

### 4. Remove Duplicate Interface Definition
**File:** `src/components/types.ts` (lines 183-191)

**What:** Remove the duplicate `ToolCallRecord` interface definition

**Effort:** Small

**Dependencies:** None

- [ ] Identify which definition is correct (check usage throughout codebase)
- [ ] Remove the duplicate at lines 183-191 (or earlier at ~159)
- [ ] Verify no TypeScript errors after removal

---

### 5. Fix Missing Type Safety with Non-null Assertions
**File:** `src/components/composed-agent.ts` (line 72)

**What:** Replace non-null assertion with safe optional chaining

**Effort:** Small

**Dependencies:** None

- [ ] Change `for (const toolCall of response.tool_calls!)` → `for (const toolCall of response.tool_calls ?? [])`

---

### 6. Replace Stub Implementation in Finance Tool
**File:** `src/builtin/skills/finance/index.ts`

**What:** Either implement real API integration or clearly mark as mock with realistic error handling

**Effort:** Large

**Dependencies:** None

- [ ] Complete real API integration (Alpha Vantage/other data provider), OR
- [ ] Replace with clear mock/stub implementation that throws `NotImplementedError`, OR
- [ ] Remove the stub and add clear documentation that this feature is planned

---

## ⚡ Quick Wins (Minor Issues)

### 7. Remove Unused Import
**File:** `src/cli/index.ts` (line 10)

**What:** Remove `ComposedAgentSpec` from imports

**Effort:** Tiny

**Dependencies:** None

- [ ] Change `import { ComposedAgentSpec, composeAgent, quickCompose }` → `import { composeAgent, quickCompose }`

---

### 8. Define CLI Option Type Interfaces
**File:** `src/cli/index.ts`

**What:** Extract inline types into reusable interfaces

**Effort:** Small

**Dependencies:** None

- [ ] Define interface for line 30 options: `{ ritual?: string; model?: string; verbose?: boolean }`
- [ ] Define interface for line 82 options: `{ persona: string; skills: string; model?: string; verbose?: boolean }`
- [ ] Replace inline types with interface references

---

### 9. Remove Console Logging from LLM Module
**File:** `src/runtime/llm.ts` (line 33)

**What:** Remove or replace `console.log` with proper logger interface

**Effort:** Small

**Dependencies:** None (logger framework is nice-to-have, remove for now)

- [ ] Remove line 33: `console.log(\`  OpenAI-compatible: ${baseUrl}\`);`

---

### 10. Add Error Propagation for YAML Parsing
**File:** `src/components/registry.ts` (line 130)

**What:** Throw errors on malformed YAML instead of silently failing

**Effort:** Small

**Dependencies:** None

- [ ] Change catch block to re-throw or log with warning level that halts execution
- [ ] Ensure configuration errors are visible to users

---

### 11. Clean Up TODO Comments
**File:** `src/tools/index.ts` (line 1)

**What:** Remove or update misleading comment about `agent_brad` integration

**Effort:** Tiny

**Dependencies:** None

- [ ] Update comment to reflect current status, OR
- [ ] Remove comment if implementation is complete
- [ ] If integration is pending, convert to TODO: comment with ticket reference

---

### 12. Add Error Handling in Finance Tool
**File:** `src/builtin/skills/finance/index.ts` (lines 160-175)

**What:** Add validation for extracted tickers and handle unrecognized queries

**Effort:** Medium

**Dependencies:** #6 (resolve stub implementation first)

- [ ] Validate extracted ticker against known tickers list
- [ ] Return helpful error for unrecognized tickers
- [ ] Handle queries that don't match any routing keywords

---

### 13. Fix Inconsistent Ticker Extraction
**File:** `src/builtin/skills/finance/index.ts` (line 161)

**What:** Improve ticker regex to avoid false positives

**Effort:** Small

**Dependencies:** None

- [ ] Replace `/\b[A-Z]{1,5}\b/` with more restrictive pattern
- [ ] Cross-reference extracted string against known ticker list before accepting

---

## 🎯 Nice-to-Have (Future Improvements)

### 14. Add Zod Schema Validation
**File:** `src/components/registry.ts`

**What:** Implement actual validation logic in `validateComposition()`

**Effort:** Medium

**Dependencies:** None

- [ ] Validate referenced persona IDs exist
- [ ] Validate referenced skill IDs exist
- [ ] Validate required tools for skills are available
- [ ] Return proper error messages for invalid references

---

### 15. Add Rate Limiting and Retry Logic
**Files:** `src/builtin/skills/finance/index.ts`, `src/builtin/skills/web-search/index.ts`

**What:** Implement retry with exponential backoff and rate limiting for API calls

**Effort:** Large

**Dependencies:** None

- [ ] Add retry logic (3 attempts with exponential backoff)
- [ ] Add rate limiter for Alpha Vantage (5 calls/minute limit)
- [ ] Add circuit breaker for repeated failures

---

### 16. Add Input Sanitization
**File:** `src/components/composed-agent.ts` (buildFinalAnswerPrompt)

**What:** Sanitize user queries to prevent prompt injection

**Effort:** Medium

**Dependencies:** None

- [ ] Add input validation/sanitization function
- [ ] Apply to user queries before prompt insertion
- [ ] Consider using a library like `dompurify` for HTML/script escaping

---

### 17. Replace Magic Numbers with Constants
**File:** `src/components/composed-agent.ts` (line 279)

**What:** Define `MAX_ITERATIONS` constant

**Effort:** Tiny

**Dependencies:** None

- [ ] Add: `const MAX_ITERATIONS = 10;` (or appropriate value)
- [ ] Replace numeric literal with constant reference

---

### 18. Implement Logging Framework
**Throughout codebase**

**What:** Replace direct `console.log/error/warn` calls with structured logging library

**Effort:** Large

**Dependencies:** None

- [ ] Choose logging library (winston, pino, etc.)
- [ ] Create logger wrapper with levels (debug, info, warn, error)
- [ ] Replace all `console.*` calls throughout codebase

---

### 19. Add Unit Tests
**Project-wide**

**What:** Create test coverage for core functionality

**Effort:** Large

**Dependencies:** None

- [ ] Set up test framework (Jest, Vitest)
- [ ] Add tests for: LLM module, CLI parsing, Finance tool, Registry validation
- [ ] Aim for >70% coverage on critical paths

---

### 20. Add YAML Schema References
**All YAML files**

**What:** Add `$schema` references for IDE support and validation

**Effort:** Small

**Dependencies:** None

- [ ] Identify schema location (local or remote)
- [ ] Add `#$schema: https://json-schema.org/...` to each YAML file
- [ ] Verify IDE picks up schema validation

---

## Execution Order Summary

| Phase | Items | Focus |
|-------|-------|-------|
| 1 | #1 | Fix broken exports (unblocks runtime) |
| 2 | #2, #3, #5 | Fix model names and type safety |
| 3 | #4 | Remove duplicate code |
| 4 | #6 | Address stub implementation |
| 5 | #7-#9 | Quick cleanup items |
| 6 | #10-#13 | Error handling improvements |
| 7 | #14-#20 | Future enhancements |

**Total:** 20 items (6 critical, 7 minor, 7 nice-to-have)
