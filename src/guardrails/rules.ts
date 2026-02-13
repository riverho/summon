import type { GuardrailConfig } from './types.js';
import { z } from 'zod';

// ============================================================================
// 1. JSON Schema Validation
// ============================================================================

/**
 * Validates output against a JSON schema
 */
export function jsonSchema(
  schema: Record<string, unknown>,
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  return {
    id: options?.id ?? 'json-schema',
    type: 'schema',
    description: 'Validate output against JSON schema',
    params: { schema },
    blocking: options?.blocking ?? true,
  };
}

// ============================================================================
// 2. Code Quality Guardrails
// ============================================================================

/**
 * Detects TODO/FIXME/XXX/HACK markers in code
 */
export function noTodos(options?: { id?: string; blocking?: boolean; patterns?: string[] }): GuardrailConfig {
  const patterns = options?.patterns ?? ['TODO', 'FIXME', 'XXX', 'HACK'];
  const pattern = patterns.join('|');

  return {
    id: options?.id ?? 'no-todos',
    type: 'regex',
    description: `Block ${patterns.join('/')} markers in code`,
    params: {
      pattern: `\\b(${pattern})\\b`,
      flags: 'i',
      mustMatch: false, // Must NOT match
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Checks for proper error handling patterns
 */
export function properErrorHandling(
  options?: { id?: string; blocking?: boolean; language?: string },
): GuardrailConfig {
  const language = options?.language ?? 'typescript';

  return {
    id: options?.id ?? 'proper-error-handling',
    type: 'function',
    description: `Check for proper error handling in ${language}`,
    params: {
      validator: (value: unknown) => {
        const str = String(value);
        const hasTryCatch = /try\s*\{[\s\S]*\}\s*catch/.test(str);
        const hasAsyncAwait = /async|await/.test(str);

        if (hasAsyncAwait && !hasTryCatch) {
          // Async code should have error handling
          return false;
        }

        // Check for empty catch blocks
        const emptyCatch = /catch\s*\(\s*\w+\s*\)\s*\{\s*\}/.test(str);
        if (emptyCatch) {
          return false;
        }

        return true;
      },
      errorMessage: 'Code lacks proper error handling (missing try/catch or empty catch block)',
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Enforces code complexity limits
 */
export function codeComplexity(
  options?: {
    id?: string;
    blocking?: boolean;
    maxNestingDepth?: number;
    maxFunctionLength?: number;
  },
): GuardrailConfig {
  const maxNesting = options?.maxNestingDepth ?? 4;
  const maxLength = options?.maxFunctionLength ?? 50;

  return {
    id: options?.id ?? 'code-complexity',
    type: 'function',
    description: `Enforce max nesting depth (${maxNesting}) and function length (${maxLength})`,
    params: {
      validator: (value: unknown) => {
        const str = String(value);

        // Count nesting depth
        let maxDepth = 0;
        let currentDepth = 0;
        for (const char of str) {
          if (char === '{') {
            currentDepth++;
            maxDepth = Math.max(maxDepth, currentDepth);
          } else if (char === '}') {
            currentDepth--;
          }
        }

        if (maxDepth > maxNesting) {
          return false;
        }

        // Estimate function length by lines
        const lines = str.split('\n');
        if (lines.length > maxLength) {
          return false;
        }

        return true;
      },
      errorMessage: `Code exceeds complexity limits (max nesting: ${maxNesting}, max lines: ${maxLength})`,
    },
    blocking: options?.blocking ?? true,
  };
}

// ============================================================================
// 3. Output Completeness Guardrails
// ============================================================================

/**
 * Ensures specified fields exist in the output
 */
export function requiredFields(
  fields: string[],
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  return {
    id: options?.id ?? 'required-fields',
    type: 'function',
    description: `Ensure fields exist: ${fields.join(', ')}`,
    params: {
      validator: (value: unknown) => {
        if (typeof value !== 'object' || value === null) {
          return false;
        }

        const obj = value as Record<string, unknown>;
        for (const field of fields) {
          // Support nested paths like "user.name"
          const parts = field.split('.');
          let current: unknown = obj;
          for (const part of parts) {
            if (current === null || typeof current !== 'object') {
              return false;
            }
            current = (current as Record<string, unknown>)[part];
          }
          if (current === undefined) {
            return false;
          }
        }
        return true;
      },
      errorMessage: `Missing required fields: ${fields.join(', ')}`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Ensures fields are not empty
 */
export function nonEmptyFields(
  fields: string[],
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  return {
    id: options?.id ?? 'non-empty-fields',
    type: 'function',
    description: `Ensure fields are not empty: ${fields.join(', ')}`,
    params: {
      validator: (value: unknown) => {
        if (typeof value !== 'object' || value === null) {
          return false;
        }

        const obj = value as Record<string, unknown>;
        for (const field of fields) {
          const val = obj[field];
          if (
            val === undefined ||
            val === null ||
            (typeof val === 'string' && val.trim() === '') ||
            (Array.isArray(val) && val.length === 0) ||
            (typeof val === 'object' && Object.keys(val).length === 0)
          ) {
            return false;
          }
        }
        return true;
      },
      errorMessage: `Fields must not be empty: ${fields.join(', ')}`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Validates array length constraints
 */
export function arrayLength(
  field: string,
  constraints: { min?: number; max?: number; exact?: number },
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  const { min, max, exact } = constraints;
  let description = `Validate ${field} array length`;
  if (exact !== undefined) description += ` = ${exact}`;
  else if (min !== undefined && max !== undefined) description += ` between ${min}-${max}`;
  else if (min !== undefined) description += ` >= ${min}`;
  else if (max !== undefined) description += ` <= ${max}`;

  return {
    id: options?.id ?? `${field}-length`,
    type: 'function',
    description,
    params: {
      validator: (value: unknown) => {
        if (typeof value !== 'object' || value === null) {
          return false;
        }

        const arr = (value as Record<string, unknown>)[field];
        if (!Array.isArray(arr)) {
          return false;
        }

        if (exact !== undefined && arr.length !== exact) {
          return false;
        }
        if (min !== undefined && arr.length < min) {
          return false;
        }
        if (max !== undefined && arr.length > max) {
          return false;
        }

        return true;
      },
      errorMessage: `Array '${field}' length violation: ${JSON.stringify(constraints)}`,
    },
    blocking: options?.blocking ?? true,
  };
}

// ============================================================================
// 4. Semantic Validation Guardrails
// ============================================================================

/**
 * LLM-as-judge validation (placeholder - requires LLM integration)
 */
export function semanticJudge(
  criteria: string,
  options?: { id?: string; blocking?: boolean; model?: string },
): GuardrailConfig {
  return {
    id: options?.id ?? 'semantic-judge',
    type: 'llm-judge',
    description: `LLM evaluation: ${criteria.slice(0, 50)}...`,
    params: {
      criteria,
      model: options?.model,
      temperature: 0,
    },
    blocking: options?.blocking ?? true,
    retryPolicy: { maxAttempts: 2, initialDelayMs: 1000, backoffMultiplier: 2, maxDelayMs: 30000 }, // Limited retries for LLM judge
  };
}

/**
 * Checks content relevance by keyword matching
 */
export function relevance(
  requiredKeywords: string[],
  options?: { id?: string; blocking?: boolean; minMatches?: number },
): GuardrailConfig {
  const minMatches = options?.minMatches ?? 1;

  return {
    id: options?.id ?? 'relevance',
    type: 'function',
    description: `Check for at least ${minMatches} of: ${requiredKeywords.join(', ')}`,
    params: {
      validator: (value: unknown) => {
        const str = String(value).toLowerCase();
        const matches = requiredKeywords.filter(kw => str.includes(kw.toLowerCase()));
        return matches.length >= minMatches;
      },
      errorMessage: `Content must include at least ${minMatches} of: ${requiredKeywords.join(', ')}`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Validates tone and style
 */
export function toneCheck(
  options: {
    id?: string;
    blocking?: boolean;
    required?: string[];
    forbidden?: string[];
  },
): GuardrailConfig {
  const { required = [], forbidden = [] } = options;

  return {
    id: options?.id ?? 'tone-check',
    type: 'function',
    description: `Validate tone (forbidden: ${forbidden.join(', ')})`,
    params: {
      validator: (value: unknown) => {
        const str = String(value).toLowerCase();

        // Check forbidden words
        for (const word of forbidden) {
          if (str.includes(word.toLowerCase())) {
            return false;
          }
        }

        // Check required words
        for (const word of required) {
          if (!str.includes(word.toLowerCase())) {
            return false;
          }
        }

        return true;
      },
      errorMessage: `Tone violation: ${forbidden.length > 0 ? `avoid ${forbidden.join(', ')}` : ''} ${required.length > 0 ? `include ${required.join(', ')}` : ''}`,
    },
    blocking: options?.blocking ?? true,
  };
}

// ============================================================================
// 5. File Structure Guardrails
// ============================================================================

import { existsSync, statSync, readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Validates file existence and properties
 */
export function fileExists(
  filePath: string,
  options?: {
    id?: string;
    blocking?: boolean;
    minSize?: number;
    maxSize?: number;
    readable?: boolean;
  },
): GuardrailConfig {
  return {
    id: options?.id ?? `file-exists-${filePath}`,
    type: 'function',
    description: `Check file exists: ${filePath}`,
    params: {
      validator: () => {
        const fullPath = resolve(filePath);
        if (!existsSync(fullPath)) {
          return false;
        }

        const stats = statSync(fullPath);

        if (options?.minSize !== undefined && stats.size < options.minSize) {
          return false;
        }
        if (options?.maxSize !== undefined && stats.size > options.maxSize) {
          return false;
        }

        if (options?.readable) {
          try {
            readFileSync(fullPath);
          } catch {
            return false;
          }
        }

        return true;
      },
      errorMessage: `File validation failed: ${filePath}`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Validates directory structure
 */
export function directoryStructure(
  required: { files?: string[]; dirs?: string[] },
  options?: { id?: string; blocking?: boolean; basePath?: string },
): GuardrailConfig {
  const { files = [], dirs = [] } = required;
  const basePath = options?.basePath ?? process.cwd();

  return {
    id: options?.id ?? 'directory-structure',
    type: 'function',
    description: `Validate project structure`,
    params: {
      validator: () => {
        for (const file of files) {
          const fullPath = resolve(basePath, file);
          if (!existsSync(fullPath)) {
            return false;
          }
        }
        for (const dir of dirs) {
          const fullPath = resolve(basePath, dir);
          if (!existsSync(fullPath) || !statSync(fullPath).isDirectory()) {
            return false;
          }
        }
        return true;
      },
      errorMessage: `Missing required files: ${files.join(', ')} or dirs: ${dirs.join(', ')}`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Validates file content patterns
 */
export function fileContent(
    filePath: string,
    options: {
      id?: string;
      blocking?: boolean;
      required?: string[];
      forbidden?: string[];
    },
  ): GuardrailConfig {
    const { required = [], forbidden = [] } = options;
  
    return {
      id: options?.id ?? `file-content-${filePath}`,
      type: 'function',
      description: `Check content in ${filePath}`,
      params: {
        validator: () => {
          const fullPath = resolve(filePath);
          if (!existsSync(fullPath)) {
            return false;
          }
  
          const content = readFileSync(fullPath, 'utf-8');
  
          for (const pattern of forbidden) {
            if (content.includes(pattern)) {
              return false;
            }
          }
  
          for (const pattern of required) {
            if (!content.includes(pattern)) {
              return false;
            }
          }
  
          return true;
        },
        errorMessage: `File content validation failed: ${filePath}`,
      },
      blocking: options?.blocking ?? true,
    };
  }

// ============================================================================
// 6. Utility Functions
// ============================================================================

/**
 * Combines multiple guardrails with AND logic (all must pass)
 */
export function combineGuardrails(
  guardrails: GuardrailConfig[],
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  return {
    id: options?.id ?? 'combined',
    type: 'function',
    description: `Combined guardrails: ${guardrails.map(g => g.id).join(' + ')}`,
    params: {
      validator: async (value: unknown) => {
        for (const guardrail of guardrails) {
          // Import validator dynamically to avoid circular dependency
          const { GuardrailValidator } = await import('./validator.js');
          const validator = new GuardrailValidator().addGuardrail(guardrail);
          const result = await validator.validate(value);
          if (!result.success) {
            return false;
          }
        }
        return true;
      },
      errorMessage: `One or more combined guardrails failed`,
    },
    blocking: options?.blocking ?? true,
  };
}

/**
 * Combines multiple guardrails with OR logic (at least one must pass)
 */
export function anyOf(
  guardrails: GuardrailConfig[],
  options?: { id?: string; blocking?: boolean },
): GuardrailConfig {
  return {
    id: options?.id ?? 'any-of',
    type: 'function',
    description: `Any of: ${guardrails.map(g => g.id).join(' | ')}`,
    params: {
      validator: async (value: unknown) => {
        for (const guardrail of guardrails) {
          const { GuardrailValidator } = await import('./validator.js');
          const validator = new GuardrailValidator().addGuardrail(guardrail);
          const result = await validator.validate(value);
          if (result.success) {
            return true;
          }
        }
        return false;
      },
      errorMessage: `All guardrails failed: ${guardrails.map(g => g.id).join(', ')}`,
    },
    blocking: options?.blocking ?? true,
  };
}
