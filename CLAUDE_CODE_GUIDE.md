# Claude Code Learning Guide

*A reference for Claude Code to learn proper coding patterns from the summon project.*

## The Guardian Agent

Clawdbot (this agent) is your guardian. When you work on summon-related tasks:

1. Clawdbot will provide relevant patterns from this guide
2. Clawdbot will validate your output against quality standards
3. Clawdbot will give feedback for improvement
4. Over time, you'll internalize these patterns

---

## Pattern 1: Error Handling

### Always Use SummonError

```typescript
// ✅ Correct
import { SummonError, fatalError, recoverableError, warning } from './error.js';

throw new SummonError(
  'Query cannot be empty',
  'INVALID_QUERY',
  'fatal'
);

// Or use helpers
fatalError('Query cannot be empty', 'INVALID_QUERY');
recoverableError('Tool failed, retrying', 'TOOL_FAILED');
warning('Unknown model, proceeding', 'UNKNOWN_MODEL');
```

### Error Structure

```typescript
class SummonError extends Error {
  constructor(
    message: string,
    public code: string,
    public severity: 'fatal' | 'recoverable' | 'warning'
  ) {
    super(message);
    this.name = 'SummonError';
  }
}
```

### Log Errors Consistently

```typescript
// ✅ Correct - use logError
import { logError, SummonError } from './error.js';

try {
  // risky operation
} catch (error) {
  if (error instanceof SummonError) {
    logError(error);
  }
}

// ❌ Wrong - inconsistent logging
console.error('Error:', error); // No prefix, inconsistent format
```

---

## Pattern 2: Type Safety

### No `any` Types

```typescript
// ✅ Correct - proper interfaces
interface RunCommandOptions {
  ritual?: string;
  model?: string;
  session?: string;
  sessionAuto?: boolean;
  newSession?: boolean;
  quiet?: boolean;
  json?: boolean;
  verbose?: boolean;
}

// ✅ Correct - use Zod for runtime validation
import { z } from 'zod';

const ChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  query: z.string(),
  answer: z.string().optional(),
  summary: z.string().optional(),
  timestamp: z.string(),
});

// ❌ Wrong - any type
function handleInput(input: any) { /* ... */ }
```

---

## Pattern 3: Session Management

### Use session-helper.ts

```typescript
// ✅ Correct
import { resolveSessionId, sessionExists } from './session-helper.js';

async function handleRun(query: string, options: RunCommandOptions) {
  const sessionId = resolveSessionId(options);
  
  if (sessionId && !(await sessionExists(sessionId))) {
    throw new SummonError(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      'fatal'
    );
  }
  
  // ... continue
}
```

### Session Resolution Logic

The `resolveSessionId()` function handles:
1. `newSession` → undefined (fresh)
2. `session` → explicit session ID
3. `sessionAuto` / `continue` → auto-detect most recent

---

## Pattern 4: Retry Mechanism

### Use withRetry for Transient Failures

```typescript
// ✅ Correct - retry with exponential backoff
import { withRetry } from './composed-agent.js';

async function executeToolWithRetry(
  toolName: string,
  toolArgs: Record<string, unknown>
): Promise<string> {
  return await withRetry(
    () => tool.invoke(toolArgs),
    { maxAttempts: 3, baseDelay: 1000, maxDelay: 5000 }
  );
}

// Retry logic logs each attempt:
// [Retry] Tool failed (attempt 1/3), retrying in 1000ms: ...
```

### When to Use Retry

- ✅ Network calls (LLM APIs, MCP servers)
- ✅ Tool invocations that might timeout
- ✅ File operations with potential race conditions

- ❌ Validation errors (don't retry invalid input)
- ❌ Authentication errors (don't retry bad credentials)

---

## Pattern 5: Input Validation

### Validate Early, Fail Fast

```typescript
// ✅ Correct - validate at entry points
function validateQuery(query: string): void {
  if (!query.trim()) {
    throw new SummonError(
      'Query cannot be empty',
      'INVALID_QUERY',
      'fatal'
    );
  }
}

function validateModel(model: string): void {
  const validModels = ['gpt-4o', 'openrouter/free', 'anthropic/claude-3-5-sonnet'];
  if (!validModels.includes(model)) {
    warning(`Unknown model: ${model}`, 'UNKNOWN_MODEL');
  }
}

// In your action handler:
async function handleRun(query: string, options: RunCommandOptions) {
  validateQuery(query);
  validateModel(options.model);
  // ... rest of logic
}
```

---

## Pattern 6: Zod Validation

### Validate Loaded Data

```typescript
// ✅ Correct - validate parsed JSON
import { z } from 'zod';

const ChatHistorySchema = z.object({
  id: z.string(),
  ritualName: z.string(),
  createdAt: z.string(),
  lastUsed: z.string(),
  messages: z.array(ChatMessageSchema),
});

async function loadSession(filepath: string): Promise<ChatHistory | null> {
  try {
    const data = await fs.readFile(filepath, 'utf-8');
    const parsed = JSON.parse(data);
    
    const result = ChatHistorySchema.safeParse(parsed);
    if (!result.success) {
      console.error(`[Error] Invalid session format: ${result.error.message}`);
      return null;
    }
    
    return result.data;
  } catch (error) {
    console.error(`[ChatHistory] Failed to load: ${filepath}`, error);
    return null;
  }
}
```

---

## Pattern 7: CLI Actions

### Proper TypeScript Types for Options

```typescript
// ✅ Correct - define interface for options
interface RunCommandOptions {
  ritual?: string;
  model?: string;
  session?: string;
  sessionAuto?: boolean;
  newSession?: boolean;
  quiet?: boolean;
  json?: boolean;
  verbose?: boolean;
}

async function handleRun(query: string, options: RunCommandOptions): Promise<void> {
  // TypeScript knows the shape of options
  if (options.verbose) {
    console.log('Verbose mode enabled');
  }
}
```

---

## Quality Checklist

Before submitting code, verify:

- [ ] No `any` types — use proper interfaces
- [ ] Errors use `SummonError` with severity levels
- [ ] Errors logged with `logError()` or consistent prefix
- [ ] Input validated early with proper error messages
- [ ] Transient failures use `withRetry()`
- [ ] Loaded data validated with Zod schemas
- [ ] Tests added for new functionality
- [ ] TypeScript compiles without errors (`bun run tsc --noEmit`)

---

## Learning Progression

### Beginner (You Are Here)
- Follow patterns exactly as documented
- Ask Clawdbot when unsure

### Intermediate
- Adapt patterns to new contexts
- Recognize when patterns need modification
- Propose improvements to the guide

### Advanced
- Identify new patterns to add to the guide
- Refactor existing patterns for clarity
- Mentor other Claude Code instances

---

*Last Updated: 2026-02-02*
*Project: /Users/river/clawd/projects/summon*
