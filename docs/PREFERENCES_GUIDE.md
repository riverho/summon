# User Preferences Guide

The Summon framework now supports **User Preference Profiles** - a powerful system that allows agents to adapt to individual users rather than using one-size-fits-all configurations.

## Overview

Every user has a `preferences.yaml` file stored in `~/.openclaw/preferences.yaml`. This file customizes how agents behave specifically for YOU.

## Quick Start

```bash
# View current preferences
summon preferences show

# Set your name
summon preferences set --name "River"

# Prefer concise answers
summon preferences set --style concise

# Require sources in responses
summon preferences set --sources

# Set cost limits
summon preferences set --max-cost 1.00 --max-time 10
```

## Preference Categories

### 1. User Identity

```yaml
user:
  name: "River"
  email: "river@example.com"
```

- **name**: How agents should address you
- **email**: Optional contact for notifications

### 2. Response Style

```yaml
style:
  response_length: concise    # concise | detailed | exhaustive
  tone: professional          # formal | casual | professional
  reasoning: brief            # hidden | brief | thorough
```

| Setting | Options | Effect |
|---------|---------|--------|
| `response_length` | `concise` | Short, to-the-point answers |
| | `detailed` | Comprehensive explanations |
| | `exhaustive` | Leave no stone unturned |
| `tone` | `formal` | Professional, structured |
| | `casual` | Friendly, conversational |
| | `professional` | Business-appropriate |
| `reasoning` | `hidden` | Just the answer |
| | `brief` | Quick explanation |
| | `thorough` | Show full thought process |

### 3. Formatting Preferences

```yaml
format:
  use_tables: true
  use_bullets: true
  include_sources: true
  code_style: commented       # minimal | commented | explained
```

- **use_tables**: Present data in tables where appropriate
- **use_bullets**: Use bullet points for lists
- **include_sources**: Cite sources and references
- **code_style**: How code should be presented

### 4. Safety Settings

```yaml
safety:
  max_cost_per_run: 0.50      # USD
  max_time_per_run: 5         # minutes
  allowed_tools: [web-search, file-reader]
  blocked_topics: [medical_advice, legal_counsel]
```

- **max_cost_per_run**: Hard limit on spending per request
- **max_time_per_run**: Maximum execution time
- **allowed_tools**: Whitelist of permitted tools
- **blocked_topics**: Topics agents should avoid

### 5. Learning Preferences

```yaml
learning:
  auto_apply_lessons: true
  preferred_examples: [financial_analyst_v2, code_reviewer_v1]
```

- **auto_apply_lessons**: Allow Summon Academy to learn from your feedback
- **preferred_examples**: Rituals that work well for you

## CLI Commands

### `summon preferences show`

Display current preferences in a readable format.

```bash
summon preferences show
summon preferences show --json  # For scripting
```

### `summon preferences set`

Update specific preferences.

```bash
# Style preferences
summon preferences set --style concise
summon preferences set --tone casual
summon preferences set --reasoning thorough

# Format preferences
summon preferences set --tables
summon preferences set --no-bullets
summon preferences set --sources

# Safety preferences  
summon preferences set --max-cost 2.00
summon preferences set --max-time 15

# Set multiple at once
summon preferences set --name "River" --style concise --sources
```

### `summon preferences reset`

Reset to default preferences.

```bash
summon preferences reset --confirm
```

### `summon preferences validate`

Check if your preferences file is valid.

```bash
summon preferences validate
```

### `summon preferences export`

Export preferences as YAML.

```bash
summon preferences export > my-preferences.yaml
```

## How Preferences Affect Agents

### System Prompt Injection

Your preferences are automatically injected into the system prompt:

```
# User Preferences
Name: River

## Response Style
- Length: concise
- Tone: professional
- Show reasoning: brief

## Formatting
- Use tables where appropriate
- Use bullet points for lists
- Include sources when available
- Code style: commented
```

### Ritual Overrides

You can override preferences for specific rituals:

```yaml
ritual_overrides:
  financial-analyst:
    style:
      response_length: exhaustive
    format:
      include_sources: true
  
  code-reviewer:
    style:
      tone: casual
    format:
      code_style: explained
```

Use the Summon Academy TUI to set these overrides interactively.

## Examples

### Example 1: Executive Summary Style

For busy executives who want quick answers:

```bash
summon preferences set --name "CEO" \
  --style concise \
  --tone professional \
  --reasoning hidden \
  --tables \
  --sources
```

### Example 2: Developer Deep Dive

For developers who want thorough explanations:

```bash
summon preferences set --name "Dev" \
  --style exhaustive \
  --tone casual \
  --reasoning thorough \
  --bullets \
  --sources
```

### Example 3: Budget-Conscious User

For users who want to minimize costs:

```bash
summon preferences set --max-cost 0.25 \
  --max-time 2 \
  --style concise
```

## Best Practices

1. **Start with defaults**: The defaults work well for most users
2. **Adjust gradually**: Change one setting at a time
3. **Use ritual overrides**: Keep general preferences simple, override for specific use cases
4. **Monitor costs**: Set realistic cost and time limits
5. **Review periodically**: Preferences can be learned and refined over time

## Integration with Summon Academy

When you rate agent outputs in Summon Academy:

1. High ratings reinforce your current preferences
2. Low ratings trigger preference adjustments
3. The system learns which formats work best for you
4. Recommendations are generated for ritual improvements

## Troubleshooting

### Preferences not being applied

1. Check file location: `cat ~/.openclaw/preferences.yaml`
2. Validate: `summon preferences validate`
3. Restart your session

### Invalid preference values

```bash
summon preferences validate
# Fix any reported errors
summon preferences reset --confirm
# Then re-apply your preferences
```

### Too restrictive

If agents can't complete tasks:

```bash
# Check your safety settings
summon preferences show
# Consider relaxing limits
summon preferences set --max-cost 1.00 --max-time 10
```

## See Also

- [Guardrails Reference](./GUARDRAILS_REFERENCE.md) - Safety and quality controls
- [Memory System](./MEMORY_SYSTEM.md) - Long-term learning
- [A/B Testing Guide](./AB_TESTING_GUIDE.md) - Test different configurations
