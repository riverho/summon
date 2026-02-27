import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { Ritual } from '../ritual/types.js';

// ============================================================================
// Steering Types
// ============================================================================

/**
 * Execution mode for the runtime
 */
export type ExecutionMode = 'autonomous' | 'interactive' | 'review';

/**
 * Framework preference for reasoning approach
 */
export type FrameworkPreference = 
  | 'first_principles'
  | 'bayesian'
  | 'comparative'
  | 'red_team_blue_team'
  | 'default';

/**
 * Output style configuration
 */
export interface OutputStyle {
  length: 'concise' | 'detailed' | 'exhaustive';
  format: 'bullets' | 'narrative' | 'structured';
  tone: 'analytical' | 'conversational' | 'professional';
}

/**
 * Reflection point configuration
 */
export interface ReflectionPoint {
  step: string;
  description: string;
  enabled: boolean;
}

/**
 * Steering preferences stored for a ritual
 */
export interface SteeringPreferences {
  /** Preferred reasoning framework */
  framework: FrameworkPreference;
  /** Reflection points to enable */
  reflectionPoints: string[];
  /** Output style preferences */
  outputStyle: OutputStyle;
  /** Conditional logic for clarifications */
  askForClarification: boolean;
  /** Provide multiple scenarios when uncertain */
  provideScenarios: boolean;
  /** Risk tolerance level */
  riskTolerance: 'low' | 'medium' | 'high';
  /** Evidence threshold for conclusions */
  evidenceThreshold: 'low' | 'medium' | 'high';
  /** Custom metadata */
  custom?: Record<string, unknown>;
}

/**
 * Checkpoint where execution can pause for steering
 */
export interface ExecutionCheckpoint {
  /** Checkpoint identifier */
  step: CheckpointStep;
  /** Human-readable description */
  description: string;
  /** Current execution state snapshot */
  state: CheckpointState;
  /** Whether human can intervene here */
  canSteer: boolean;
  /** Default action if no input provided */
  defaultAction: string;
  /** Timestamp when checkpoint was reached */
  timestamp: number;
}

/**
 * Valid checkpoint steps
 */
export type CheckpointStep = 
  | 'after_data_collection'
  | 'before_analysis'
  | 'before_conclusion'
  | 'on_error'
  | 'custom';

/**
 * State captured at checkpoint
 */
export interface CheckpointState {
  /** Current query/prompt */
  query: string;
  /** Partial results collected so far */
  partialResults?: unknown;
  /** Tools used so far */
  toolsUsed: string[];
  /** Current iteration */
  iteration: number;
  /** Traces up to this point */
  traceCount: number;
}

/**
 * Gap Chat steering command
 */
export type SteeringCommand =
  | { type: 'SET_FRAMEWORK'; framework: FrameworkPreference }
  | { type: 'SET_REFLECTION_POINT'; step: string; enabled: boolean }
  | { type: 'ADJUST_STYLE'; style: Partial<OutputStyle> }
  | { type: 'SET_PREFERENCE'; key: string; value: unknown }
  | { type: 'CONTINUE' }
  | { type: 'RETRY' }
  | { type: 'ABORT' };

/**
 * Steering session for interactive mode
 */
export interface SteeringSession {
  /** Session ID */
  sessionId: string;
  /** Ritual being executed */
  ritualId: string;
  /** Current checkpoint (if paused) */
  currentCheckpoint?: ExecutionCheckpoint;
  /** Accumulated steering preferences */
  preferences: SteeringPreferences;
  /** Whether session is paused waiting for input */
  isPaused: boolean;
  /** History of steering commands applied */
  commandHistory: SteeringCommand[];
}

/**
 * Execution trace for review mode
 */
export interface ExecutionTraceRecord {
  /** Trace ID */
  id: string;
  /** Ritual reference */
  ritualRef: string;
  /** Execution timestamp */
  timestamp: number;
  /** Query that was run */
  query: string;
  /** Final output */
  output: string;
  /** Execution status */
  status: 'success' | 'error' | 'cancelled' | 'max_iterations_reached';
  /** Number of iterations */
  iterations: number;
  /** Tools used */
  toolsUsed: string[];
  /** Traces */
  traces: TraceEntry[];
  /** Steering preferences applied */
  steeringPreferences?: SteeringPreferences;
  /** Duration in ms */
  duration: number;
}

