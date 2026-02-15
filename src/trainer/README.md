# Agent Trainer — Decision Point System

Async decision-point messaging for agent training sessions. Instead of real-time monitoring, humans can review and chat at specific decision points whenever they're available.

## Core Concept

```
Session runs → Pattern detected → Decision point created
                                      ↓
Human opens point later ← Chat thread ← Robot message queued
                                      ↓
                            Decision recorded → Session continues
```

## Storage Structure

```
~/.summon_mem/decisions/
├── {sessionId}/
│   ├── manifest.json              # List of decision point IDs
│   ├── {pointId}.json            # Decision point data
│   └── {pointId}.chat.jsonl      # Chat messages (newline-delimited JSON)
```

## Usage

### CLI Commands

```bash
# List all pending decisions
summon trainer decisions list --pending

# Filter by session
summon trainer decisions list --session my-session-123

# Chat interactively with a decision point
summon trainer decisions chat abc123def

# Send single message
summon trainer decisions chat abc123def -m "Switch to Claude"

# Resolve with action
summon trainer decisions resolve abc123def --action "switch-agent"

# Dismiss without resolving
summon trainer decisions dismiss abc123def --reason "false positive"
```

### Programmatic API

```typescript
import {
  createDecisionPoint,
  appendChatMessage,
  resolveDecisionPoint,
  listDecisionPoints,
  runAllDetectors,
} from './trainer';

// Auto-detect patterns in session
const session = {
  id: 'my-session',
  rounds: [...],
  config: { maxRetries: 3 }
};

const detections = runAllDetectors(session);

// Create decision points from detections
for (const detection of detections) {
  if (detection.detected) {
    const point = createDecisionPoint(session.id, currentRound, {
      type: detection.type!,
      trigger: detection.trigger!,
      robotMessage: {
        content: detection.message!,
        suggestedActions: detection.suggestedActions || [],
        timestamp: new Date(),
      },
      context: {
        sessionId: session.id,
        roundNumber: currentRound,
        agentName: 'codex',
      },
    });
    console.log(`Created decision point: ${point.id}`);
  }
}

// Human responds later
appendChatMessage(point.id, {
  id: generateId(),
  sender: 'human',
  content: 'Let\'s try approach B instead',
  timestamp: new Date(),
});

// Resolve the decision
resolveDecisionPoint(point.id, {
  action: 'switch-agent',
  notes: 'Human chose to try claude instead',
  timestamp: new Date(),
  resolvedBy: 'river',
});
```

## Decision Types

| Type | Description |
|------|-------------|
| `gap` | Pattern detected between rounds (quality drop, token spike, etc.) |
| `fork` | Multiple valid paths forward — need direction |
| `failure` | Repeated failures or critical error |
| `milestone` | Significant progress achieved — review opportunity |
| `review` | Explicit request for human review |

## Detection Patterns

The system automatically detects:

1. **Retry Loops** — Same agent failing repeatedly
2. **Quality Decline** — Output quality dropping over rounds
3. **Drop-Offs** — Previous issues not addressed in current round
4. **Token Spikes** — Sudden increase in token usage
5. **Milestones** — Predefined goals reached
6. **Forks** — Multiple valid approaches available

## Decision Point Lifecycle

```
pending → in_review → resolved
   ↓
dismissed
```

- **pending**: Created, waiting for human
- **in_review**: Human opened chat (optional state)
- **resolved**: Human made decision
- **dismissed**: Ignored without resolution

## Chat Thread Format

Each decision point has a chat thread stored as newline-delimited JSON:

```jsonl
{"id":"1","sender":"robot","content":"Pattern detected...","timestamp":"2026-02-14T10:00:00Z"}
{"id":"2","sender":"human","content":"Switch to Claude","timestamp":"2026-02-14T11:30:00Z"}
{"id":"3","sender":"robot","content":"Switching to claude-code...","timestamp":"2026-02-14T11:30:05Z"}
```

## Integration with Agent Orchestrator

When a session hits a decision point:

1. Orchestrator runs detectors after each round
2. If pattern detected, creates decision point
3. Session pauses (optional) or continues with default
4. Human can open decision point via CLI or web UI
5. Chat thread accumulates context
6. Human decision feeds back into orchestrator

## Future: Web UI

The same storage layer will power the web UI:

```
Gap hover → Load decision point → Render chat thread
                                              ↓
                                    Human types response
                                              ↓
                                    Save to .chat.jsonl → Update UI
```

## Files

| File | Purpose |
|------|---------|
| `types.ts` | Interfaces and type definitions |
| `store.ts` | File-based persistence layer |
| `detector.ts` | Pattern detection algorithms |
| `cli.ts` | Commander.js commands |
| `index.ts` | Public API exports |
