import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { parse as parseYaml } from 'yaml';
import {
  Persona,
  Skill,
  AgentComposition,
  PersonaSchema,
  SkillSchema,
  SkillRefSchema,
  PersonaRefSchema,
  ModelConfigSchema,
  WorkflowConfigSchema,
  GuardrailsConfigSchema,
  AgentCompositionSchema,
  PersonaFileSchema,
  ComponentRegistry,
} from './types.js';

// SUMMON_HOME: Installation directory (for portable use from any folder)
const SUMMON_HOME = process.env.SUMMON_HOME || join(homedir(), '.summon_mem');
const COMPONENTS_DIR = 'components';
const PERSONAS_DIR = 'personas';
const SKILLS_DIR = 'skills';

// Get the actual installation directory (where this module lives)
function getInstallDir(): string {
  return dirname(import.meta.url.replace('file://', ''));
}

// Get the summon home (can be overridden via SUMMON_HOME env)
export function getSummonHome(): string {
  return SUMMON_HOME;
}

// Resolve path: supports summon:// prefix for installation-relative paths
export function resolvePath(inputPath: string): string {
  // summon:// prefix → relative to installation root
  if (inputPath.startsWith('summon://')) {
    // getInstallDir() returns src/, go up 2 levels to reach installation root
    return join(getInstallDir(), '..', '..', inputPath.slice(9));
  }
  // ~/ → home directory
  if (inputPath.startsWith('~/')) {
    return join(homedir(), inputPath.slice(2));
  }
  // Absolute or relative path
  return inputPath;
}

function loadYamlFile<T>(filepath: string): T | null {
  if (!existsSync(filepath)) return null;
  try {
    return parseYaml(readFileSync(filepath, 'utf-8')) as T;
  } catch (error) {
    console.error(`Failed to parse: ${filepath}`, error);
    return null;
  }
}

function loadPersonaFile(filepath: string): Persona | null {
  const data = loadYamlFile<unknown>(filepath);
  if (!data) return null;
  try {
    return PersonaFileSchema.parse(data);
  } catch (error) {
    console.error(`Invalid persona: ${filepath}`, error);
    return null;
  }
}

function loadSkillFile(filepath: string): Skill | null {
  const data = loadYamlFile<unknown>(filepath);
  if (!data) return null;
  try {
    return SkillSchema.parse(data);
  } catch (error) {
    console.error(`Invalid skill: ${filepath}`, error);
    return null;
  }
}

function findYamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml')).map(f => join(dir, f));
  } catch {
    return [];
  }
}

function getBuiltinDir(): string {
  return join(getInstallDir(), '..', 'builtin');
}

function loadPersonasFromDir(dir: string): Map<string, Persona> {
  const personas = new Map<string, Persona>();
  for (const file of findYamlFiles(dir)) {
    const persona = loadPersonaFile(file);
    if (persona && persona.id) personas.set(persona.id, persona);
  }
  return personas;
}

function loadSkillsFromDir(dir: string): Map<string, Skill> {
  const skills = new Map<string, Skill>();
  for (const file of findYamlFiles(dir)) {
    const skill = loadSkillFile(file);
    if (skill && skill.id) skills.set(skill.id, skill);
  }
  return skills;
}

export function createComponentRegistry(): ComponentRegistry {
  const registry: ComponentRegistry = { personas: new Map(), skills: new Map() };
  const builtinDir = getBuiltinDir();

  // Built-in
  for (const [id, p] of loadPersonasFromDir(join(builtinDir, PERSONAS_DIR))) registry.personas.set(id, p);
  for (const [id, s] of loadSkillsFromDir(join(builtinDir, SKILLS_DIR))) registry.skills.set(id, s);

  // User global ~/.summon_mem/components/
  for (const [id, p] of loadPersonasFromDir(join(SUMMON_HOME, COMPONENTS_DIR, PERSONAS_DIR))) registry.personas.set(id, p);
  for (const [id, s] of loadSkillsFromDir(join(SUMMON_HOME, COMPONENTS_DIR, SKILLS_DIR))) registry.skills.set(id, s);

  // Local .summon_mem/
  for (const [id, p] of loadPersonasFromDir(join(process.cwd(), '.summon_mem', COMPONENTS_DIR, PERSONAS_DIR))) registry.personas.set(id, p);
  for (const [id, s] of loadSkillsFromDir(join(process.cwd(), '.summon_mem', COMPONENTS_DIR, SKILLS_DIR))) registry.skills.set(id, s);

  return registry;
}

export function getPersona(registry: ComponentRegistry, id: string): Persona | undefined {
  return registry.personas.get(id);
}

export function getSkill(registry: ComponentRegistry, id: string): Skill | undefined {
  return registry.skills.get(id);
}

export function getSkills(registry: ComponentRegistry, ids: string[]): Skill[] {
  return ids.map(id => registry.skills.get(id)).filter((s): s is Skill => s !== undefined);
}

export function listPersonas(registry: ComponentRegistry): string[] {
  return Array.from(registry.personas.keys());
}

export function listSkills(registry: ComponentRegistry): string[] {
  return Array.from(registry.skills.keys());
}

export function loadAgentComposition(filepath: string): AgentComposition | null {
  const resolvedPath = resolvePath(filepath);
  const data = loadYamlFile<unknown>(resolvedPath);
  if (!data) return null;
  try {
    return AgentCompositionSchema.parse(data);
  } catch (error) {
    console.error(`Invalid composition: ${filepath} (resolved: ${resolvedPath})`, error);
    return null;
  }
}

export function validateComposition(composition: AgentComposition, registry: ComponentRegistry): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate persona (check for $ref or inline)
  if (!composition.persona) {
    errors.push("Missing required field: 'persona'");
  } else if ('$ref' in composition.persona && composition.persona.$ref) {
    // It's a persona reference
    const ref = composition.persona.$ref;
    const persona = registry.personas.get(ref);
    if (!persona) {
      errors.push(`Persona reference not found: '$ref: ${ref}'`);
      errors.push(`  Suggestion: Install with 'summon install persona ${ref}' or check available personas with 'summon personas list'`);
    }
  } else {
    // Validate inline persona
    try {
      PersonaSchema.parse(composition.persona);
    } catch (e) {
      errors.push(`Invalid persona: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Validate skills (check for $ref or inline)
  if (composition.skills && composition.skills.length > 0) {
    for (let i = 0; i < composition.skills.length; i++) {
      const skill = composition.skills[i];
      if (skill && '$ref' in skill && skill.$ref) {
        // It's a skill reference
        const ref = skill.$ref;
        const foundSkill = registry.skills.get(ref);
        if (!foundSkill) {
          errors.push(`Skill reference not found at index ${i}: '$ref: ${ref}'`);
          errors.push(`  Suggestion: Install with 'summon install skill ${ref}' or check available skills with 'summon skills list'`);
        }
      } else {
        // Validate inline skill
        try {
          SkillSchema.parse(skill);
        } catch (e) {
          errors.push(`Invalid skill at index ${i}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  // Validate model config
  if (composition.model) {
    try {
      ModelConfigSchema.parse(composition.model);
    } catch (e) {
      errors.push(`Invalid model config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Validate workflow config
  if (composition.workflow) {
    try {
      WorkflowConfigSchema.parse(composition.workflow);
    } catch (e) {
      errors.push(`Invalid workflow config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Validate guardrails config
  if (composition.guardrails) {
    try {
      GuardrailsConfigSchema.parse(composition.guardrails);
    } catch (e) {
      errors.push(`Invalid guardrails config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
