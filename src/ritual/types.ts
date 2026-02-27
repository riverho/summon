import { z } from 'zod';
import type { SteeringPreferences } from '../gap-chat/steering.js';

/**
 * Skill binding - references a skill by name with optional configuration
 */
export interface SkillBinding {
  /** Skill reference (e.g., '$ref: finance') */
  $ref: string;
  /** Optional skill-specific configuration */
  config?: Record<string, unknown>;
}

/**
 * Retry policy for guardrails
 */
export interface RetryPolicy {
  maxAttempts: number;
  initialDelayMs: number;
}

/**
 * Output guardrail configuration
 */
export interface OutputGuardrail {
  id: string;
  type: 'regex' | 'json-schema' | 'llm-judge';
  description: string;
  params: Record<string, unknown>;
  blocking: boolean;
  retryPolicy?: RetryPolicy;
}

/**
 * Persona configuration for the ritual
 */
export interface Persona {
  role: string;
  goal?: string;
  backstory?: string;
  behavior?: {
    style?: string;
    priorities?: string[];
  };
}

/**
 * Model configuration for the ritual
 */
export interface ModelConfig {
  primary: string;
  fallback?: string;
}

/**
 * Ritual definition - portable agent configuration
 */
export interface Ritual {
  name: string;
  version: string;
  description?: string;
  persona: Persona;
  skills: SkillBinding[];
  model: ModelConfig;
  outputGuardrails?: OutputGuardrail[];
  /** Steering preferences for Gap Chat mode */
  steeringPreferences?: SteeringPreferences;
}

// ============================================================================
// Zod Schemas for Validation
// ============================================================================

export const SkillBindingSchema = z.object({
  $ref: z.string().min(1, "Skill reference cannot be empty"),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const RetryPolicySchema = z.object({
  maxAttempts: z.number().int().min(1).max(10),
  initialDelayMs: z.number().int().min(0).max(60000),
});

export const OutputGuardrailSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['regex', 'json-schema', 'llm-judge']),
  description: z.string(),
  params: z.record(z.string(), z.unknown()),
  blocking: z.boolean().default(false),
  retryPolicy: RetryPolicySchema.optional(),
});

export const PersonaSchema = z.object({
  role: z.string().min(1, "Persona role is required"),
  goal: z.string().optional(),
  backstory: z.string().optional(),
  behavior: z.object({
    style: z.string().optional(),
    priorities: z.array(z.string()).optional(),
  }).optional(),
});

export const ModelConfigSchema = z.object({
  primary: z.string().min(1, "Primary model is required"),
  fallback: z.string().optional(),
});

export const RitualSchema = z.object({
  name: z.string().min(1, "Ritual name is required"),
  version: z.string().refine(
    (v) => /^\d+\.\d+\.\d+$/.test(v),
    { message: "Version must be semver (e.g., 1.0.0)" }
  ),
  description: z.string().optional(),
  persona: PersonaSchema,
  skills: z.array(SkillBindingSchema).min(1, "At least one skill is required"),
  model: ModelConfigSchema,
  outputGuardrails: z.array(OutputGuardrailSchema).optional(),
});

/** Inferred type from Zod schema */
export type RitualSchemaType = z.infer<typeof RitualSchema>;