/**
 * Individual trace entry
 */
export interface TraceEntry {
  type: string;
  timestamp: number;
  message?: string;
  tool?: string;
  args?: Record<string, unknown>;
  result?: string;
  error?: string;
}

// ============================================================================
// Default Preferences
// ============================================================================

export const DEFAULT_STEERING_PREFERENCES: SteeringPreferences = {
  framework: 'default',
  reflectionPoints: [],
  outputStyle: {
    length: 'detailed',
    format: 'structured',
    tone: 'analytical',
  },
  askForClarification: false,
  provideScenarios: true,
  riskTolerance: 'medium',
  evidenceThreshold: 'medium',
};

// ============================================================================
// Preferences Persistence
// ============================================================================

const PREFERENCES_DIR = join(homedir(), '.summon', 'preferences');
const TRACES_DIR = join(homedir(), '.summon', 'traces');

/**
 * Ensure preferences directory exists
 */
function ensurePreferencesDir(): void {
  if (!existsSync(PREFERENCES_DIR)) {
    mkdirSync(PREFERENCES_DIR, { recursive: true });
  }
}

/**
 * Ensure traces directory exists
 */
function ensureTracesDir(): void {
  if (!existsSync(TRACES_DIR)) {
    mkdirSync(TRACES_DIR, { recursive: true });
  }
}

/**
 * Get preferences file path for a ritual
 */
export function getPreferencesPath(ritualId: string): string {
  // Normalize ritual ID (remove @ and replace special chars)
  const normalizedId = ritualId.replace(/[@/]/g, '_');
  return join(PREFERENCES_DIR, `${normalizedId}.yaml`);
}

/**
 * Load steering preferences for a ritual
 */
export function loadSteeringPreferences(ritualId: string): SteeringPreferences {
  ensurePreferencesDir();
  const path = getPreferencesPath(ritualId);
  
  if (!existsSync(path)) {
    return { ...DEFAULT_STEERING_PREFERENCES };
  }
  
  try {
    const yaml = readFileSync(path, 'utf-8');
    const parsed = parseYaml(yaml) as Partial<SteeringPreferences>;
    return mergePreferences(DEFAULT_STEERING_PREFERENCES, parsed);
  } catch {
    return { ...DEFAULT_STEERING_PREFERENCES };
  }
}

/**
 * Save steering preferences for a ritual
 */
