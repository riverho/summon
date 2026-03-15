import type { Ritual } from '../ritual/types.js';
import type { ToolImplementation } from '../tools/resolver.js';
import type { SteeringPreferences, ExecutionMode, ExecutionCheckpoint, CheckpointState } from '../gap-chat/steering.js';
import type { AgentEvent } from '../components/types.js';

/**
 * Execution trace entry - records a step in the execution
 */
export interface ExecutionTrace {
  /** Timestamp of the trace entry */
  timestamp: number;
  /** Type of trace entry */
  type: 'tool_start' | 'tool_end' | 'tool_error' | 'thinking' | 'answer_start' | 'done' | 'guardrail_check' | 'guardrail_failed';
  /** Message or details */
  message?: string;
  /** Tool name (for tool events) */
  tool?: string;
  /** Tool arguments (for tool events) */
  args?: Record<string, unknown>;
  /** Tool result or error (for tool events) */
  result?: string;
  /** Duration in ms (for tool_end) */
  duration?: number;
  /** Error message (for tool_error) */
  error?: string;
  /** Iteration count */
  iteration?: number;
}

/**
 * Execution result status
 */
export type ExecutionStatus = 'success' | 'error' | 'cancelled' | 'max_iterations_reached';

/**
 * Execution result returned by executeRitual
 */
export interface ExecutionResult {
  /** Execution status */
  status: ExecutionStatus;
  /** Final output/answer */
  output: string;
  /** Execution traces */
  traces: ExecutionTrace[];
  /** Number of iterations performed */
  iterations: number;
  /** Tools that were called */
  toolsUsed: string[];
  /** Session ID for this execution */
  sessionId?: string;
  /** Whether guardrails failed */
  guardrailFailed?: boolean;
  /** Error message if status is 'error' */
  errorMessage?: string;
}

/**
 * Options for execution
 */
export interface ExecutionOptions {
  /** Override the model (e.g., openrouter/deepseek-r1:free) */
  model?: string;
  /** Session ID for multi-turn conversations */
  sessionId?: string;
  /** Whether to enable verbose output */
  verbose?: boolean;
  /** Whether to stream output to terminal */
  streaming?: boolean;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Quiet mode - minimal output */
  quiet?: boolean;
  /** Execution mode: autonomous (default), interactive, or review */
  mode?: ExecutionMode;
  /** Progress callback for monitoring execution */
  onProgress?: (event: AgentEvent) => void;
}

/**
 * Execution context passed to executeRitual
 */
export interface ExecutionContext {
  /** The query/prompt to execute */
  query: string;
  /** Execution options */
  options?: ExecutionOptions;
  /** Pre-resolved tools (optional - will be resolved if not provided) */
  tools?: ToolImplementation[];
  /** Environment variables for secret injection */
  env?: Record<string, string | undefined>;
  /** Steering preferences for Gap Chat mode */
  steeringPreferences?: SteeringPreferences;
  /** Current checkpoint (set during interactive execution) */
  currentCheckpoint?: ExecutionCheckpoint;
}

/**
 * Internal execution state
 */
export interface ExecutionState {
  /** The ritual being executed */
  ritual: Ritual;
  /** The query being processed */
  query: string;
  /** Start time timestamp */
  startTime: number;
  /** Current iteration */
  iteration: number;
  /** Collected traces */
  traces: ExecutionTrace[];
  /** Tools used so far */
  toolsUsed: Set<string>;
  /** Whether execution is complete */
  isComplete: boolean;
  /** Session ID */
  sessionId: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Current execution mode */
  mode: ExecutionMode;
  /** Steering preferences */
  steeringPreferences: SteeringPreferences;
  /** Active checkpoint (if paused) */
  currentCheckpoint?: ExecutionCheckpoint;
}

/**
 * Create initial execution state
 */
