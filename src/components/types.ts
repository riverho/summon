import { z } from 'zod';

// ============================================================================
// Persona Types
// ============================================================================

/**
 * Response format configuration
 */
export const ResponseFormatSchema = z.object({
  useTables: z.boolean().default(true),
  maxLength: z.number().optional(),
});

export type ResponseFormat = z.infer<typeof ResponseFormatSchema>;

/**
 * Behavior configuration for a persona
 */
export const BehaviorSchema = z.object({
  style: z.enum(['formal', 'casual', 'technical', 'professional']).default('professional'),
  priorities: z.array(z.string()).default([]),
  avoidances: z.array(z.string()).default([]),
  responseFormat: ResponseFormatSchema.optional(),
});

export type Behavior = z.infer<typeof BehaviorSchema>;

/**
 * A persona defines the agent's identity, role, and communication style
 */
export const PersonaSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  role: z.string().describe('The role of this persona, e.g., "Financial Analyst"'),
  goal: z.string().describe('The primary goal of this persona'),
  backstory: z.string().describe('Background context for the persona'),
  behavior: BehaviorSchema.optional(),
});

export type Persona = z.infer<typeof PersonaSchema>;

// ============================================================================
// Skill Types
// ============================================================================

/**
 * A skill defines a capability with required tools and prompt fragments
 */
export const SkillSchema = z.object({
  id: z.string().describe('Unique identifier for the skill'),
  name: z.string().optional(),
  capabilities: z.array(z.string()).describe('What this skill enables'),
  requiredTools: z.array(z.string()).describe('Tools that must be bound for this skill'),
  optionalTools: z.array(z.string()).optional(),
  triggerKeywords: z.array(z.string()).default([]),
  promptFragment: z.string().describe('Injected into system prompt when skill is active'),
});

export type Skill = z.infer<typeof SkillSchema>;

// ============================================================================
// Model Configuration
// ============================================================================

export const ModelConfigSchema = z.object({
  primary: z.string().default('gpt-4o'),
  provider: z.string().default('openai'),
  maxIterations: z.number().default(10),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ============================================================================
// Workflow Configuration
// ============================================================================

export const WorkflowStyleSchema = z.enum(['loose', 'guided', 'strict']).default('loose');

export const WorkflowConfigSchema = z.object({
  style: WorkflowStyleSchema.default('loose'),
  maxIterations: z.number().default(10),
  timeoutMs: z.number().default(60000),
  thinking: z.object({
    reflectionBeforeTool: z.boolean().default(false),
    reflectionBeforeAnswer: z.boolean().default(false),
    qualityPrompts: z.array(z.string()).default([]),
  }).optional(),
});

export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

// ============================================================================
// Guardrails Configuration
// ============================================================================

export const GuardrailsConfigSchema = z.object({
  thinking: z.object({
    reflectionBeforeTool: z.boolean().default(false),
    reflectionBeforeAnswer: z.boolean().default(false),
    qualityChecklist: z.array(z.string()).default([]),
  }).optional(),
  output: z.object({
    must: z.array(z.string()).default([]),
    should: z.array(z.string()).default([]),
  }).optional(),
  safety: z.object({
    blockFinancialAdvice: z.enum(['warn', 'strict', 'off']).default('warn'),
    blockFabricatedData: z.enum(['warn', 'strict', 'off']).default('strict'),
    blockUnsubstantiatedClaims: z.enum(['warn', 'strict', 'off']).default('warn'),
  }).optional(),
});

export type GuardrailsConfig = z.infer<typeof GuardrailsConfigSchema>;

// ============================================================================
// Agent Composition (Portable YAML Format)
// ============================================================================

/**
 * Complete agent definition - can be loaded from a single YAML file
 */
export const AgentCompositionSchema = z.object({
  name: z.string().describe('Unique name for this agent composition'),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),

  // Persona can be inline or a reference ID
  persona: PersonaSchema,

  // Skills can be inline definitions or reference IDs
  skills: z.array(SkillSchema).default([]),

  // Model configuration
  model: ModelConfigSchema.optional(),

  // Workflow configuration
  workflow: WorkflowConfigSchema.optional(),

  // Guardrails configuration
  guardrails: GuardrailsConfigSchema.optional(),
});

export type AgentComposition = z.infer<typeof AgentCompositionSchema>;

// ============================================================================
// Standalone Component Files
// ============================================================================

/**
 * Schema for standalone persona YAML files
 */
export const PersonaFileSchema = PersonaSchema.extend({
  id: z.string().describe('Unique identifier for this persona'),
});

export type PersonaFile = z.infer<typeof PersonaFileSchema>;

/**
 * Schema for standalone skill YAML files
 */
export const SkillFileSchema = SkillSchema;

export type SkillFile = z.infer<typeof SkillFileSchema>;

// ============================================================================
// Registry Types
// ============================================================================

export interface ComponentRegistry {
  personas: Map<string, Persona>;
  skills: Map<string, Skill>;
}

// ============================================================================
// Runtime Event Types
// ============================================================================

export interface ToolStartEvent {
  type: 'tool_start';
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolEndEvent {
  type: 'tool_end';
  tool: string;
  args: Record<string, unknown>;
  result: string;
  duration: number;
}

export interface ToolErrorEvent {
  type: 'tool_error';
  tool: string;
  error: string;
}

export interface ThinkingEvent {
  type: 'thinking';
  message: string;
}

export interface AnswerStartEvent {
  type: 'answer_start';
}

export interface DoneEvent {
  type: 'done';
  answer: string;
  toolCalls: ToolCallRecord[];
  iterations: number;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

export type AgentEvent =
  | ToolStartEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ThinkingEvent
  | AnswerStartEvent
  | DoneEvent;

// ============================================================================
// Composed Agent Configuration
// ============================================================================

export interface ComposedAgentConfig {
  composition: AgentComposition;
  signal?: AbortSignal;
}