export function saveSteeringPreferences(
  ritualId: string, 
  preferences: SteeringPreferences
): boolean {
  ensurePreferencesDir();
  const path = getPreferencesPath(ritualId);
  
  try {
    const yaml = stringifyYaml(preferences);
    writeFileSync(path, yaml, 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge preferences with defaults
 */
function mergePreferences(
  defaults: SteeringPreferences,
  overrides: Partial<SteeringPreferences>
): SteeringPreferences {
  return {
    framework: overrides.framework ?? defaults.framework,
    reflectionPoints: overrides.reflectionPoints ?? defaults.reflectionPoints,
    outputStyle: {
      ...defaults.outputStyle,
      ...overrides.outputStyle,
    },
    askForClarification: overrides.askForClarification ?? defaults.askForClarification,
    provideScenarios: overrides.provideScenarios ?? defaults.provideScenarios,
    riskTolerance: overrides.riskTolerance ?? defaults.riskTolerance,
    evidenceThreshold: overrides.evidenceThreshold ?? defaults.evidenceThreshold,
    custom: overrides.custom ?? defaults.custom,
  };
}

// ============================================================================
// Trace Storage (for review mode)
// ============================================================================

/**
 * Save execution trace for review
 */
export function saveExecutionTrace(trace: ExecutionTraceRecord): boolean {
  ensureTracesDir();
  const normalizedRef = trace.ritualRef.replace(/[@/]/g, '_');
  const traceFile = join(TRACES_DIR, `${normalizedRef}.jsonl`);
  
  try {
    const line = JSON.stringify(trace) + '\n';
    writeFileSync(traceFile, line, { flag: 'a', encoding: 'utf-8' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Load execution traces for a ritual
 */
export function loadExecutionTraces(
  ritualRef: string, 
  limit: number = 10
): ExecutionTraceRecord[] {
  ensureTracesDir();
  const normalizedRef = ritualRef.replace(/[@/]/g, '_');
  const traceFile = join(TRACES_DIR, `${normalizedRef}.jsonl`);
  
  if (!existsSync(traceFile)) {
    return [];
  }
  
  try {
    const content = readFileSync(traceFile, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const traces = lines
      .slice(-limit)
      .map(line => JSON.parse(line) as ExecutionTraceRecord);
    return traces.reverse(); // Most recent first
  } catch {
    return [];
  }
}

/**
 * Clear execution traces for a ritual
 */
export function clearExecutionTraces(ritualRef: string): boolean {
  ensureTracesDir();
  const normalizedRef = ritualRef.replace(/[@/]/g, '_');
  const traceFile = join(TRACES_DIR, `${normalizedRef}.jsonl`);
  
  if (existsSync(traceFile)) {
    try {
      writeFileSync(traceFile, '', 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse a Gap Chat steering command from user input
 */
export function parseSteeringCommand(input: string): SteeringCommand | null {
  const trimmed = input.trim();
  
  // SET_FRAMEWORK: <framework>
  if (trimmed.startsWith('SET_FRAMEWORK:')) {
    const framework = trimmed.split(':')[1]?.trim() as FrameworkPreference;
    if (framework && isValidFramework(framework)) {
      return { type: 'SET_FRAMEWORK', framework };
    }
    return null;
  }
  
  // SET_REFLECTION_POINT: <step>
  if (trimmed.startsWith('SET_REFLECTION_POINT:')) {
    const step = trimmed.split(':')[1]?.trim();
    if (step) {
      return { type: 'SET_REFLECTION_POINT', step, enabled: true };
    }
    return null;
  }
  
  // ADJUST_STYLE: <style_config>
  if (trimmed.startsWith('ADJUST_STYLE:')) {
    const styleStr = trimmed.split(':')[1]?.trim();
    if (styleStr) {
      const style = parseStyleConfig(styleStr);
      return { type: 'ADJUST_STYLE', style };
    }
    return null;
  }
  
  // CONTINUE
  if (trimmed === 'CONTINUE') {
    return { type: 'CONTINUE' };
  }
  
  // RETRY
  if (trimmed === 'RETRY') {
    return { type: 'RETRY' };
  }
  
  // ABORT
  if (trimmed === 'ABORT') {
    return { type: 'ABORT' };
  }
  
  return null;
}

/**
 * Check if framework is valid
 */
function isValidFramework(framework: string): framework is FrameworkPreference {
  return ['first_principles', 'bayesian', 'comparative', 'red_team_blue_team', 'default'].includes(framework);
}

/**
 * Parse style configuration string
 */
function parseStyleConfig(config: string): Partial<OutputStyle> {
  const style: Partial<OutputStyle> = {};
  const parts = config.split(',').map(p => p.trim());
  
  for (const part of parts) {
    if (part === 'concise' || part === 'detailed' || part === 'exhaustive') {
      style.length = part;
    } else if (part === 'bullets' || part === 'narrative' || part === 'structured') {
      style.format = part;
    } else if (part === 'analytical' || part === 'conversational' || part === 'professional') {
      style.tone = part;
    }
  }
  
  return style;
}

// ============================================================================
// Steering Session Management
// ============================================================================

const activeSessions = new Map<string, SteeringSession>();

/**
 * Create a new steering session
 */
export function createSteeringSession(
  sessionId: string,
  ritualId: string,
  preferences?: SteeringPreferences
): SteeringSession {
  const session: SteeringSession = {
    sessionId,
    ritualId,
    preferences: preferences ?? loadSteeringPreferences(ritualId),
    isPaused: false,
    commandHistory: [],
  };
  
  activeSessions.set(sessionId, session);
  return session;
}

/**
 * Get an active steering session
 */
export function getSteeringSession(sessionId: string): SteeringSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Update steering session
 */
export function updateSteeringSession(
  sessionId: string,
  updates: Partial<SteeringSession>
): SteeringSession | undefined {
  const session = activeSessions.get(sessionId);
  if (!session) return undefined;
  
  const updated = { ...session, ...updates };
  activeSessions.set(sessionId, updated);
  return updated;
}

/**
 * Apply a steering command to preferences
 */
export function applySteeringCommand(
  preferences: SteeringPreferences,
  command: SteeringCommand
): SteeringPreferences {
  const updated = { ...preferences };
  
  switch (command.type) {
    case 'SET_FRAMEWORK':
      updated.framework = command.framework;
      break;
      
    case 'SET_REFLECTION_POINT':
      if (command.enabled) {
        if (!updated.reflectionPoints.includes(command.step)) {
          updated.reflectionPoints.push(command.step);
        }
      } else {
        updated.reflectionPoints = updated.reflectionPoints.filter(p => p !== command.step);
      }
      break;
      
    case 'ADJUST_STYLE':
      updated.outputStyle = { ...updated.outputStyle, ...command.style };
      break;
      
    case 'SET_PREFERENCE':
      if (!updated.custom) {
        updated.custom = {};
      }
      updated.custom[command.key] = command.value;
      break;
  }
  
  return updated;
}

/**
 * End a steering session
 */
export function endSteeringSession(sessionId: string): boolean {
  return activeSessions.delete(sessionId);
}

// ============================================================================
// Ritual Integration
// ============================================================================

/**
 * Get ritual ID from ritual reference or object
 */
export function getRitualId(ritual: Ritual | string): string {
  if (typeof ritual === 'string') {
    return ritual;
  }
  return `${ritual.name}@${ritual.version}`;
}

/**
 * Apply steering preferences to ritual context
 */
export function applyPreferencesToRitual(
  ritual: Ritual,
  preferences: SteeringPreferences
): Ritual {
  // Deep clone to avoid mutations
  const updated: Ritual = JSON.parse(JSON.stringify(ritual));
  
  // Apply framework to persona behavior if specified
  if (preferences.framework !== 'default' && updated.persona.behavior) {
    if (!updated.persona.behavior.priorities) {
      updated.persona.behavior.priorities = [];
    }
    // Add framework as first priority
    const frameworkPriority = `Use ${preferences.framework.replace('_', ' ')} reasoning`;
    if (!updated.persona.behavior.priorities.includes(frameworkPriority)) {
      updated.persona.behavior.priorities.unshift(frameworkPriority);
    }
  }
  
  // Store preferences in custom field for access during execution
  if (!updated.persona.behavior) {
    updated.persona.behavior = {};
  }
  // Use type assertion to add steering preferences
  (updated.persona.behavior as Record<string, unknown>).steeringPreferences = preferences;
  
  return updated;
}

/**
 * Format checkpoint for display in Gap Chat
 */
export function formatCheckpoint(checkpoint: ExecutionCheckpoint): string {
  const lines = [
    `⏸️  Checkpoint: ${checkpoint.step}`,
    `   ${checkpoint.description}`,
    ``,
    `   Iteration: ${checkpoint.state.iteration}`,
    `   Tools used: ${checkpoint.state.toolsUsed.join(', ') || 'none'}`,
    ``,
    '   Available commands:',
    '   • SET_FRAMEWORK: <first_principles|bayesian|comparative|red_team_blue_team>',
    '   • SET_REFLECTION_POINT: <step_name>',
    '   • ADJUST_STYLE: <concise|detailed|exhaustive>',
    '   • CONTINUE - proceed with execution',
    '   • RETRY - re-run with new settings',
    '   • ABORT - stop execution',
  ];
  
  return lines.join('\n');
}

/**
 * Format execution trace for review display
 */
export function formatExecutionTrace(trace: ExecutionTraceRecord): string {
  const date = new Date(trace.timestamp).toLocaleString();
  const statusIcon = trace.status === 'success' ? '✓' : trace.status === 'error' ? '✗' : '○';
  
  const lines = [
    `${statusIcon} [${date}] ${trace.query.slice(0, 60)}${trace.query.length > 60 ? '...' : ''}`,
    `   Status: ${trace.status} | Iterations: ${trace.iterations} | Duration: ${trace.duration}ms`,
    `   Tools: ${trace.toolsUsed.join(', ') || 'none'}`,
  ];
  
  if (trace.steeringPreferences) {
    lines.push(`   Framework: ${trace.steeringPreferences.framework}`);
  }
  
  return lines.join('\n');
}