export function createExecutionState(
  ritual: Ritual,
  query: string,
  sessionId: string,
  signal?: AbortSignal,
  mode: ExecutionMode = 'autonomous',
  steeringPreferences?: SteeringPreferences
): ExecutionState {
  return {
    ritual,
    query,
    startTime: Date.now(),
    iteration: 0,
    traces: [],
    toolsUsed: new Set(),
    isComplete: false,
    sessionId,
    signal,
    mode,
    steeringPreferences: steeringPreferences ?? {
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
    },
  };
}

/**
 * Add a trace entry to execution state
 */
export function addTrace(
  state: ExecutionState,
  trace: Omit<ExecutionTrace, 'timestamp'>
): void {
  state.traces.push({
    ...trace,
    timestamp: Date.now(),
  });
}

/**
 * Mark a tool as used
 */
export function markToolUsed(state: ExecutionState, toolName: string): void {
  state.toolsUsed.add(toolName);
}

/**
 * Check if execution should be cancelled
 */
export function isCancelled(state: ExecutionState): boolean {
  return state.signal?.aborted ?? false;
}

/**
 * Convert execution state to final result
 */
export function toExecutionResult(
  state: ExecutionState,
  status: ExecutionStatus,
  output: string,
  options?: { guardrailFailed?: boolean; errorMessage?: string }
): ExecutionResult {
  return {
    status,
    output,
    traces: state.traces,
    iterations: state.iteration,
    toolsUsed: Array.from(state.toolsUsed),
    sessionId: state.sessionId,
    guardrailFailed: options?.guardrailFailed,
    errorMessage: options?.errorMessage,
  };
}

// ============================================================================
// Checkpoint System
// ============================================================================

/**
 * Checkpoint definitions with descriptions
 */
export const CHECKPOINTS = {
  after_data_collection: {
    step: 'after_data_collection' as const,
    description: 'Data collection complete. Ready to begin analysis.',
    canSteer: true,
    defaultAction: 'Continue to analysis phase',
  },
  before_analysis: {
    step: 'before_analysis' as const,
    description: 'About to perform main analysis. Framework can be adjusted.',
    canSteer: true,
    defaultAction: 'Proceed with analysis using current framework',
  },
  before_conclusion: {
    step: 'before_conclusion' as const,
    description: 'Analysis complete. Ready to generate final output.',
    canSteer: true,
    defaultAction: 'Generate conclusion with current output style',
  },
  on_error: {
    step: 'on_error' as const,
    description: 'An error occurred. You can adjust settings and retry.',
    canSteer: true,
    defaultAction: 'Abort execution',
  },
};

/**
 * Create a checkpoint state from execution state
 */
export function createCheckpointState(state: ExecutionState): CheckpointState {
  return {
    query: state.query,
    toolsUsed: Array.from(state.toolsUsed),
    iteration: state.iteration,
    traceCount: state.traces.length,
  };
}

/**
 * Create an execution checkpoint
 */
export function createCheckpoint(
  state: ExecutionState,
  step: keyof typeof CHECKPOINTS,
  partialResults?: unknown
): ExecutionCheckpoint {
  const checkpointDef = CHECKPOINTS[step];
  return {
    step: checkpointDef.step,
    description: checkpointDef.description,
    state: {
      ...createCheckpointState(state),
      partialResults,
    },
    canSteer: checkpointDef.canSteer,
    defaultAction: checkpointDef.defaultAction,
    timestamp: Date.now(),
  };
}

/**
 * Update execution state with checkpoint
 */
export function setCheckpoint(
  state: ExecutionState,
  checkpoint: ExecutionCheckpoint
): void {
  state.currentCheckpoint = checkpoint;
}

/**
 * Clear the current checkpoint
 */
export function clearCheckpoint(state: ExecutionState): void {
  state.currentCheckpoint = undefined;
}

/**
 * Check if execution is paused at a checkpoint
 */
export function isPausedAtCheckpoint(state: ExecutionState): boolean {
  return state.currentCheckpoint !== undefined && state.mode === 'interactive';
}
