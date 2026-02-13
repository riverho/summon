import { z } from 'zod';
import type {
  GuardrailConfig,
  GuardrailResult,
  GuardrailError,
  ValidationResult,
  RetryPolicy,
  SchemaGuardrailParams,
  RegexGuardrailParams,
  FunctionGuardrailParams,
  LlmJudgeGuardrailParams,
} from './types.js';

// ============================================================================
// Default Configuration
// ============================================================================

export const DefaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 30000,
};

// ============================================================================
// Custom Error
// ============================================================================

export class GuardrailValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: GuardrailError[],
    public readonly result: GuardrailResult,
  ) {
    super(message);
    this.name = 'GuardrailValidationError';
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateBackoff(attempt: number, policy: RetryPolicy): number {
  const delay = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  return Math.min(delay, policy.maxDelayMs);
}

// ============================================================================
// GuardrailValidator Class
// ============================================================================

export class GuardrailValidator {
  private guardrails: GuardrailConfig[] = [];

  /**
   * Add a guardrail to the validator
   */
  addGuardrail(config: GuardrailConfig): this {
    this.guardrails.push(config);
    return this;
  }

  /**
   * Add multiple guardrails
   */
  addGuardrails(configs: GuardrailConfig[]): this {
    for (const config of configs) {
      this.addGuardrail(config);
    }
    return this;
  }

  /**
   * Clear all guardrails
   */
  clear(): this {
    this.guardrails = [];
    return this;
  }

  /**
   * Get current guardrails
   */
  getGuardrails(): GuardrailConfig[] {
    return [...this.guardrails];
  }

  /**
   * Validate a value against all configured guardrails
   */
  async validate(value: unknown): Promise<GuardrailResult> {
    const startTime = Date.now();
    const errors: GuardrailError[] = [];
    const retryAttempts: Record<string, number> = {};
    let passedCount = 0;
    let failedCount = 0;
    let transformedValue: unknown = value;

    for (const guardrail of this.guardrails) {
      const result = await this.validateWithRetry(guardrail, transformedValue);
      retryAttempts[guardrail.id] = result.attempts;

      if (result.success) {
        passedCount++;
        if (result.transformedValue !== undefined) {
          transformedValue = result.transformedValue;
        }
      } else {
        failedCount++;
        if (result.error) {
          errors.push(result.error);
        }
      }
    }

    return {
      success: errors.filter(e => e.blocking).length === 0,
      errors,
      metadata: {
        durationMs: Date.now() - startTime,
        retryAttempts,
        passedCount,
        failedCount,
      },
      transformedValue: transformedValue !== value ? transformedValue : undefined,
    };
  }

  /**
   * Validate with retry logic
   */
  private async validateWithRetry(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError; attempts: number; transformedValue?: unknown }> {
    const policy = { ...DefaultRetryPolicy, ...guardrail.retryPolicy };
    let attempts = 0;
    let lastResult: { success: boolean; error?: GuardrailError; transformedValue?: unknown } | null = null;

    while (attempts < policy.maxAttempts) {
      attempts++;
      const result = await this.runValidation(guardrail, value);
      lastResult = result;

      if (result.success) {
        return { success: true, attempts, transformedValue: result.transformedValue };
      }

      // Wait before retry (except on last attempt)
      if (attempts < policy.maxAttempts) {
        const delay = calculateBackoff(attempts, policy);
        await sleep(delay);
      }
    }

    // Return the actual error from the last attempt, with retry info
    return {
      success: false,
      error: lastResult?.error ? {
        ...lastResult.error,
        message: `${lastResult.error.message} (failed after ${attempts} attempts)`,
      } : {
        guardrailId: guardrail.id,
        type: guardrail.type,
        message: `Validation failed after ${attempts} attempts`,
        blocking: guardrail.blocking ?? true,
      },
      attempts,
    };
  }

  /**
   * Run a single validation
   */
  private async runValidation(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError; transformedValue?: unknown }> {
    try {
      switch (guardrail.type) {
        case 'schema':
          return await this.validateSchema(guardrail, value);
        case 'regex':
          return await this.validateRegex(guardrail, value);
        case 'function':
          return await this.validateFunction(guardrail, value);
        case 'llm-judge':
          return await this.validateLlmJudge(guardrail, value);
        default:
          return {
            success: false,
            error: {
              guardrailId: guardrail.id,
              type: guardrail.type as GuardrailConfig['type'],
              message: `Unknown guardrail type: ${guardrail.type}`,
              blocking: guardrail.blocking ?? true,
            },
          };
      }
    } catch (error) {
      return {
        success: false,
        error: {
          guardrailId: guardrail.id,
          type: guardrail.type,
          message: error instanceof Error ? error.message : String(error),
          blocking: guardrail.blocking ?? true,
        },
      };
    }
  }

  // ========================================================================
  // Validation Implementations
  // ========================================================================

  private async validateSchema(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError; transformedValue?: unknown }> {
    const params = guardrail.params as unknown as SchemaGuardrailParams;

    try {
      if (params.schema instanceof z.ZodType) {
        const result = params.schema.safeParse(value);
        if (result.success) {
          return { success: true, transformedValue: result.data };
        } else {
          return {
            success: false,
            error: {
              guardrailId: guardrail.id,
              type: 'schema',
              message: result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`).join('; '),
              blocking: guardrail.blocking ?? true,
              path: result.error.issues[0]?.path.join('.'),
              received: value,
            },
          };
        }
      } else {
        // JSON Schema validation (basic implementation)
        // For full JSON Schema support, add ajv dependency
        const schema = params.schema as Record<string, unknown>;
        const result = this.validateJsonSchema(value, schema);
        return result;
      }
    } catch (error) {
      return {
        success: false,
        error: {
          guardrailId: guardrail.id,
          type: 'schema',
          message: error instanceof Error ? error.message : String(error),
          blocking: guardrail.blocking ?? true,
        },
      };
    }
  }

  private validateJsonSchema(
    value: unknown,
    schema: Record<string, unknown>,
  ): { success: boolean; error?: GuardrailError } {
    // Basic JSON Schema validation
    if (schema.type) {
      const actualType = Array.isArray(value) ? 'array' : typeof value;
      if (schema.type !== actualType && !(schema.type === 'object' && value === null)) {
        return {
          success: false,
          error: {
            guardrailId: 'schema',
            type: 'schema',
            message: `Expected type ${String(schema.type)}, got ${actualType}`,
            blocking: true,
            received: value,
            expected: schema.type,
          },
        };
      }
    }

    if (schema.required && Array.isArray(schema.required) && typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      for (const key of schema.required) {
        if (!(key in obj)) {
          return {
            success: false,
            error: {
              guardrailId: 'schema',
              type: 'schema',
              message: `Missing required field: ${String(key)}`,
              blocking: true,
              path: String(key),
            },
          };
        }
      }
    }

    return { success: true };
  }

  private async validateRegex(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError }> {
    const params = guardrail.params as unknown as RegexGuardrailParams;
    const strValue = String(value);
    const pattern = new RegExp(params.pattern, params.flags);
    const matches = pattern.test(strValue);

    if (params.mustMatch ? matches : !matches) {
      return { success: true };
    }

    return {
      success: false,
      error: {
        guardrailId: guardrail.id,
        type: 'regex',
        message: params.mustMatch
          ? `Value must match pattern: ${params.pattern}`
          : `Value must NOT match pattern: ${params.pattern}`,
        blocking: guardrail.blocking ?? true,
        received: strValue,
        expected: params.pattern,
      },
    };
  }

  private async validateFunction(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError }> {
    const params = guardrail.params as unknown as FunctionGuardrailParams;

    try {
      let result: boolean;

      if (params.validator) {
        const validatorResult = params.validator(value);
        result = validatorResult instanceof Promise ? await validatorResult : validatorResult;
      } else if (params.validatorAsync) {
        result = await params.validatorAsync(value);
      } else {
        return {
          success: false,
          error: {
            guardrailId: guardrail.id,
            type: 'function',
            message: 'No validator function provided',
            blocking: guardrail.blocking ?? true,
          },
        };
      }

      if (result) {
        return { success: true };
      }

      return {
        success: false,
        error: {
          guardrailId: guardrail.id,
          type: 'function',
          message: params.errorMessage || 'Custom validation failed',
          blocking: guardrail.blocking ?? true,
          received: value,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: {
          guardrailId: guardrail.id,
          type: 'function',
          message: error instanceof Error ? error.message : String(error),
          blocking: guardrail.blocking ?? true,
        },
      };
    }
  }

  private async validateLlmJudge(
    guardrail: GuardrailConfig,
    value: unknown,
  ): Promise<{ success: boolean; error?: GuardrailError }> {
    const params = guardrail.params as unknown as LlmJudgeGuardrailParams;

    // LLM-judge is a placeholder for now
    // Full implementation would call the LLM with the criteria
    // For now, we pass through with a warning

    console.warn(`[Guardrail] LLM-judge validation not yet implemented for guardrail: ${guardrail.id}`);
    console.warn(`[Guardrail] Criteria: ${params.criteria}`);

    // Return success (passthrough) until LLM integration is complete
    return { success: true };
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createSchemaGuardrail(
  id: string,
  schema: z.ZodType<unknown>,
  options?: Partial<Omit<GuardrailConfig, 'id' | 'type' | 'params'>>,
): GuardrailConfig {
  return {
    id,
    type: 'schema',
    params: { schema },
    blocking: true,
    ...options,
  };
}

export function createRegexGuardrail(
  id: string,
  pattern: string,
  mustMatch: boolean,
  options?: Partial<Omit<GuardrailConfig, 'id' | 'type' | 'params'>>,
): GuardrailConfig {
  return {
    id,
    type: 'regex',
    params: { pattern, mustMatch },
    blocking: true,
    ...options,
  };
}

export function createFunctionGuardrail(
  id: string,
  validator: (value: unknown) => boolean | Promise<boolean>,
  options?: Partial<Omit<GuardrailConfig, 'id' | 'type' | 'params'>>,
): GuardrailConfig {
  return {
    id,
    type: 'function',
    params: { validator },
    blocking: true,
    ...options,
  };
}

export function createLlmJudgeGuardrail(
  id: string,
  criteria: string,
  options?: Partial<Omit<GuardrailConfig, 'id' | 'type' | 'params'>>,
): GuardrailConfig {
  return {
    id,
    type: 'llm-judge',
    params: { criteria },
    blocking: true,
    ...options,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

export async function validateWithSchema<T>(
  value: unknown,
  schema: z.ZodType<T>,
): Promise<{ success: true; data: T } | { success: false; errors: string[] }> {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return {
      success: false,
      errors: result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`),
    };
  }
}
