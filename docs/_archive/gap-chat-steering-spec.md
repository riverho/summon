# Gap Chat Steering Mode - Specification

## Clarification: Gap Chat is Training, Not Just Logging

**Original misunderstanding:** Gap Chat = execution transparency (logging)
**Correct understanding:** Gap Chat = human steering + training + adaptation

## Three Modes of Operation

### Mode 1: Autonomous (Default)
System runs training loops automatically without human intervention.
```
User: summon run @river/stock-checker --symbol AAPL
System: [runs autonomously]
       [collects traces]
       [no human input needed]
```

### Mode 2: Review (Post-Hoc)
Human examines execution traces after N runs to evaluate quality.
```
User: summon review @river/stock-checker
System: [shows last 5 execution traces]
       [highlights reasoning paths]
       [flags potential issues]
User: [reviews, provides feedback for future runs]
```

### Mode 3: Gap Chat Steering (Interactive)
Human actively shapes the agent's behavior through the Gap Chat interface.
```
User: summon run @river/stock-checker --symbol AAPL --interactive
System: [executes first pass]
Gap Chat: [opens with execution trace]
User: "Apply first principles thinking - break down revenue drivers before valuation"
System: [adapts reasoning framework]
        [continues with adjusted approach]
```

## Gap Chat Steering Inputs

Human can set:

1. **Framework Preference**
   - First principles thinking
   - Bayesian reasoning
   - Comparative analysis
   - Red team/blue team analysis
   - Custom methodology

2. **Reflection Points**
   - When to pause and verify
   - What to double-check
   - Confidence thresholds

3. **Output Style**
   - Length (concise vs detailed)
   - Format (bullet points vs narrative)
   - Tone (analytical vs conversational)

4. **Conditional Logic**
   - When to ask for clarification
   - When to provide multiple scenarios
   - When to flag uncertainty

5. **Judgment Calibration**
   - Risk tolerance
   - Evidence thresholds
   - Action triggers

## Adaptation Mechanism

### Short-term (Current Session)
Gap Chat feedback immediately affects subsequent execution steps.

### Medium-term (Next Runs)
Feedback stored in ritual configuration as "steering preferences."
```yaml
# ritual.yaml
steering_preferences:
  framework: "first_principles"
  reflection_points:
    - "before_valuation"
    - "after_revenue_analysis"
  output_style:
    length: "detailed"
    format: "structured"
```

### Long-term (Training Data)
Gap Chat sessions feed into refiner for ritual improvement.

## Implementation Requirements

### 1. Execution Modes
Runtime must support:
- `--autonomous` (default, no human input)
- `--interactive` (Gap Chat steering enabled)
- `--review` (post-hoc analysis)

### 2. Checkpoint System
Runtime must create checkpoints where human can intervene:
```typescript
interface ExecutionCheckpoint {
  step: string;           // e.g., "after_data_collection"
  state: ExecutionState;  // Current execution state
  canSteer: boolean;      // Can human intervene here?
  defaultAction: string;  // What system does if no input
}
```

### 3. Steering Protocol
Gap Chat messages can include:
- `SET_FRAMEWORK: <framework_name>`
- `SET_REFLECTION_POINT: <step_name>`
- `ADJUST_STYLE: <style_config>`
- `CONTINUE` (proceed with current settings)
- `RETRY` (re-run with new settings)

### 4. Preference Persistence
Steering preferences stored in:
- `~/.summon/preferences/{ritualId}.yaml` (user-specific)
- Ritual's `steering_preferences` field (shared)

## Files to Modify

1. `src/runtime/engine.ts` - Add checkpoint system, steering hooks
2. `src/runtime/context.ts` - Add steering preferences to context
3. `src/gap-chat/` - New module for steering protocol
4. `src/cli/commands/run.ts` - Add --interactive flag
5. `src/ritual/types.ts` - Add steering_preferences field

## Acceptance Criteria

1. `summon run @river/stock-checker --interactive` opens Gap Chat
2. User can type framework preferences mid-execution
3. System adapts subsequent steps based on input
4. Preferences persist across sessions
5. `summon review @river/stock-checker` shows traces for post-hoc analysis
