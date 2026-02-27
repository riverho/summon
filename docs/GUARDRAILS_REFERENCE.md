# Guardrails Reference

Summon provides comprehensive guardrails to ensure safe, high-quality, and cost-effective agent execution.

## Overview

Guardrails are policies that control:
- **Content Safety**: What agents can discuss
- **Tool Usage**: Which tools are permitted
- **Cost Control**: Spending limits
- **Quality**: Response standards
- **Time**: Execution timeouts

## Quick Start

```bash
# View current guardrails
summon guardrails check

# Test content against guardrails
summon guardrails test "Your content here"
```

## Guardrail Categories

### 1. Content Policy

Control what content is allowed.

```yaml
guardrails:
  content_policy:
    # Topics to block entirely
    blocked_topics:
      - medical_advice
      - legal_counsel
      - financial_advice
    
    # Require disclaimers for sensitive topics
    require_disclaimers:
      - investment
      - health
      - legal
    
    # Words to ban
    banned_words:
      - guarantee
      - promise
      - always works
    
    # Regex patterns for sensitive content
    sensitive_patterns:
      - pattern: "\d{3}-\d{2}-\d{4}"
        description: "SSN detected"
        severity: error
      - pattern: "\b4\d{15}\b"
        description: "Credit card number detected"
        severity: error
```

### 2. Tool Policy

Control tool usage.

```yaml
guardrails:
  tool_policy:
    # Explicitly allowed tools (empty = all allowed)
    allowed:
      - web-search
      - file-read
      - calculator
    
    # Blocked tools
    blocked:
      - file-delete
      - shell-exec
      - database-drop
    
    # Tools requiring explicit approval
    require_approval:
      - database-write
      - api-post
      - file-write
    
    # Limits
    max_tool_calls_per_run: 50
    max_tool_calls_per_type:
      web-search: 10
      file-read: 20
```

### 3. Cost Policy

Control spending.

```yaml
guardrails:
  cost_policy:
    max_per_run: 0.50        # USD per request
    max_per_day: 5.00        # USD per day
    max_per_month: 50.00     # USD per month
    alert_threshold: 0.25    # Warn at this amount
    currency: USD
```

**Behavior:**
- Exceeding `max_per_run`: Immediate abort
- Exceeding `max_per_day`: Block until next day
- Alert threshold: Warning but allows continuation
- Tracks actual API costs

### 4. Quality Policy

Ensure response quality.

```yaml
guardrails:
  quality_policy:
    min_response_length: 100      # characters
    max_response_length: 2000     # characters
    require_sources: true
    require_code_blocks: false
    ban_words:
      - guarantee
      - always
      - never
      - impossible
    required_sections:
      - summary
```

### 5. Time Policy

Control execution time.

```yaml
guardrails:
  time_policy:
    max_total_time: 300      # 5 minutes (seconds)
    max_tool_time: 30        # per tool call
    max_iteration_time: 60   # per iteration
    pause_after:
      - tool_error
      - high_cost
      - timeout
    auto_abort_after: 300    # seconds of inactivity
```

**Pause Triggers:**
- `tool_error`: Stop for review on tool failure
- `high_cost`: Stop when cost exceeds alert threshold
- `timeout`: Stop on any timeout
- `warning`: Stop on any guardrail warning

## Default Guardrails

Summon applies sensible defaults:

```yaml
guardrails:
  content_policy:
    banned_words: [guarantee, always, never]
  
  cost_policy:
    max_per_run: 0.50
    max_per_day: 5.00
    alert_threshold: 0.25
  
  quality_policy:
    min_response_length: 10
    max_response_length: 10000
    ban_words: [guarantee, always, never]
  
  time_policy:
    max_total_time: 300
    max_tool_time: 30
```

## CLI Commands

### `summon guardrails check`

Display current guardrail configuration.

```bash
summon guardrails check
summon guardrails check --json
```

Output:
```
🛡️  Advanced Guardrails

Content Policy:
   Blocked Topics: medical_advice, legal_counsel
   Banned Words: guarantee, always, never

Tool Policy:
   Allowed: web-search, file-reader, calculator
   Blocked: file-delete, shell-exec
   Max Tool Calls: 50

Cost Policy:
   Max Per Run: $0.50
   Max Per Day: $5.00
   Alert Threshold: $0.25
```

### `summon guardrails test`

Test content against guardrails.

```bash
summon guardrails test "This is a guarantee that this always works"
```

Output:
```
🧪 Guardrail Test Results

Passed: ✗

Warnings:
  ⚠ quality.banned_words: Response contains banned word: "guarantee"
  ⚠ quality.banned_words: Response contains banned word: "always"
```

## Programmatic Usage

### Using the Guardrail Engine

```typescript
import { 
  GuardrailEngine, 
  createGuardrailsFromPreferences,
  loadPreferences 
} from 'summon';

const prefs = loadPreferences();
const guardrails = createGuardrailsFromPreferences(prefs);

const engine = new GuardrailEngine({
  userPreferences: prefs,
  guardrails,
  startTime: Date.now(),
  currentCost: 0,
  dailyCost: 0,
  toolCalls: 0,
  toolCallsByType: {},
});

// Check all guardrails
const result = engine.checkAll();
if (!result.passed) {
  console.error('Guardrail violations:', result.errors);
}

// Check specific content
const contentResult = engine.checkContent(userContent);
if (!contentResult.passed) {
  console.error('Content blocked:', contentResult.errors);
}

// Check response quality
const qualityResult = engine.checkQuality(agentResponse);
if (qualityResult.warnings.length > 0) {
  console.warn('Quality issues:', qualityResult.warnings);
}
```

