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
 * A persona reference (for composable personas)
 */
export const PersonaRefSchema = z.object({
  $ref: z.string().describe('Reference to a persona by ID'),
});

export type PersonaRef = z.infer<typeof PersonaRefSchema>;

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

/**
 * Union type for inline persona or persona reference
 */
export const PersonaOrRefSchema = z.union([PersonaRefSchema, PersonaSchema]);
export type PersonaOrRef = z.infer<typeof PersonaOrRefSchema>;

// ============================================================================
// Skill Types
// ============================================================================

/**
 * A skill reference (for composable skills)
 */
export const SkillRefSchema = z.object({
  $ref: z.string().describe('Reference to a skill by ID'),
});

export type SkillRef = z.infer<typeof SkillRefSchema>;

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

/**
 * Union type for inline skill or skill reference
 */
export const SkillOrRefSchema = z.union([SkillRefSchema, SkillSchema]);
export type SkillOrRef = z.infer<typeof SkillOrRefSchema>;

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
// Output Guardrails Configuration (New)
// ============================================================================

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().default(3),
  initialDelayMs: z.number().default(1000),
  backoffMultiplier: z.number().default(2),
  maxDelayMs: z.number().default(30000),
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const GuardrailConfigSchema = z.object({
  id: z.string(),
  type: z.enum(['schema', 'regex', 'function', 'llm-judge']),
  description: z.string().optional(),
  params: z.record(z.string(), z.unknown()),
  blocking: z.boolean().default(true),
  retryPolicy: RetryPolicySchema.optional(),
});

export type GuardrailConfig = z.infer<typeof GuardrailConfigSchema>;

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
  persona: PersonaOrRefSchema,

  // Skills can be inline definitions or reference IDs
  skills: z.array(SkillOrRefSchema).default([]),

  // Model configuration
  model: ModelConfigSchema.optional(),

  // Workflow configuration
  workflow: WorkflowConfigSchema.optional(),

  // Guardrails configuration (legacy - consider migrating to outputGuardrails)
  guardrails: GuardrailsConfigSchema.optional(),

  // Output guardrails (NEW) - validate agent outputs before state mutation
  outputGuardrails: z.array(GuardrailConfigSchema).optional(),
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
  guardrailFailed?: boolean;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

// ============================================================================
// Guardrail Event Types
// ============================================================================

export interface GuardrailCheckEvent {
  type: 'guardrail_check';
  passed: boolean;
  attemptCount: number;
  errors: string[];
}

export interface GuardrailFailedEvent {
  type: 'guardrail_failed';
  answer: string;
  errors: string[];
}

export type AgentEvent =
  | ToolStartEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ThinkingEvent
  | AnswerStartEvent
  | DoneEvent
  | GuardrailCheckEvent
  | GuardrailFailedEvent;

// ============================================================================
// Composed Agent Configuration
// ============================================================================

export interface ComposedAgentConfig {
  composition: AgentComposition;
  signal?: AbortSignal;
}
