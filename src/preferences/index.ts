import { z } from 'zod';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

// ============================================================================
// Preference Schemas
// ============================================================================

/**
 * Response style preferences
 */
export const StylePreferencesSchema = z.object({
  response_length: z.enum(['concise', 'detailed', 'exhaustive']).default('detailed'),
  tone: z.enum(['formal', 'casual', 'professional']).default('professional'),
  reasoning: z.enum(['hidden', 'brief', 'thorough']).default('brief'),
});

export type StylePreferences = z.infer<typeof StylePreferencesSchema>;

/**
 * Formatting preferences
 */
export const FormatPreferencesSchema = z.object({
  use_tables: z.boolean().default(true),
  use_bullets: z.boolean().default(true),
  include_sources: z.boolean().default(true),
  code_style: z.enum(['minimal', 'commented', 'explained']).default('commented'),
});

export type FormatPreferences = z.infer<typeof FormatPreferencesSchema>;

/**
 * Safety and guardrail preferences
 */
export const SafetyPreferencesSchema = z.object({
  max_cost_per_run: z.number().default(0.50),
  max_time_per_run: z.number().default(5),
  allowed_tools: z.array(z.string()).default(['web-search', 'file-reader', 'calculator']),
  blocked_topics: z.array(z.string()).default([]),
});

export type SafetyPreferences = z.infer<typeof SafetyPreferencesSchema>;

/**
 * Learning preferences
 */
export const LearningPreferencesSchema = z.object({
  auto_apply_lessons: z.boolean().default(true),
  preferred_examples: z.array(z.string()).default([]),
});

export type LearningPreferences = z.infer<typeof LearningPreferencesSchema>;

/**
 * User identity
 */
export const UserIdentitySchema = z.object({
  name: z.string().default('User'),
  email: z.string().optional(),
  user_id: z.string().optional(),
});

export type UserIdentity = z.infer<typeof UserIdentitySchema>;

/**
 * Complete user preferences
 */
export const UserPreferencesSchema = z.object({
  version: z.string().default('1.0.0'),
  user: UserIdentitySchema,
  style: StylePreferencesSchema,
  format: FormatPreferencesSchema,
  safety: SafetyPreferencesSchema,
  learning: LearningPreferencesSchema,
  // Custom overrides for specific rituals
  ritual_overrides: z.record(z.string(), z.record(z.string(), z.any())),
});

export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ============================================================================
// Default Preferences
// ============================================================================

export const DEFAULT_PREFERENCES: UserPreferences = {
  version: '1.0.0',
  user: {
    name: 'User',
  },
  style: {
    response_length: 'detailed',
    tone: 'professional',
    reasoning: 'brief',
  },
  format: {
    use_tables: true,
    use_bullets: true,
    include_sources: true,
    code_style: 'commented',
  },
  safety: {
    max_cost_per_run: 0.50,
    max_time_per_run: 5,
    allowed_tools: ['web-search', 'file-reader', 'calculator'],
    blocked_topics: [],
  },
  learning: {
    auto_apply_lessons: true,
    preferred_examples: [],
  },
  ritual_overrides: {},
};

// ============================================================================
// Paths
// ============================================================================

const OPENCLAW_DIR = '.openclaw';
const PREFERENCES_FILE = 'preferences.yaml';

/**
 * Get the OpenClaw config directory path
 */
export function getPreferencesDir(): string {
  return join(homedir(), OPENCLAW_DIR);
}

/**
 * Get the preferences file path
 */
export function getPreferencesPath(): string {
  return join(getPreferencesDir(), PREFERENCES_FILE);
}

// ============================================================================
// Load & Save
// ============================================================================

/**
 * Load user preferences from ~/.openclaw/preferences.yaml
 * Returns defaults if file doesn't exist
 */
