# Memory System

Summon includes a powerful long-term memory system that learns from user interactions, preferences, and feedback to continuously improve agent performance.

## Overview

The memory system stores:
- **Interaction History**: Summarized past conversations
- **Learned Preferences**: What formats and styles work best
- **Training Patterns**: Common failures and successful modifications
- **Ritual Effectiveness**: Which configurations work for specific rituals

## Quick Start

```bash
# View memory summary
summon memory show

# See recent interactions
summon memory interactions --limit 20

# View learned patterns
summon memory patterns
```

## Memory Structure

### 1. User Identity

```typescript
interface UserMemory {
  userId: string;
  createdAt: string;
  updatedAt: string;
}
```

### 2. Learned Preferences

```typescript
interface LearnedPreferences {
  style: {
    response_length?: 'concise' | 'detailed' | 'exhaustive';
    tone?: 'formal' | 'casual' | 'professional';
    reasoning?: 'hidden' | 'brief' | 'thorough';
  };
  format: {
    use_tables?: boolean;
    use_bullets?: boolean;
    include_sources?: boolean;
  };
  preferredModels: string[];
  preferredTools: string[];
  avoidedTools: string[];
}
```

Learned from:
- Explicit user ratings
- Feedback text analysis
- Output characteristics of high-rated responses

### 3. Training Patterns

```typescript
interface TrainingPattern {
  pattern: string;           // e.g., "often misses web search"
  type: 'success' | 'failure' | 'preference';
  count: number;            // How many times observed
  firstSeen: string;
  lastSeen: string;
  examples: string[];       // Example ritual IDs
}
```

### 4. Ritual Overrides

```typescript
interface RitualPreferenceOverride {
  ritualId: string;
  modelPreference?: string;
  temperatureOverride?: number;
  maxIterationsOverride?: number;
  customInstructions?: string;
  effectivePromptAdditions: string[];
}
```

### 5. Interaction History

```typescript
interface SummarizedInteraction {
  id: string;
  timestamp: string;
  query: string;
  summary: string;
  tags: string[];
  ritualId?: string;
  success: boolean;
  rating?: number;
  tokensUsed: number;
  cost: number;
}
```

## How Memory Works

### Recording Interactions

Every agent interaction is summarized and stored:

```typescript
import { getUserMemoryManager } from 'summon';

const memory = getUserMemoryManager('user-id');

memory.recordInteraction({
  timestamp: new Date().toISOString(),
  query: "Analyze AAPL stock",
  summary: "Provided stock analysis with recommendations",
  ritualId: "financial-analyst",
  success: true,
  rating: 5,
  tokensUsed: 1500,
  cost: 0.05,
});
```

### Learning from Ratings

```typescript
// When user rates an interaction
memory.learnFromRating('financial-analyst', 5, "Great analysis, loved the tables!");

// System learns:
// - User prefers detailed responses (rating 5)
// - User likes tables (feedback mentions)
// - This pattern for financial-analyst works well
```

### Pattern Recognition

```typescript
// Recording patterns
memory.recordPattern('misses_web_search', 'failure', 'ritual-123');
memory.recordPattern('prefers_concise', 'preference', 'ritual-456');

// Retrieving
const failures = memory.getCommonFailures(5);
// ["misses_web_search", "insufficient_sources", ...]
```

## CLI Commands

### `summon memory show`

Display memory summary.

```bash
summon memory show
summon memory show --json
```

Output:
```
🧠 User Memory
   User ID: default
   Created: 2026-02-15T10:00:00Z
   Updated: 2026-02-15T14:30:00Z

📊 Stats:
   Total Interactions: 150
   Total Sessions: 45
   Total Tokens: 245,000
   Total Cost: $12.50
   Avg Rating: 4.2/5

💡 Learned Preferences:
   Style Length: concise
   Style Tone: professional
   Preferred Models: claude-sonnet-4

📈 Patterns:
   ✓ high_user_rating (23x)
   ✗ often_misses_web_search (5x)
   💡 prefers_sources (12x)
```

### `summon memory interactions`

View recent interactions.

```bash
summon memory interactions
summon memory interactions --limit 50
```

Output:
```
💬 Recent Interactions (10):

[2/15/2026] ✓ ★5 Analyze AAPL stock for next week
    → Provided bullish outlook with price targets
    Tags: financial, stocks, analysis

[2/15/2026] ✓ ★4 Explain React hooks
    → Comprehensive guide with examples
    Tags: coding, react, education
```

### `summon memory patterns`

View learned patterns.

```bash
summon memory patterns
```

Output:
```
📈 Learned Patterns

⚠️  Failure Patterns:
   misses_web_search (5x)
      Example: ritual-123
   insufficient_sources (3x)
      Example: ritual-456

✓ Success Patterns:
   includes_examples (8x)
   uses_tables (6x)

💡 User Preferences:
   prefers_concise (12x)
   likes_code_comments (5x)
```

### `summon memory clear`

Clear all memory (irreversible).