### Custom Guardrails

```typescript
import { AdvancedGuardrails } from 'summon';

const customGuardrails: AdvancedGuardrails = {
  version: '2.0.0',
  content_policy: {
    blocked_topics: ['politics', 'religion'],
    banned_words: ['specific_term'],
    sensitive_patterns: [
      {
        pattern: 'password:\s*\S+',
        description: 'Password exposed',
        severity: 'error'
      }
    ]
  },
  tool_policy: {
    allowed: ['safe-tool-1', 'safe-tool-2'],
    blocked: ['dangerous-tool'],
    require_approval: ['write-tool'],
    max_tool_calls_per_run: 20
  },
  cost_policy: {
    max_per_run: 0.25,
    max_per_day: 2.00,
    alert_threshold: 0.10
  },
  quality_policy: {
    min_response_length: 50,
    require_sources: true
  },
  time_policy: {
    max_total_time: 120
  },
  emergency_stop_phrases: ['STOP', 'HALT'],
  log_all_violations: true
};
```

## Guardrail Check Results

```typescript
interface GuardrailCheckResult {
  passed: boolean;
  checks: GuardrailCheck[];
  errors: GuardrailCheck[];
  warnings: GuardrailCheck[];
  should_pause: boolean;
  should_abort: boolean;
}

interface GuardrailCheck {
  policy: string;      // 'content' | 'tool' | 'cost' | 'quality' | 'time'
  rule: string;        // specific rule name
  passed: boolean;
  severity: 'info' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
}
```

## Emergency Stop

Users can abort execution with emergency phrases:

```
User: STOP
Agent: [Emergency stop triggered - halting execution]
```

Default phrases: `STOP`, `HALT`, `ABORT`

Configure custom phrases:

```yaml
guardrails:
  emergency_stop_phrases:
    - STOP
    - ABORT
    - CANCEL
    - END SESSION
```

## Integration with Preferences

Guardrails are automatically derived from user preferences:

```yaml
# preferences.yaml
safety:
  max_cost_per_run: 0.50
  max_time_per_run: 5
  allowed_tools: [web-search, calculator]
  blocked_topics: [medical_advice]
```

This automatically creates:
- Cost policy: max_per_run = $0.50
- Time policy: max_total_time = 300s
- Tool policy: allowed = [web-search, calculator]
- Content policy: blocked_topics = [medical_advice]

## Best Practices

### 1. Start Strict, Relax Gradually

```yaml
# Conservative starting point
guardrails:
  cost_policy:
    max_per_run: 0.25
    max_per_day: 2.00
  tool_policy:
    require_approval:
      - all-write-operations
```

### 2. Use Block Lists for Safety

```yaml
content_policy:
  blocked_topics:
    - self_harm
    - illegal_activities
  
tool_policy:
  blocked:
    - delete-permanently
    - execute-arbitrary-code
```

### 3. Set Realistic Cost Limits

```yaml
cost_policy:
  max_per_run: 0.50      # Enough for most tasks
  max_per_day: 5.00      # Prevents runaway costs
  alert_threshold: 0.25  # Early warning
```

### 4. Monitor and Adjust

```bash
# Regular review
summon observability summary
summon guardrails check

# Adjust based on usage patterns
summon preferences set --max-cost 1.00
```

## Troubleshooting

### Tool blocked unexpectedly

```bash
# Check tool policy
summon guardrails check

# Add to allowed list in preferences
summon preferences set --allowed-tools "web-search,file-read,your-tool"
```

### Cost limits too restrictive

```bash
# Current settings
summon guardrails check | grep -A 3 "Cost Policy"

# Increase limits
summon preferences set --max-cost 1.00 --max-time 10
```

### False positives in content blocking

```yaml
# Refine sensitive patterns
guardrails:
  content_policy:
    sensitive_patterns:
      - pattern: "(?!example@)\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
        description: "Email detected (excluding example@)"
```

## Advanced Configuration

### Ritual-Specific Guardrails

```yaml
# In ritual.yaml
name: financial-analyst
guardrails:
  content_policy:
    require_disclaimers:
      - investment
  cost_policy:
    max_per_run: 1.00  # Higher limit for complex analysis
```

### Dynamic Guardrails

```typescript
// Adjust based on user tier
const guardrails = user.tier === 'premium' 
  ? { cost_policy: { max_per_run: 5.00 } }
  : { cost_policy: { max_per_run: 0.50 } };
```

### Custom Validators

```typescript
import { GuardrailEngine } from 'summon';

const engine = new GuardrailEngine(context);

// Add custom check
const customCheck = engine.checkTool('my-tool');
if (customCheck.details?.requires_approval) {
  await getUserApproval();
}
```

## See Also

- [Preferences Guide](./PREFERENCES_GUIDE.md) - User preference profiles
- [Memory System](./MEMORY_SYSTEM.md) - Long-term learning
- [A/B Testing Guide](./AB_TESTING_GUIDE.md) - Test different configurations