export function loadPreferences(): UserPreferences {
  const prefsPath = getPreferencesPath();
  
  if (!existsSync(prefsPath)) {
    return { ...DEFAULT_PREFERENCES };
  }

  try {
    const content = readFileSync(prefsPath, 'utf-8');
    const parsed = parseYaml(content);
    
    // Merge with defaults for any missing fields
    return mergePreferences(DEFAULT_PREFERENCES, parsed);
  } catch (error) {
    console.warn('Failed to load preferences, using defaults:', error);
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Save user preferences to ~/.openclaw/preferences.yaml
 */
export function savePreferences(preferences: UserPreferences): boolean {
  try {
    const prefsDir = getPreferencesDir();
    if (!existsSync(prefsDir)) {
      mkdirSync(prefsDir, { recursive: true });
    }

    // Validate before saving
    const validated = UserPreferencesSchema.parse(preferences);
    
    writeFileSync(getPreferencesPath(), stringifyYaml(validated), 'utf-8');
    return true;
  } catch (error) {
    console.error('Failed to save preferences:', error);
    return false;
  }
}

/**
 * Merge partial preferences with defaults
 */
export function mergePreferences(
  defaults: UserPreferences,
  overrides: Partial<UserPreferences>
): UserPreferences {
  return {
    ...defaults,
    ...overrides,
    user: { ...defaults.user, ...overrides.user },
    style: { ...defaults.style, ...overrides.style },
    format: { ...defaults.format, ...overrides.format },
    safety: { ...defaults.safety, ...overrides.safety },
    learning: { ...defaults.learning, ...overrides.learning },
    ritual_overrides: { ...defaults.ritual_overrides, ...(overrides.ritual_overrides || {}) },
  };
}

// ============================================================================
// Update Helpers
// ============================================================================

/**
 * Update a specific preference path
 */
export function updatePreference<
  K extends keyof UserPreferences,
  SK extends keyof UserPreferences[K]
>(
  preferences: UserPreferences,
  section: K,
  key: SK,
  value: UserPreferences[K][SK]
): UserPreferences {
  const sectionData = preferences[section] as Record<string, unknown>;
  return {
    ...preferences,
    [section]: {
      ...sectionData,
      [key]: value,
    },
  } as UserPreferences;
}

/**
 * Set a style preference
 */
export function setStylePreference(
  preferences: UserPreferences,
  key: keyof StylePreferences,
  value: StylePreferences[keyof StylePreferences]
): UserPreferences {
  return updatePreference(preferences, 'style', key, value);
}

/**
 * Set a format preference
 */
export function setFormatPreference(
  preferences: UserPreferences,
  key: keyof FormatPreferences,
  value: FormatPreferences[keyof FormatPreferences]
): UserPreferences {
  return updatePreference(preferences, 'format', key, value);
}

/**
 * Set a safety preference
 */
export function setSafetyPreference(
  preferences: UserPreferences,
  key: keyof SafetyPreferences,
  value: SafetyPreferences[keyof SafetyPreferences]
): UserPreferences {
  return updatePreference(preferences, 'safety', key, value);
}

// ============================================================================
// Ritual Overrides
// ============================================================================

/**
 * Get ritual-specific overrides
 */
export function getRitualOverrides(
  preferences: UserPreferences,
  ritualId: string
): Record<string, unknown> {
  return preferences.ritual_overrides[ritualId] || {};
}

/**
 * Set ritual-specific overrides
 */
export function setRitualOverrides(
  preferences: UserPreferences,
  ritualId: string,
  overrides: Record<string, unknown>
): UserPreferences {
  return {
    ...preferences,
    ritual_overrides: {
      ...preferences.ritual_overrides,
      [ritualId]: overrides,
    },
  };
}

// ============================================================================
// System Prompt Integration
// ============================================================================

/**
 * Generate a system prompt section based on user preferences
 */
export function preferencesToSystemPrompt(preferences: UserPreferences): string {
  const lines: string[] = [];
  
  lines.push(`# User Preferences`);
  lines.push(`Name: ${preferences.user.name}`);
  lines.push('');
  
  // Style
  lines.push(`## Response Style`);
  lines.push(`- Length: ${preferences.style.response_length}`);
  lines.push(`- Tone: ${preferences.style.tone}`);
  if (preferences.style.reasoning !== 'hidden') {
    lines.push(`- Show reasoning: ${preferences.style.reasoning}`);
  }
  lines.push('');
  
  // Format
  lines.push(`## Formatting`);
  if (preferences.format.use_tables) lines.push('- Use tables where appropriate');
  if (preferences.format.use_bullets) lines.push('- Use bullet points for lists');
  if (preferences.format.include_sources) lines.push('- Include sources when available');
  lines.push(`- Code style: ${preferences.format.code_style}`);
  lines.push('');
  
  // Safety constraints
  if (preferences.safety.blocked_topics.length > 0) {
    lines.push(`## Constraints`);
    lines.push(`- Avoid topics: ${preferences.safety.blocked_topics.join(', ')}`);
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Get a compact version for injection into prompts
 */
export function getPreferencesContext(preferences: UserPreferences): string {
  const parts: string[] = [];
  
  parts.push(`User: ${preferences.user.name}`);
  parts.push(`Style: ${preferences.style.response_length}, ${preferences.style.tone}`);
  
  if (preferences.format.include_sources) parts.push('cite sources');
  if (preferences.format.use_tables) parts.push('use tables');
  if (preferences.format.use_bullets) parts.push('use bullets');
  
  return `[${parts.join(' | ')}]`;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a preferences object
 */
export function validatePreferences(
  prefs: unknown
): { valid: boolean; errors: string[]; data?: UserPreferences } {
  const result = UserPreferencesSchema.safeParse(prefs);
  
  if (result.success) {
    return { valid: true, errors: [], data: result.data };
  } else {
    return {
      valid: false,
      errors: result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`),
    };
  }
}
