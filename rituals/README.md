# Guardrail Example Rituals

This directory contains example rituals demonstrating Task Guardrails in Summon.

## What Are Guardrails?

Guardrails validate agent outputs **before** they are committed to state, preventing bad data from propagating and enabling safe retry loops.

## Examples

### 1. `code-generator-with-guardrails.yaml`
Demonstrates code quality validation:
- **Regex guardrail**: Blocks TODO/FIXME markers
- **Regex guardrail**: Ensures code is in TypeScript fences
- **Function guardrail**: Checks for error handling (warning only)

```bash
summon run "Create a user auth function" --ritual ./code-generator-with-guardrails.yaml
```

### 2. `structured-report-validator.yaml`
Shows JSON schema validation:
- **Schema guardrail**: Validates against JSON schema (title, summary, findings)
- **Regex guardrail**: Ensures JSON is properly fenced

```bash
summon run "Generate a quarterly report" --ritual ./structured-report-validator.yaml
```

### 3. `content-moderator.yaml`
Multi-layer content validation:
- **Regex guardrails**: Required sections, forbidden terms
- **Function guardrail**: Tone check (warning)
- **LLM-judge**: Quality evaluation via criteria
- **Regex guardrail**: Minimum length

```bash
summon run "Review this article for policy compliance" --ritual ./content-moderator.yaml
```

### 4. `api-response-validator.yaml`
API response format validation:
- **Schema guardrail**: Valid JSON object
- **Function guardrails**: Required fields, error structure
- **Regex guardrail**: Status field values
- **Function guardrail**: Size limits (warning)

```bash
summon run "Generate a payment API response" --ritual ./api-response-validator.yaml
```

## Guardrail Types

| Type | Purpose | Example |
|------|---------|---------|
| `schema` | JSON/Zod validation | Validate report structure |
| `regex` | Pattern matching | Block TODOs, check format |
| `function` | Custom validation | Check error handling |
| `llm-judge` | LLM evaluation | Content quality check |

## Configuration Options

```yaml
outputGuardrails:
  - id: my-guardrail
    type: schema  # or regex, function, llm-judge
    description: Human-readable description
    params:
      # Type-specific parameters
    blocking: true  # false = warning only
    retryPolicy:
      maxAttempts: 3
      initialDelayMs: 1000
      backoffMultiplier: 2
      maxDelayMs: 30000
```

## Retry Behavior

When a guardrail fails:
1. If `blocking: true`, the agent retries with error context
2. Exponential backoff between attempts
3. After max attempts, returns `[GUARDRAIL FAILED]` message
4. Events emitted: `guardrail_check`, `guardrail_failed`

## Backward Compatibility

Guardrails are **opt-in**. Existing rituals work unchanged. Add `outputGuardrails:` to enable validation.
