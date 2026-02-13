import { z } from 'zod';

// ============================================================================
// Guardrail Configuration Types
// ============================================================================

/**
 * Retry policy for guardrail validation
 */
export const RetryPolicySchema = z.object({
  maxAttempts: z.number().default(3),
  initialDelayMs: z.number().default(1000),
  backoffMultiplier: z.number().default(2),
  maxDelayMs: z.number().default(30000),
});

export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

/**
 * Base guardrail configuration
 */
export const GuardrailConfigSchema = z.object({
  id: z.string().describe('Unique identifier for this guardrail'),
  type: z.enum(['schema', 'regex', 'function', 'llm-judge']).describe('Validation type'),
  description: z.string().optional().describe('Human-readable description'),
  params: z.record(z.string(), z.unknown()).describe('Type-specific parameters'),
  blocking: z.boolean().default(true).describe('If false, failures become warnings'),
  retryPolicy: RetryPolicySchema.optional(),
});

export type GuardrailConfig = z.infer<typeof GuardrailConfigSchema>;

// ============================================================================
// Validation Result Types
// ============================================================================

/**
 * Individual validation error
 */
export interface GuardrailError {
  guardrailId: string;
  type: 'schema' | 'regex' | 'function' | 'llm-judge';
  message: string;
  blocking: boolean;
  path?: string;
  received?: unknown;
  expected?: unknown;
}

/**
 * Result of a single guardrail validation
 */
export interface ValidationResult {
  success: boolean;
  guardrailId: string;
  type: GuardrailConfig['type'];
  error?: GuardrailError;
  durationMs: number;
}

/**
 * Combined result from all guardrails
 */
export interface GuardrailResult {
  success: boolean;
  errors: GuardrailError[];
  metadata: {
    durationMs: number;
    retryAttempts: Record<string, number>;
    passedCount: number;
    failedCount: number;
  };
  transformedValue?: unknown;
}

// ============================================================================
// Validator Type-Specific Params
// ============================================================================

/**
 * Schema validation params (using Zod or JSON Schema)
 */
export interface SchemaGuardrailParams {
  schema: z.ZodType<unknown> | Record<string, unknown>; // Zod schema or JSON Schema object
  transform?: boolean; // Apply transforms if using Zod
}

/**
 * Regex validation params
 */
export interface RegexGuardrailParams {
  pattern: string;
  flags?: string;
  mustMatch: boolean; // true = must match, false = must NOT match
}

/**
 * Function validation params
 */
export interface FunctionGuardrailParams {
  functionName?: string;
  validator?: (value: unknown) => boolean | Promise<boolean>;
  validatorAsync?: (value: unknown) => Promise<boolean>;
  errorMessage?: string;
}

/**
 * LLM-judge validation params
 */
export interface LlmJudgeGuardrailParams {
  criteria: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

// ============================================================================
// Guardrail Events
// ============================================================================

/**
 * Event emitted when guardrail validation is checked
 */
export interface GuardrailCheckEvent {
  type: 'guardrail_check';
  passed: boolean;
  attemptCount: number;
  errors: string[];
}

/**
 * Event emitted when guardrail validation fails persistently
 */
export interface GuardrailFailedEvent {
  type: 'guardrail_failed';
  answer: string;
  errors: string[];
}

// ============================================================================
// Composite Guardrails
// ============================================================================

export type CompositeLogic = 'and' | 'or';

export interface CompositeGuardrailConfig {
  id: string;
  type: 'composite';
  description?: string;
  params: {
    logic: CompositeLogic;
    guardrails: GuardrailConfig[];
  };
  blocking?: boolean;
  retryPolicy?: RetryPolicy;
}
