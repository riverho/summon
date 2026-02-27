# A/B Testing Guide

A/B testing allows you to compare different versions of rituals to find what works best for your use case.

## Overview

Test variations of:
- **Persona styles** (cautious vs bold)
- **Tool configurations** (more vs fewer tools)
- **Response formats** (tables vs narrative)
- **Model selections** (fast vs capable)

## Quick Start

```bash
# List active tests
summon ab-test list

# Create a test
summon ab-test create my-ritual \
  --name "Tone Comparison" \
  --control '{"persona": {"style": "cautious"}}' \
  --treatment '{"persona": {"style": "bold"}}' \
  --start

# View results
summon ab-test results test-id

# Promote winner
summon ab-test promote test-id
```

## How A/B Testing Works

### 1. Create Test

Define variants with different configurations:

```yaml
# Test configuration
id: abt_1234567890_abc123
name: "Tone Comparison"
ritualId: financial-analyst
variants:
  - id: control
    name: "Cautious (Current)"
    weight: 0.5
    config:
      persona:
        style: cautious
        instructions: "Be conservative in recommendations"
  
  - id: treatment
    name: "Bold (New)"
    weight: 0.5
    config:
      persona:
        style: bold
        instructions: "Make confident predictions"

metrics:
  - user_rating_avg
  - completion_rate
  - token_efficiency

minSampleSize: 30
```

### 2. User Assignment

Users are automatically assigned to variants:

```typescript
const manager = getABTestManager();
const variant = manager.assignVariant(testId, userId);
// Returns either control or treatment based on weights
```

### 3. Record Outcomes

After each interaction:

```typescript
manager.recordOutcome(testId, variantId, {
  user_rating: 5,
  completion_rate: 1,
  token_efficiency: 0.8,
  cost: 0.05,
});
```

### 4. Analyze Results

Statistical analysis determines the winner:

```typescript
const report = manager.analyzeResults(testId);
// {
//   status: 'running',
//   winner: 'treatment',
//   confidence: 0.87,
//   recommendation: 'Treatment is performing best...'
// }
```

## CLI Commands

### `summon ab-test list`

List all A/B tests.

```bash
summon ab-test list
summon ab-test list --ritual my-ritual
summon ab-test list --json
```

Output:
```
📊 A/B Tests

▶ Tone Comparison
   ID: abt_1234567890_abc123
   Ritual: financial-analyst
   Status: running
   Variants: Cautious (Current) vs Bold (New)
   Assignments: 45

✓ Model Comparison
   ID: abt_0987654321_xyz789
   Ritual: code-reviewer
   Status: completed
   Winner: GPT-4 (92% confidence)
```

### `summon ab-test create`

Create a new test.

```bash
summon ab-test create my-ritual \
  --name "Test Name" \
  --control '{"key": "value"}' \
  --treatment '{"key": "different"}' \
  [--start]
```

Examples:

```bash
# Test persona styles
summon ab-test create financial-analyst \
  --name "Analyst Tone Test" \
  --control '{"persona": {"tone": "conservative"}}' \
  --treatment '{"persona": {"tone": "aggressive"}}' \
  --start

# Test model selection
summon ab-test create code-reviewer \
  --name "Model Comparison" \
  --control '{"model": "gpt-4o-mini"}' \
  --treatment '{"model": "claude-sonnet-4"}' \
  --start

# Test response format
summon ab-test create data-analyzer \
  --name "Format Test" \
  --control '{"format": {"style": "narrative"}}' \
  --treatment '{"format": {"style": "tabular"}}' \
  --start
```

### `summon ab-test start`

Start a test.

```bash
summon ab-test start abt_1234567890_abc123
```

### `summon ab-test pause`

Pause a running test.

```bash
summon ab-test pause abt_1234567890_abc123
```

### `summon ab-test results`

View test results.

```bash
summon ab-test results abt_1234567890_abc123
summon ab-test results abt_1234567890_abc123 --json
```

