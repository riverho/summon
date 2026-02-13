import { StructuredToolInterface } from '@langchain/core/tools';
import {
  AgentComposition,
  Persona,
  Skill,
  ComponentRegistry,
  PersonaRef,
  SkillRef,
  GuardrailConfig,
} from './types.js';
import { globalToolRegistry, RegisteredTool } from '../runtime/tools.js';
import { createComponentRegistry } from './registry.js';

// ============================================================================
// $ref Resolution
// ============================================================================

// NOTE: PersonaRef / SkillRef are defined in ./types.ts.
// Do not re-export them here, otherwise barrel exports (src/components/index.ts)
// will collide and TypeScript will error.

function isPersonaRef(obj: unknown): obj is PersonaRef {
  return typeof obj === 'object' && obj !== null && '$ref' in obj;
}

function isSkillRef(obj: unknown): obj is SkillRef {
  return typeof obj === 'object' && obj !== null && '$ref' in obj;
}

/**
 * Resolve persona from composition (handles $ref or inline)
 */
export function resolvePersona(
  compositionPersona: Persona | PersonaRef,
  registry: ComponentRegistry
): Persona | null {
  if (isPersonaRef(compositionPersona)) {
    const ref = compositionPersona.$ref;
    const resolved = registry.personas.get(ref);
    if (!resolved) {
      console.error(`Persona reference not found: ${ref}`);
      return null;
    }
    return resolved;
  }
  // Inline persona
  return compositionPersona as Persona;
}

/**
 * Resolve skills from composition (handles $ref or inline)
 */
export function resolveSkills(
  compositionSkills: Array<Skill | SkillRef>,
  registry: ComponentRegistry
): Skill[] {
  const resolved: Skill[] = [];

  for (const skill of compositionSkills) {
    if (isSkillRef(skill)) {
      const ref = skill.$ref;
      const resolvedSkill = registry.skills.get(ref);
      if (!resolvedSkill) {
        console.warn(`Skill reference not found: ${ref}`);
        continue;
      }
      resolved.push(resolvedSkill);
    } else {
      // Inline skill
      resolved.push(skill as Skill);
    }
  }

  return resolved;
}

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
  boundTools: RegisteredTool[],
  agentName?: string
): string {
  const personaPrompt = buildPersonaPrompt(persona);
  const skillsPrompt = buildSkillsPrompt(skills);
  const toolsPrompt = buildToolDescriptionsPrompt(boundTools);

  const namePrefix = agentName ? `[${agentName}]` : '';

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

${namePrefix} Prefix: Start your response with ${namePrefix} for conversation clarity.

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
  workflow?: {
    style: 'loose' | 'guided' | 'strict';
    maxIterations: number;
    timeoutMs: number;
    thinking: {
      reflectionBeforeTool: boolean;
      reflectionBeforeAnswer: boolean;
      qualityPrompts: string[];
    };
  };
  guardrails?: {
    thinking: {
      reflectionBeforeTool: boolean;
      reflectionBeforeAnswer: boolean;
      qualityChecklist: string[];
    };
    output: {
      must: string[];
      should: string[];
    };
    safety: {
      blockFinancialAdvice: 'warn' | 'strict' | 'off';
      blockFabricatedData: 'warn' | 'strict' | 'off';
      blockUnsubstantiatedClaims: 'warn' | 'strict' | 'off';
    };
  };
  outputGuardrails?: GuardrailConfig[];
}

/**
 * Compose an agent from an AgentComposition
 */
export function composeAgent(composition: AgentComposition): ComposedAgentSpec {
  const { name, persona: compositionPersona, skills: compositionSkills, model, workflow, guardrails } = composition;

  // Create a registry for $ref resolution
  const registry = createComponentRegistry();

  // Resolve persona (handles $ref or inline)
  const resolvedPersona = resolvePersona(compositionPersona, registry);
  if (!resolvedPersona) {
    throw new Error(`Failed to resolve persona: ${JSON.stringify(compositionPersona)}`);
  }

  // Resolve skills (handles $ref or inline)
  const resolvedSkills = resolveSkills(compositionSkills, registry);

  // Use defaults if model config not provided
  const modelConfig = model ?? { primary: 'gpt-4o', provider: 'openai', maxIterations: 10 };

  // Bind tools based on skill requirements
  const { tools, registeredTools, missingTools } = bindTools(resolvedSkills);

  if (missingTools.length > 0) {
    console.warn(`Warning: Missing tools: ${missingTools.join(', ')}`);
  }

  // Build system prompt
  const systemPrompt = buildSystemPrompt(resolvedPersona, resolvedSkills, registeredTools, name);

  // Create tool map for quick lookup
  const toolMap = new Map<string, StructuredToolInterface>();
  for (const tool of tools) {
    toolMap.set(tool.name, tool);
  }

  return {
    name,
    persona: resolvedPersona,
    skills: resolvedSkills,
    systemPrompt,
    tools,
    toolMap,
    registeredTools,
    model: modelConfig.primary ?? 'gpt-4o',
    provider: modelConfig.provider ?? 'openai',
    maxIterations: modelConfig.maxIterations ?? 10,
    workflow: workflow ? {
      style: workflow.style ?? 'loose',
      maxIterations: workflow.maxIterations ?? 10,
      timeoutMs: workflow.timeoutMs ?? 60000,
      thinking: {
        reflectionBeforeTool: workflow.thinking?.reflectionBeforeTool ?? false,
        reflectionBeforeAnswer: workflow.thinking?.reflectionBeforeAnswer ?? false,
        qualityPrompts: workflow.thinking?.qualityPrompts ?? [],
      },
    } : undefined,
    guardrails: guardrails ? {
      thinking: {
        reflectionBeforeTool: guardrails.thinking?.reflectionBeforeTool ?? false,
        reflectionBeforeAnswer: guardrails.thinking?.reflectionBeforeAnswer ?? false,
        qualityChecklist: guardrails.thinking?.qualityChecklist ?? [],
      },
      output: {
        must: guardrails.output?.must ?? [],
        should: guardrails.output?.should ?? [],
      },
      safety: {
        blockFinancialAdvice: guardrails.safety?.blockFinancialAdvice ?? 'warn',
        blockFabricatedData: guardrails.safety?.blockFabricatedData ?? 'strict',
        blockUnsubstantiatedClaims: guardrails.safety?.blockUnsubstantiatedClaims ?? 'warn',
      },
    } : undefined,
    outputGuardrails: composition.outputGuardrails,
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
      primary: 'gpt-4o',
      provider: 'openai',
      maxIterations: 10,
    },
  };

  return composeAgent(composition);
}
