# Test script to see what the coordinator outputs
import { ComposedAgent } from './src/components/composed-agent.js';
import { composeAgent } from './src/components/composer.js';
import { createComponentRegistry, loadAgentComposition, resolvePath } from './src/components/registry.js';

const coordinatorSpec = {
  name: 'coordinator',
  systemPrompt: `You are the Master Coordinator for a multi-agent greeting team.

## Coordinator Planning Contract (STRICT)

You are the **Coordinator** for a multi-agent run.

You MUST output a plan as STRICT JSON (no prose).
Prefer wrapping in a \`\`\`json code block.

Schema:
{
  "run": ["agentId", ...],
  "pattern": "parallel" | "sequential",
  "final": "agentId" | null,
  "handoffs": [{"from": "a", "to": "b"}]
}

Rules:
- Use only agentIds from this team: coordinator, composer, emoji-curator, translator, formatter
- "run" must NOT include yourself (coordinator).
- If you choose "final", it must be one of the agentIds (not yourself).
- Keep "handoffs" empty unless you are certain.
- If unsure, choose a minimal safe plan: {"run": ["composer"], "pattern": "parallel", "final": null, "handoffs": []}
`,
  tools: [],
  model: 'gpt-4o',
  maxIterations: 5,
};

async function test() {
  const agent = ComposedAgent.create(coordinatorSpec);
  
  for await (const event of agent.run('Create an epic greeting for a space enthusiast')) {
    console.log('Event:', JSON.stringify(event, null, 2));
  }
}

test().catch(console.error);