Output:
```
📊 Test Results: abt_1234567890_abc123
   Status: running

   Variants:

   ○ Cautious (Current)
      Assignments: 23
      Completion Rate: 95.7%
      Avg Rating: 4.1/5
      user_rating: 4.1
      token_efficiency: 0.75

   🏆 Bold (New)
      Assignments: 22
      Completion Rate: 100.0%
      Avg Rating: 4.5/5
      user_rating: 4.5
      token_efficiency: 0.82

   Variant "Bold (New)" is leading but confidence is moderate (87%).
   Continue testing for more samples.
```

### `summon ab-test promote`

Promote the winning variant.

```bash
summon ab-test promote abt_1234567890_abc123
```

This:
1. Analyzes final results
2. Deactivates losing variants
3. Marks test as completed
4. Applies winner to ritual

## Programmatic Usage

### Basic Test Flow

```typescript
import { 
  getABTestManager, 
  createStandardTest 
} from 'summon';

const manager = getABTestManager();

// Create test
const test = createStandardTest(
  'financial-analyst',
  { persona: { style: 'cautious' } },  // control
  { persona: { style: 'bold' } },      // treatment
  'Tone Comparison'
);

// Start test
manager.startTest(test.id);

// Assign user to variant
const variant = manager.assignVariant(test.id, 'user-123');

// Use variant config
const config = variant.config;
```

### Recording Results

```typescript
// After user rates the interaction
manager.recordOutcome(
  testId,
  variantId,
  {
    user_rating: 5,
    completion_rate: 1,
    token_efficiency: 0.8,
    response_time: 2.5,
    cost: 0.05,
  },
  true,  // success
  5      // user rating
);
```

### Analysis

```typescript
const report = manager.analyzeResults(testId);

console.log(`Status: ${report.status}`);
console.log(`Winner: ${report.winner}`);
console.log(`Confidence: ${report.confidence}`);
console.log(`Recommendation: ${report.recommendation}`);

// Variant details
for (const variant of report.variants) {
  console.log(`${variant.name}:`);
  console.log(`  Assignments: ${variant.assignments}`);
  console.log(`  Completion Rate: ${variant.completionRate}`);
  console.log(`  Avg Rating: ${variant.averageRating}`);
}
```

### Promoting Winner

```typescript
const result = await manager.promoteWinner(testId);

if (result.success) {
  console.log(result.message);
  // "Promoted "Bold (New)" as the winner"
} else {
  console.error(result.message);
}
```

## Test Metrics

Default metrics tracked:

| Metric | Type | Higher is Better |
|--------|------|------------------|
| `user_rating` | Average | Yes |
| `completion_rate` | Rate | Yes |
| `token_efficiency` | Average | Yes |
| `response_time` | Duration | No |
| `cost` | Average | No |

Custom metrics:

```typescript
const test = manager.createTest({
  name: "Custom Test",
  ritualId: "my-ritual",
  variants: [...],
  metrics: [
    { name: 'accuracy', type: 'rate', higherIsBetter: true },
    { name: 'helpfulness', type: 'average', higherIsBetter: true },
  ],
});
```

## Allocation Strategies

### Random (Default)

```typescript
allocation: 'random'
// Users randomly assigned based on variant weights
```

### Sequential

```typescript
allocation: 'sequential'
// Round-robin assignment (good for controlled testing)
```

### User-Segmented

```typescript
allocation: 'user-segmented'
// Same user always gets same variant (consistent experience)
```

## Test Configuration Options

```typescript
interface ABTestConfig {
  id: string;
  name: string;
  ritualId: string;
  variants: TestVariant[];
  metrics: TestMetric[];
  
  // Sample size
  minSampleSize: number;      // Minimum samples per variant
  maxSampleSize?: number;     // Optional maximum
  
  // Duration
  maxDuration?: number;       // Maximum days to run
  
  // Auto-actions
  autoPromote: boolean;       // Auto-promote winner
  stopOnSignificance: boolean; // Stop early if clear winner
}
```

## Best Practices

### 1. Test One Thing at a Time

