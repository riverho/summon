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
  AgentCompositionSchema,
  PersonaFileSchema,
  ComponentRegistry,
} from './types.js';

// BRADDY_HOME: Installation directory (for portable use from any folder)
const BRADDY_HOME = process.env.BRADDY_HOME || join(homedir(), '.braddy');
const COMPONENTS_DIR = 'components';
const PERSONAS_DIR = 'personas';
const SKILLS_DIR = 'skills';

// Get the actual installation directory (where this module lives)
function getInstallDir(): string {
  return dirname(import.meta.url.replace('file://', ''));
}

// Get the braddy home (can be overridden via BRADDY_HOME env)
export function getBraddyHome(): string {
  return BRADDY_HOME;
}

// Resolve path: supports braddy:// prefix for installation-relative paths
export function resolvePath(inputPath: string): string {
  // braddy:// prefix → relative to installation root
  if (inputPath.startsWith('braddy://')) {
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

  // User global ~/.braddy/components/
  for (const [id, p] of loadPersonasFromDir(join(BRADDY_HOME, COMPONENTS_DIR, PERSONAS_DIR))) registry.personas.set(id, p);
  for (const [id, s] of loadSkillsFromDir(join(BRADDY_HOME, COMPONENTS_DIR, SKILLS_DIR))) registry.skills.set(id, s);

  // Local .braddy/
  for (const [id, p] of loadPersonasFromDir(join(process.cwd(), '.braddy', COMPONENTS_DIR, PERSONAS_DIR))) registry.personas.set(id, p);
  for (const [id, s] of loadSkillsFromDir(join(process.cwd(), '.braddy', COMPONENTS_DIR, SKILLS_DIR))) registry.skills.set(id, s);

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
  return { valid: true, errors: [] };
}
