import { parse } from 'yaml';
import { z } from 'zod';
import type { Ritual } from './types.js';
import { RitualSchema } from './types.js';

/**
 * Error thrown when ritual parsing fails
 */
export class RitualParseError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = 'RitualParseError';
  }
}

/**
 * Error thrown when ritual validation fails
 */
export class RitualValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[]
  ) {
    super(message);
    this.name = 'RitualValidationError';
  }
}

/**
 * Parse ritual YAML into a JavaScript object
 * @param yaml - The YAML content to parse
 * @returns The parsed ritual object (unvalidated)
 * @throws RitualParseError if YAML is invalid
 */
export function parseRitualYaml(yaml: string): Ritual {
  if (!yaml || yaml.trim().length === 0) {
    throw new RitualParseError('Ritual YAML is empty');
  }

  try {
    const parsed = parse(yaml, {
      strict: false,
      uniqueKeys: true,
    });

    if (parsed === null || typeof parsed !== 'object') {
      throw new RitualParseError('Ritual YAML must be an object');
    }

    return parsed as Ritual;
  } catch (error) {
    if (error instanceof RitualParseError) {
      throw error;
    }
    throw new RitualParseError(
      'Failed to parse ritual YAML',
      error,
      [error instanceof Error ? error.message : String(error)]
    );
  }
}

/**
 * Validate a ritual object against the schema
 * @param ritual - The ritual object to validate
 * @returns true if valid
 * @throws RitualValidationError if validation fails
 */
export function validateRitual(ritual: unknown): boolean {
  const result = RitualSchema.safeParse(ritual);
  
  if (!result.success) {
    throw new RitualValidationError(
      `Ritual validation failed: ${result.error.issues.length} issue(s)`,
      result.error.issues
    );
  }
  
  return true;
}

/**
 * Safely validate a ritual without throwing
 * @param ritual - The ritual object to validate
 * @returns Object with success flag and optional error
 */
export function safeValidateRitual(ritual: unknown): { 
  success: boolean; 
  error?: RitualValidationError;
} {
  try {
    validateRitual(ritual);
    return { success: true };
  } catch (error) {
    if (error instanceof RitualValidationError) {
      return { success: false, error };
    }
    throw error;
  }
}

/**
 * Load and parse a ritual from YAML string, with full validation
 * @param yaml - The YAML content to parse
 * @returns Validated ritual object
 * @throws RitualParseError | RitualValidationError
 */
export function loadRitualFromYaml(yaml: string): Ritual {
  const parsed = parseRitualYaml(yaml);
  validateRitual(parsed);
  return parsed;
}

// Alias for convenience
export const loadRitual = loadRitualFromYaml;

/**
 * Get the list of required skills from a ritual
 * @param ritual - The ritual to extract skills from
 * @returns Array of skill names (references without the $ref prefix)
 */
export function getRequiredSkills(ritual: Ritual): string[] {
  return ritual.skills.map(skill => skill.$ref);
}

/**
 * Check if a ritual requires a specific skill
 * @param ritual - The ritual to check
 * @param skillName - The skill name to check for
 * @returns true if the skill is required
 */
export function hasSkill(ritual: Ritual, skillName: string): boolean {
  return ritual.skills.some(skill => skill.$ref === skillName);
}

/**
 * Get skill configuration for a specific skill
 * @param ritual - The ritual to get skill config from
 * @param skillName - The skill name to get config for
 * @returns Skill configuration or undefined
 */
export function getSkillConfig(
  ritual: Ritual, 
  skillName: string
): Record<string, unknown> | undefined {
  const skill = ritual.skills.find(s => s.$ref === skillName);
  return skill?.config;
}