```bash
# Good: Test only tone
summon ab-test create ritual \
  --control '{"persona": {"tone": "formal"}}' \
  --treatment '{"persona": {"tone": "casual"}}'

# Bad: Testing multiple changes
summon ab-test create ritual \
  --control '{"persona": {"tone": "formal"}, "model": "gpt-4"}' \
  --treatment '{"persona": {"tone": "casual"}, "model": "claude"}'
```

### 2. Set Appropriate Sample Sizes

```typescript
// For user ratings (high variance)
minSampleSize: 50

// For completion rates (binary)
minSampleSize: 100

// For quick tests
minSampleSize: 20
```

### 3. Run Long Enough

```bash
# Check progress regularly
summon ab-test results test-id

# Wait for confidence > 90% before promoting
```

### 4. Document Your Tests

```yaml
name: "Q1 2026 Tone Test"
description: |
  Testing whether users prefer cautious or bold
  recommendations in financial analysis.
  
  Hypothesis: Bold recommendations get higher
  ratings but may have lower trust scores.
  
  Started: 2026-02-01
  Expected end: 2026-02-15
```

## Common Test Scenarios

### Scenario 1: Model Comparison

```bash
summon ab-test create my-ritual \
  --name "GPT-4 vs Claude" \
  --control '{"model": "gpt-4o"}' \
  --treatment '{"model": "claude-sonnet-4"}' \
  --start
```

### Scenario 2: Response Length

```bash
summon ab-test create my-ritual \
  --name "Concise vs Detailed" \
  --control '{"persona": {"instructions": "Be concise"}}' \
  --treatment '{"persona": {"instructions": "Be detailed and thorough"}}' \
  --start
```

### Scenario 3: Tool Selection

```bash
summon ab-test create my-ritual \
  --name "Tool Set Comparison" \
  --control '{"tools": ["web-search"]}' \
  --treatment '{"tools": ["web-search", "calculator", "news-api"]}' \
  --start
```

### Scenario 4: Prompt Engineering

```bash
summon ab-test create my-ritual \
  --name "Prompt A vs B" \
  --control '{"persona": {"basePrompt": "You are a helpful assistant."}}' \
  --treatment '{"persona": {"basePrompt": "You are an expert analyst with 20 years experience."}}' \
  --start
```

## Advanced: Summon Academy Integration

```typescript
import { 
  createRitualComparisonTest,
  ABTestTrainer 
} from 'summon-academy';

// Create trainer
const config = createRitualComparisonTest(
  'financial-analyst',
  controlConfig,
  treatmentConfig,
  'Tone Test'
);

const trainer = createABTestTrainer(config);

// During training
const variant = trainer.getVariantForUser('user-123');

// Record training result
trainer.recordResult('user-123', {
  variantId: variant.id,
  metrics: {
    user_rating: 5,
    success: 1,
    duration: 45,
    cost: 0.05,
  },
  rating: 5,
  success: true,
});

// Check if we should stop early
const { stop, reason } = trainer.shouldStopEarly();
if (stop) {
  console.log(`Stopping early: ${reason}`);
}

// Get results
const results = trainer.analyzeResults();
```

## Troubleshooting

### Not enough samples

```bash
# Check progress
summon ab-test results test-id

# Wait longer or reduce minSampleSize
```

### No clear winner

```bash
# Check if variants are actually different
# Increase minSampleSize for more statistical power
# Consider testing more dramatic changes
```

### Users confused by variations

```bash
# Use user-segmented allocation
# Add description explaining the test
# Keep test duration short
```

## Storage

Tests are stored in:

```
~/.openclaw/ab-tests/
├── test-123.yaml      # Test configuration
├── test-456.yaml
└── assignments.json   # User assignments
```

## See Also

- [Preferences Guide](./PREFERENCES_GUIDE.md) - User preferences
- [Guardrails Reference](./GUARDRAILS_REFERENCE.md) - Safety controls
- [Memory System](./MEMORY_SYSTEM.md) - Long-term learning