```bash
summon memory clear --confirm
```

## Programmatic Usage

### Basic Usage

```typescript
import { getUserMemoryManager } from 'summon';

const memory = getUserMemoryManager('user-123');

// Start a new session
memory.startSession();

// Record an interaction
memory.recordInteraction({
  timestamp: new Date().toISOString(),
  query: userQuery,
  summary: responseSummary,
  ritualId: 'code-reviewer',
  success: true,
  rating: 4,
  tokensUsed: 1200,
  cost: 0.04,
});

// Get context for a ritual
const context = memory.getRitualContext('code-reviewer');
console.log(context);
// Previous instructions that worked well: Be thorough with edge cases
// Successful modifications for this ritual:
//   - Add line numbers (85% success)
// Watch out for these common issues:
//   - misses_web_search
```

### Learning Loop

```typescript
// After user rates an interaction
async function handleUserRating(
  ritualId: string, 
  rating: number, 
  feedback?: string
) {
  const memory = getUserMemoryManager();
  
  // Learn from the rating
  memory.learnFromRating(ritualId, rating, feedback);
  
  // Auto-save
  memory.autoSave();
}
```

### Search Interactions

```typescript
const memory = getUserMemoryManager();

// Search by query
const results = memory.searchInteractions('stock analysis');

// Get successful modifications
const mods = memory.getSuccessfulModsForRitual('financial-analyst');
```

### Ritual Context Injection

```typescript
import { getUserMemoryManager, preferencesToSystemPrompt } from 'summon';

function buildEnhancedPrompt(ritualId: string, basePrompt: string): string {
  const memory = getUserMemoryManager();
  
  // Get learned context
  const ritualContext = memory.getRitualContext(ritualId);
  
  // Combine with base prompt
  return `${basePrompt}

${ritualContext}`;
}
```

## Memory in Summon Academy

### Training Memory

Summon Academy uses memory to improve training:

```typescript
import { getMemoryIntegrationManager } from 'summon-academy';

const memory = getMemoryIntegrationManager('user-123');

// Record a training run
memory.recordTrainingRun({
  timestamp: new Date().toISOString(),
  ritualId: 'code-reviewer',
  success: true,
  issues: ['slow_response'],
  improvements: ['added_caching'],
  rating: 4,
  metadata: {
    duration: 45000,
    iterations: 3,
    cost: 0.15,
  },
});

// Get context before training
const context = memory.getContextForTraining('code-reviewer');
// Ritual Performance:
//   - Success rate: 85%
//   - Avg rating: 4.2/5
//   - Total runs: 12
//
// Common issues to watch for:
//   - slow_response (Solution: added caching works well)
```

### Issue Database

```typescript
// Get suggestions for known issues
const suggestions = memory.getSuggestionsForIssue('slow_response');
// [
//   { solution: "Add result caching", successRate: 0.9, appliedCount: 5 },
//   { solution: "Reduce max iterations", successRate: 0.7, appliedCount: 3 }
// ]
```

## Best Practices

### 1. Regular Review

```bash
# Weekly review
summon memory patterns
summon observability summary
```

### 2. Start Fresh When Needed

```bash
# If memory seems off
summon memory clear --confirm
# Or reset preferences
summon preferences reset --confirm
```

### 3. Export for Analysis

```typescript
const memory = getUserMemoryManager();
const data = memory.getMemory();

// Analyze patterns
const avgRating = data.stats.averageRating;
const commonIssues = memory.getCommonFailures(10);
```

### 4. Privacy Considerations

- Memory is stored locally in `~/.openclaw/`
- Interactions are summarized (not full content)
- User can clear at any time
- No cloud sync by default

## Storage Location

```
~/.openclaw/
├── preferences.yaml       # User preferences
├── user-memory.json       # Long-term memory
└── ab-tests/              # A/B test data
    ├── test-123.yaml
    └── assignments.json
```

## Integration Flow

```
User Query
    ↓
Load Preferences ──→ Inject into System Prompt
    ↓
Load Memory ───────→ Add Ritual Context
    ↓
Run Agent ←────────── Guardrails Check
    ↓
Record Result ─────→ Update Memory
    ↓
Auto-Save
```

## Troubleshooting

### Memory not updating

```bash
# Check write permissions
ls -la ~/.openclaw/

# Verify memory structure
summon memory show --json | head -20
```

### Wrong ritual context

```typescript
// Check ritual overrides
const overrides = memory.getRitualOverrides('ritual-id');
console.log(overrides);

// Clear specific ritual memory
// (Edit ~/.openclaw/user-memory.json)
```

### Too much memory usage

```bash
# Check file size
ls -lh ~/.openclaw/user-memory.json

# Clear if too large
summon memory clear --confirm
```

## See Also

- [Preferences Guide](./PREFERENCES_GUIDE.md) - User preference profiles
- [Guardrails Reference](./GUARDRAILS_REFERENCE.md) - Safety controls
- [A/B Testing Guide](./AB_TESTING_GUIDE.md) - Test configurations
