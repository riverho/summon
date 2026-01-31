import { StructuredToolInterface } from '@langchain/core/tools';
import {
  AgentComposition,
  Persona,
  Skill,
  ComponentRegistry,
} from './types.js';
import { globalToolRegistry, RegisteredTool } from '../runtime/tools.js';

// ============================================================================
// System Prompt Building
// ============================================================================

/**
 * Get the current date formatted for prompts
 */
function getCurrentDate(): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  return new Date().toLocaleDateString('en-US', options);
}

/**
 * Build the persona section of the system prompt
 */
function buildPersonaPrompt(persona: Persona): string {
  const { role, goal, backstory, behavior } = persona;

  const behaviorSection = behavior
    ? `
## Behavior

Style: ${behavior.style || 'professional'}

${behavior.priorities?.length ? `Priorities:\n${behavior.priorities.map(p => `- ${p}`).join('\n')}` : ''}

${behavior.avoidances?.length ? `Avoid:\n${behavior.avoidances.map(a => `- ${a}`).join('\n')}` : ''}

${behavior.responseFormat?.useTables !== undefined ? `Use tables: ${behavior.responseFormat.useTables}` : ''}
${behavior.responseFormat?.maxLength ? `Max response length: ${behavior.responseFormat.maxLength} characters` : ''}
`.trim()
    : '';

  return `You are a ${role}.

Goal: ${goal}

Background: ${backstory}

${behaviorSection}`.trim();
}

/**
 * Build the skills section of the system prompt
 */
function buildSkillsPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const skillSections = skills.map(skill => {
    const capabilitiesStr = skill.capabilities
      .map(c => `- ${c}`)
      .join('\n');

    return `### ${skill.name || skill.id}

Capabilities:
${capabilitiesStr}

${skill.promptFragment}`;
  });

  return `## Skills

${skillSections.join('\n\n')}`;
}

/**
 * Build the tool descriptions section from bound tools
 */
function buildToolDescriptionsPrompt(tools: RegisteredTool[]): string {
  if (tools.length === 0) {
    return '';
  }

  return `## Available Tools

${tools.map(t => `### ${t.name}\n\n${t.description}`).join('\n\n')}`;
}

/**
 * Build the complete system prompt for a composed agent
 */
export function buildSystemPrompt(
  persona: Persona,
  skills: Skill[],
  boundTools: RegisteredTool[]
): string {
  const personaPrompt = buildPersonaPrompt(persona);
  const skillsPrompt = buildSkillsPrompt(skills);
  const toolsPrompt = buildToolDescriptionsPrompt(boundTools);

  return `${personaPrompt}

Current date: ${getCurrentDate()}

${skillsPrompt}

${toolsPrompt}

## Tool Usage Policy

- Only use tools when the query actually requires external data
- If a query can be answered from general knowledge, respond directly without using tools
- Call tools ONCE with the full natural language query - they handle complexity internally
- Do NOT break up queries into multiple tool calls when one call can handle the request

## Response Format

- Keep responses concise and direct
- Use tables for comparative data
- Do not use markdown headers or *italics* - use **bold** sparingly for emphasis

## Tables (for comparative/tabular data)

Use markdown tables. They will be rendered as formatted box tables.

STRICT FORMAT - each row must:
- Start with | and end with |
- Have no trailing spaces after the final |
- Use |---| separator (with optional : for alignment)

| Ticker | Rev    | OM  |
|--------|--------|-----|
| AAPL   | 416.2B | 31% |

Keep tables compact with abbreviated headers.`.trim();
}

// ============================================================================
// Tool Binding
// ============================================================================

/**
 * Get all required tools from skills
 */
export function getRequiredTools(skills: Skill[]): string[] {
  const toolNames = new Set<string>();

  for (const skill of skills) {
    for (const tool of skill.requiredTools) {
      toolNames.add(tool);
    }
    if (skill.optionalTools) {
      for (const tool of skill.optionalTools) {
        toolNames.add(tool);
      }
    }
  }

  return Array.from(toolNames);
}

/**
 * Bind tools from the global registry based on skill requirements
 */
export function bindTools(skills: Skill[]): {
  tools: StructuredToolInterface[];
  registeredTools: RegisteredTool[];
  missingTools: string[];
} {
  const requiredToolNames = getRequiredTools(skills);
  const boundTools: RegisteredTool[] = [];
  const missingTools: string[] = [];

  for (const toolName of requiredToolNames) {
    const tool = globalToolRegistry.get(toolName);
    if (tool) {
      boundTools.push(tool);
    } else {
      missingTools.push(toolName);
    }
  }

  return {
    tools: boundTools.map(t => t.tool),
    registeredTools: boundTools,
    missingTools,
  };
}

// ============================================================================
// Agent Composition
// ============================================================================

export interface ComposedAgentSpec {
  name: string;
  persona: Persona;
  skills: Skill[];
  systemPrompt: string;
  tools: StructuredToolInterface[];
  toolMap: Map<string, StructuredToolInterface>;
  registeredTools: RegisteredTool[];
  model: string;
  provider: string;
  maxIterations: number;
}

/**
 * Compose an agent from an AgentComposition
 */
export function composeAgent(composition: AgentComposition): ComposedAgentSpec {
  const { name, persona, skills, model } = composition;

  // Use defaults if model config not provided
  const modelConfig = model ?? { primary: 'gpt-5.2', provider: 'openai', maxIterations: 10 };

  // Bind tools based on skill requirements
  const { tools, registeredTools, missingTools } = bindTools(skills);

  if (missingTools.length > 0) {
    console.warn(`Warning: Missing tools: ${missingTools.join(', ')}`);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(persona, skills, registeredTools);

  // Create tool map for quick lookup
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  return {
    name,
    persona,
    skills,
    systemPrompt,
    tools,
    toolMap,
    registeredTools,
    model: modelConfig.primary ?? 'gpt-5.2',
    provider: modelConfig.provider ?? 'openai',
    maxIterations: modelConfig.maxIterations ?? 10,
  };
}

// ============================================================================
// Quick Compose (from component IDs)
// ============================================================================

/**
 * Quickly compose an agent from component IDs
 */
export function quickCompose(
  personaId: string,
  skillIds: string[],
  registry: ComponentRegistry
): ComposedAgentSpec | null {
  const persona = registry.personas.get(personaId);
  if (!persona) {
    console.error(`Persona not found: ${personaId}`);
    return null;
  }

  const skills: Skill[] = [];
  for (const skillId of skillIds) {
    const skill = registry.skills.get(skillId);
    if (skill) {
      skills.push(skill);
    } else {
      console.warn(`Skill not found: ${skillId}`);
    }
  }

  const composition: AgentComposition = {
    name: `${personaId}-${skillIds.join('-')}`,
    version: '1.0.0',
    persona,
    skills,
    model: {
      primary: 'gpt-5.2',
      provider: 'openai',
      maxIterations: 10,
    },
  };

  return composeAgent(composition);
}
