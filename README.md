# Summon

Summon composable agents with portable YAML rituals.

## The Metaphor

- **Ritual** = YAML file (persona + skills + model)
- **Components** = Personas and Skills you combine
- **Summoning** = Running an agent

You write a ritual, then summon the entity!

## Features

- **Portable YAML Rituals**: Single file contains persona + skills + config
- **Composable Architecture**: Mix and match personas and skills
- **Scoped Tool Binding**: Skills declare required tools, only those get bound
- **Built-in Components**: Ready-to-use personas and skills

## Installation

```bash
bun install
bun link      # Makes 'summon' command available globally
```

Or run directly without linking:
```bash
bun run summon --help
```

## Quick Start

### Summon with YAML Ritual

```bash
summon run "Analyze AAPL revenue growth" --ritual ./examples/agents/financial-analyst.yaml
```

### Quick Compose

```bash
summon compose "Analyze AAPL" --persona analyst --skills finance
```

### List Components

```bash
summon components list
summon skills list
summon personas list
```

## YAML Ritual Format

```yaml
name: financial-analyst
version: 1.0.0

persona:
  role: Senior Financial Analyst
  goal: Provide accurate, data-driven financial insights
  backstory: |
    Expert analyst with 15 years in investment research.
  behavior:
    style: professional
    priorities:
      - accuracy
      - data-driven insights
    avoidances:
      - speculation without data

skills:
  - id: finance
    capabilities:
      - Stock prices and historical data
      - Financial metrics
    requiredTools:
      - financial_search
    promptFragment: |
      You can retrieve financial data...

model:
  primary: gpt-5.2
  provider: openai
  maxIterations: 10
```

## Path Resolution

Summon understands special path prefixes:

- `braddy://` → Relative to summon installation folder
- `~/` → Your home directory
- `/absolute/` → Absolute paths
- `./relative/` → Relative to current folder

Example:
```bash
summon run "AAPL price" --ritual braddy://examples/agents/financial-analyst.yaml
```

## Programmatic Usage

```typescript
import {
  createComponentRegistry,
  loadAgentComposition,
  composeAgent,
  ComposedAgent,
  globalToolRegistry,
} from 'summon';

// Register tools first
globalToolRegistry.register({
  name: 'financial_search',
  tool: yourFinancialSearchTool,
  description: 'Search financial data...',
});

// Load and run agent
const composition = loadAgentComposition('./my-ritual.yaml');
const spec = composeAgent(composition);
const agent = ComposedAgent.create(spec);

for await (const event of agent.run('Analyze AAPL')) {
  if (event.type === 'done') {
    console.log(event.answer);
  }
}
```

## Directory Structure

```
summon/
├── src/
│   ├── index.ts              # Main exports
│   ├── components/
│   │   ├── types.ts          # Persona, Skill interfaces
│   │   ├── registry.ts       # YAML discovery & loading
│   │   ├── composer.ts       # Assemble agent from components
│   │   └── composed-agent.ts # Runtime wrapper
│   ├── builtin/
│   │   ├── personas/
│   │   │   ├── analyst.yaml
│   │   │   └── researcher.yaml
│   │   └── skills/
│   │       ├── finance/
│   │       └── web-search/
│   ├── runtime/
│   │   ├── llm.ts            # Model abstraction
│   │   ├── memory.ts         # Memory primitives
│   │   └── tools.ts          # Tool registry
│   └── cli/
│       └── index.ts          # CLI commands
└── examples/
    └── agents/
        └── financial-analyst.yaml
```

## License

MIT
