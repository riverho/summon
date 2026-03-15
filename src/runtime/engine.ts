import { generateSessionId, ChatHistoryManager } from './chat-history.js';
import { composeAgent, type ComposedAgentSpec } from '../components/composer.js';
import { ComposedAgent } from '../components/composed-agent.js';
import { loadAgentComposition, resolvePath } from '../components/registry.js';
import { initializeToolResolver, resolveTools, injectSecrets, type ToolImplementation } from '../tools/resolver.js';
import { registerExternalTools } from './tool-loader.js';
import type { Ritual } from '../ritual/types.js';
import { getRequiredSkills } from '../ritual/loader.js';
import type { AgentEvent } from '../components/types.js';
import {
  type ExecutionContext,
  type ExecutionResult,
  type ExecutionStatus,
  type ExecutionTrace,
  type ExecutionState,
  createExecutionState,
  addTrace,
  markToolUsed,
  isCancelled,
  toExecutionResult,
  createCheckpoint,
  setCheckpoint,
  clearCheckpoint,
  isPausedAtCheckpoint,
} from './context.js';

// Re-export types for consumers
export type { ExecutionContext, ExecutionResult, ExecutionStatus, ExecutionTrace, ExecutionState } from './context.js';
import {
  type SteeringPreferences,
  type ExecutionMode,
  type SteeringSession,
  type SteeringCommand,
  type ExecutionTraceRecord,
  loadSteeringPreferences,
  saveSteeringPreferences,
  createSteeringSession,
  getSteeringSession,
  updateSteeringSession,
  applySteeringCommand,
  formatCheckpoint,
  parseSteeringCommand,
  saveExecutionTrace,
  applyPreferencesToRitual,
  getRitualId,
  endSteeringSession,
  DEFAULT_STEERING_PREFERENCES,
} from '../gap-chat/steering.js';

// ============================================================================
// Engine Types
// ============================================================================

/**
 * Progress callback for streaming updates
 */
export type ProgressCallback = (event: AgentEvent, trace: ExecutionTrace) => void;

/**
 * Engine configuration
 */
export interface EngineConfig {
  /** Whether to auto-initialize tools */
  autoInitTools?: boolean;
  /** Default verbose setting */
  defaultVerbose?: boolean;
  /** Default streaming setting */
  defaultStreaming?: boolean;
}

// ============================================================================
// Gap Chat Transparency Types
// ============================================================================

/**
 * Gap Chat event for transparency logging
 */
export interface GapChatEvent {
  type: 'system' | 'user' | 'assistant' | 'tool' | 'error';
  timestamp: number;
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Gap Chat transparency logger
 */
export interface GapChatLogger {
  log(event: GapChatEvent): void;
  getLogs(): GapChatEvent[];
  clear(): void;
}

/**
 * Create a Gap Chat transparency logger
 */
export function createGapChatLogger(): GapChatLogger {
  const logs: GapChatEvent[] = [];
  
  return {
    log(event: GapChatEvent): void {
      logs.push({ ...event, timestamp: event.timestamp ?? Date.now() });
      
      // Real-time console output for transparency
      const timestamp = new Date(event.timestamp).toISOString().split('T')[1].slice(0, 8);
      switch (event.type) {
        case 'system':
          console.log(`[${timestamp}] [System] ${event.content}`);
          break;
        case 'user':
          console.log(`[${timestamp}] [User] ${event.content}`);
          break;
        case 'assistant':
          console.log(`[${timestamp}] [Assistant] ${event.content.slice(0, 200)}${event.content.length > 200 ? '...' : ''}`);
          break;
        case 'tool':
          console.log(`[${timestamp}] [Tool] ${event.content}`);
          break;
        case 'error':
          console.error(`[${timestamp}] [Error] ${event.content}`);
          break;
      }
    },
    getLogs(): GapChatEvent[] {
      return [...logs];
    },
    clear(): void {
      logs.length = 0;
    },
  };
}

// ============================================================================
// Engine State
// ============================================================================

let engineConfig: EngineConfig = {
  autoInitTools: true,
  defaultVerbose: false,
  defaultStreaming: true,
};

let toolsInitialized = false;

// ============================================================================
// Engine Configuration
// ============================================================================

/**
 * Configure the runtime engine
 */
export function configureEngine(config: EngineConfig): void {
  engineConfig = { ...engineConfig, ...config };
}

/**
 * Get current engine configuration
 */
export function getEngineConfig(): EngineConfig {
  return { ...engineConfig };
}

// ============================================================================
// Tool Resolution
// ============================================================================

/**
 * Initialize tools if not already initialized
 */
export async function ensureToolsInitialized(): Promise<void> {
  if (!toolsInitialized && engineConfig.autoInitTools) {
    await registerExternalTools({ override: true });
    await initializeToolResolver();
    toolsInitialized = true;
  }
}

/**
 * Resolve and prepare tools for a ritual
 */
export async function resolveRitualTools(
  ritual: Ritual,
  env?: Record<string, string | undefined>
): Promise<ToolImplementation[]> {
  await ensureToolsInitialized();
  
  // Get required skills from ritual
  const skillRefs = getRequiredSkills(ritual);
  
  // Define skill-to-tool mapping
  const skillToolMapping: Record<string, string[]> = {
    'finance': ['financial_search'],
    'web': ['web_search'],
    'file': ['file_read', 'file_write'],
    'git': ['git_status', 'git_log', 'git_diff'],
  };
  
  // Collect all required tool names
  const requiredToolNames = new Set<string>();
  for (const skillRef of skillRefs) {
    const tools = skillToolMapping[skillRef] || [];
    tools.forEach(t => requiredToolNames.add(t));
  }
  
  // Resolve tools
  const tools = resolveTools(Array.from(requiredToolNames));
  
  // Inject secrets if environment provided
  if (env) {
    for (const tool of tools) {
      // Apply secret injection to any tool configs
      // This is a placeholder for future tool-specific config injection
      void injectSecrets;
    }
  }
  
  return tools;
}

// ============================================================================
// Agent Composition from Ritual
// ============================================================================

/**
 * Convert a Ritual to an AgentComposition for the composer
 */
function ritualToAgentComposition(ritual: Ritual): unknown {
  return {
    name: ritual.name,
    version: ritual.version,
    description: ritual.description,
    persona: {
      role: ritual.persona.role,
      goal: ritual.persona.goal,
      backstory: ritual.persona.backstory,
      behavior: ritual.persona.behavior,
    },
    skills: ritual.skills.map(skill => ({
      $ref: skill.$ref,
      ...(skill.config ? { config: skill.config } : {}),
    })),
    model: {
      primary: ritual.model.primary,
      fallback: ritual.model.fallback,
    },
    outputGuardrails: ritual.outputGuardrails,
  };
}

/**
 * Compose agent spec from ritual
 */
async function composeAgentFromRitual(
  ritual: Ritual,
  tools: ToolImplementation[],
  modelOverride?: string
): Promise<ComposedAgentSpec> {
  // Convert ritual to composition format
  const composition = ritualToAgentComposition(ritual);
  
  // Compose the agent
  const spec = composeAgent(composition as Parameters<typeof composeAgent>[0]);
  
  // Apply model override if provided
  if (modelOverride) {
    spec.model = modelOverride;
  }
  
  return spec;
}

// ============================================================================
// Event Processing
// ============================================================================

/**
 * Convert AgentEvent to ExecutionTrace
 */
function agentEventToTrace(event: AgentEvent, iteration: number): ExecutionTrace {
  const base = {
    timestamp: Date.now(),
    iteration,
  };
  
  switch (event.type) {
    case 'tool_start':
      return {
        ...base,
        type: 'tool_start',
        tool: event.tool,
        args: event.args,
      };
    case 'tool_end':
      return {
        ...base,
        type: 'tool_end',
        tool: event.tool,
        args: event.args,
        result: event.result,
        duration: event.duration,
      };
    case 'tool_error':
      return {
        ...base,
        type: 'tool_error',
        tool: event.tool,
        error: event.error,
      };
    case 'thinking':
      return {
        ...base,
        type: 'thinking',
        message: event.message,
      };
    case 'answer_start':
      return {
        ...base,
        type: 'answer_start',
      };
    case 'done':
      return {
        ...base,
        type: 'done',
        message: event.answer,
      };
    case 'guardrail_check':
      return {
        ...base,
        type: 'guardrail_check',
        message: `Guardrail check: ${event.passed ? 'passed' : 'failed'} (attempt ${event.attemptCount})`,
      };
    case 'guardrail_failed':
      return {
        ...base,
        type: 'guardrail_failed',
        message: `Guardrail failed: ${event.errors.join(', ')}`,
      };
    default:
      return {
        ...base,
        type: 'thinking',
        message: String(event),
      };
  }
}

// ============================================================================
// Main Execution Function
// ============================================================================

/**
 * Execute a ritual with the given context
 * 
 * This is the main entry point for ritual execution. It:
 * 1. Resolves required tools
 * 2. Composes the agent from the ritual
 * 3. Executes with streaming output
 * 4. Returns execution result with status, output, and traces
 * 
 * Supports three execution modes:
 * - autonomous (default): Run without human intervention
 * - interactive: Pause at checkpoints for Gap Chat steering
 * - review: Save traces for post-hoc analysis
 * 
 * @param ritual - The ritual to execute
 * @param context - Execution context including query and options
 * @returns Execution result with status, output, and traces
 */
export async function executeRitual(
  ritual: Ritual,
  context: ExecutionContext
): Promise<ExecutionResult> {
  const { query, options = {} } = context;
  const {
    model: modelOverride,
    sessionId: providedSessionId,
    verbose = engineConfig.defaultVerbose,
    streaming = engineConfig.defaultStreaming,
    signal,
    quiet = false,
    mode = 'autonomous',
  } = options;
  
  // Generate or use provided session ID
  const sessionId = providedSessionId ?? generateSessionId();
  
  // Load steering preferences for this ritual
  const ritualId = getRitualId(ritual);
  const steeringPreferences = context.steeringPreferences ?? loadSteeringPreferences(ritualId);
  
  // Apply preferences to ritual (modifies behavior)
  const enhancedRitual = applyPreferencesToRitual(ritual, steeringPreferences);
  
  // Initialize execution state with mode and preferences
  const state = createExecutionState(enhancedRitual, query, sessionId, signal, mode, steeringPreferences);
  
  // Create steering session for interactive mode
  let steeringSession: SteeringSession | undefined;
  if (mode === 'interactive') {
    steeringSession = createSteeringSession(sessionId, ritualId, steeringPreferences);
  }
  
  // Initialize Gap Chat transparency logger
  const gapChat = createGapChatLogger();
  
  if (!quiet) {
    gapChat.log({
      type: 'system',
      timestamp: Date.now(),
      content: `Starting ritual execution: ${ritual.name} v${ritual.version} [mode: ${mode}]`,
      metadata: { ritual: ritual.name, sessionId, mode },
    });
  }
  
  try {
    // Step 1: Resolve tools
    if (!quiet && streaming) {
      gapChat.log({
        type: 'system',
        timestamp: Date.now(),
        content: 'Resolving tools...',
      });
    }
    
    const tools = context.tools ?? await resolveRitualTools(ritual, context.env);
    
    if (!quiet && streaming) {
      gapChat.log({
        type: 'system',
        timestamp: Date.now(),
        content: `Resolved ${tools.length} tools: ${tools.map(t => t.name).join(', ') || 'none'}`,
      });
    }
    
    // Step 2: Compose agent
    if (!quiet && streaming) {
      gapChat.log({
        type: 'system',
        timestamp: Date.now(),
        content: `Composing agent: ${ritual.persona.role}`,
      });
    }
    
    const spec = await composeAgentFromRitual(enhancedRitual, tools, modelOverride);
    const agent = ComposedAgent.create(spec, signal);
    
    // Step 3: Initialize chat history if needed
    const chatHistory = new ChatHistoryManager({ sessionId });
    await chatHistory.load();
    chatHistory.saveUserQuery(query);
    
    if (!quiet && streaming) {
      gapChat.log({
        type: 'user',
        timestamp: Date.now(),
        content: query,
      });
    }
    
    // Step 4: Execute agent with event streaming
    let finalAnswer = '';
    let status: ExecutionStatus = 'success';
    let guardrailFailed = false;
    let collectedData: unknown;
    
    for await (const event of agent.run(query, undefined, sessionId)) {
      // Check for cancellation
      if (isCancelled(state)) {
        status = 'cancelled';
        break;
      }
      
      // Convert and store trace
      const trace = agentEventToTrace(event, state.iteration);
      addTrace(state, trace);
      
      // Track tool usage
      if (event.type === 'tool_start') {
        markToolUsed(state, event.tool);
      }
      
      // Collect data for checkpoint
      if (event.type === 'tool_end' && event.result) {
        collectedData = event.result;
      }
      
      // Stream output if enabled
      if (streaming && !quiet) {
        switch (event.type) {
          case 'thinking':
            if (verbose) {
              gapChat.log({
                type: 'assistant',
                timestamp: Date.now(),
                content: `[Thinking] ${event.message}`,
              });
            }
            break;
          case 'tool_start':
            gapChat.log({
              type: 'tool',
              timestamp: Date.now(),
              content: `${event.tool}(${JSON.stringify(event.args)})`,
            });
            break;
          case 'tool_end':
            if (verbose) {
              gapChat.log({
                type: 'tool',
                timestamp: Date.now(),
                content: `${event.tool} completed in ${event.duration}ms`,
              });
            }
            break;
          case 'tool_error':
            gapChat.log({
              type: 'error',
              timestamp: Date.now(),
              content: `${event.tool}: ${event.error}`,
            });
            break;
          case 'guardrail_check':
            if (verbose) {
              gapChat.log({
                type: 'system',
                timestamp: Date.now(),
                content: `Guardrail check: ${event.passed ? 'passed' : 'failed'} (attempt ${event.attemptCount})`,
              });
            }
            break;
          case 'guardrail_failed':
            guardrailFailed = true;
            gapChat.log({
              type: 'error',
              timestamp: Date.now(),
              content: `Guardrail failed: ${event.errors.join(', ')}`,
            });
            break;
          case 'done':
            finalAnswer = event.answer;
            state.iteration = event.iterations;
            break;
        }
      } else if (event.type === 'done') {
        finalAnswer = event.answer;
        state.iteration = event.iterations;
      }
      
      // Increment iteration counter on done
      if (event.type === 'done') {
        state.iteration = event.iterations;
      }
    }
    
    // Check for max iterations
    if (state.iteration >= 10 && !finalAnswer) {
      status = 'max_iterations_reached';
      finalAnswer = '[Max iterations reached]';
    }
    
    // Step 5: Save to chat history
    if (finalAnswer) {
      chatHistory.saveAnswer(finalAnswer, {
        model: spec.model,
        iterations: state.iteration,
        toolsUsed: Array.from(state.toolsUsed),
      });
      await chatHistory.save();
    }
    
    // Step 6: Save execution trace for review mode
    if (mode === 'review' || mode === 'interactive') {
      const traceRecord: ExecutionTraceRecord = {
        id: `${sessionId}-${Date.now()}`,
        ritualRef: ritualId,
        timestamp: Date.now(),
        query,
        output: finalAnswer,
        status,
        iterations: state.iteration,
        toolsUsed: Array.from(state.toolsUsed),
        traces: state.traces.map(t => ({
          type: t.type,
          timestamp: t.timestamp,
          message: t.message,
          tool: t.tool,
          args: t.args,
          result: t.result,
          error: t.error,
        })),
        steeringPreferences,
        duration: Date.now() - state.startTime,
      };
      saveExecutionTrace(traceRecord);
    }
    
    // Step 7: Save steering preferences if modified in interactive mode
    if (mode === 'interactive' && steeringSession) {
      const finalPreferences = steeringSession.preferences;
      if (JSON.stringify(finalPreferences) !== JSON.stringify(steeringPreferences)) {
        saveSteeringPreferences(ritualId, finalPreferences);
      }
      endSteeringSession(sessionId);
    }
    
    // Step 8: Return result
    if (!quiet && streaming) {
      gapChat.log({
        type: 'system',
        timestamp: Date.now(),
        content: `Execution complete: ${status}`,
        metadata: { iterations: state.iteration, toolsUsed: state.toolsUsed.size },
      });
    }
    
    // Strip [Answer] prefix if present for cleaner output
    const cleanedOutput = finalAnswer.replace(/^\[Answer\]\s*/, '');
    
    return toExecutionResult(state, status, cleanedOutput, {
      guardrailFailed,
    });
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Create error checkpoint for interactive mode
    if (mode === 'interactive') {
      const errorCheckpoint = createCheckpoint(state, 'on_error');
      setCheckpoint(state, errorCheckpoint);
      
      if (!quiet) {
        console.log('\n' + formatCheckpoint(errorCheckpoint));
        console.log(`\nError: ${errorMessage}`);
        console.log('\nYou can use RETRY to attempt again with adjusted settings, or ABORT to stop.');
      }
    }
    
    if (!quiet && streaming) {
      gapChat.log({
        type: 'error',
        timestamp: Date.now(),
        content: `Execution failed: ${errorMessage}`,
      });
    }
    
    addTrace(state, {
      type: 'tool_error',
      message: `Execution error: ${errorMessage}`,
      error: errorMessage,
    });
    
    return toExecutionResult(state, 'error', '', {
      errorMessage,
    });
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Execute a ritual by reference (@author/name@version)
 */
export async function executeRitualByRef(
  ritualRef: string,
  query: string,
  options?: ExecutionContext['options']
): Promise<ExecutionResult> {
  const { fetchRitualByRef } = await import('../registry/client.js');
  const ritual = await fetchRitualByRef(ritualRef);
  
  // Parse the YAML content
  const { parseRitualYaml } = await import('../ritual/loader.js');
  const parsedRitual = parseRitualYaml(ritual.yaml);
  
  return executeRitual(parsedRitual, { query, options });
}

/**
 * Execute a ritual from YAML string
 */
export async function executeRitualFromYaml(
  yaml: string,
  query: string,
  options?: ExecutionContext['options']
): Promise<ExecutionResult> {
  const { parseRitualYaml } = await import('../ritual/loader.js');
  const ritual = parseRitualYaml(yaml);
  
  return executeRitual(ritual, { query, options });
}

/**
 * Stream execution results (for real-time UI updates)
 */
export async function* streamExecuteRitual(
  ritual: Ritual,
  context: ExecutionContext
): AsyncGenerator<ExecutionTrace, ExecutionResult, unknown> {
  const result = await executeRitual(ritual, { ...context, options: { ...context.options, streaming: true } });
  
  // Yield all traces
  for (const trace of result.traces) {
    yield trace;
  }
  
  return result;
}

// ============================================================================
// Gap Chat Steering Functions
// ============================================================================

/**
 * Pause execution at a checkpoint and wait for steering input
 * 
 * This function is called when in interactive mode and a checkpoint is reached.
 * It displays the checkpoint information and waits for user commands.
 * 
 * @param state - Current execution state
 * @param step - Checkpoint step identifier
 * @param partialResults - Any partial results collected so far
 * @returns The steering command received from user
 */
export async function pauseAtCheckpoint(
  state: ExecutionState,
  step: 'after_data_collection' | 'before_analysis' | 'before_conclusion',
  partialResults?: unknown
): Promise<SteeringCommand> {
  const checkpoint = createCheckpoint(state, step, partialResults);
  setCheckpoint(state, checkpoint);
  
  // Update steering session
  const session = getSteeringSession(state.sessionId);
  if (session) {
    updateSteeringSession(state.sessionId, {
      currentCheckpoint: checkpoint,
      isPaused: true,
    });
  }
  
  // Display checkpoint in Gap Chat format
  console.log('\n' + '='.repeat(60));
  console.log(formatCheckpoint(checkpoint));
  console.log('='.repeat(60) + '\n');
  
  // In a real implementation, this would integrate with the Gap Chat UI
  // For now, we simulate with console input
  console.log('Waiting for steering command...');
  
  // Default to CONTINUE if not in interactive mode
  if (state.mode !== 'interactive') {
    clearCheckpoint(state);
    return { type: 'CONTINUE' };
  }
  
  // Placeholder - actual implementation would wait for Gap Chat input
  // For now, return CONTINUE to proceed
  clearCheckpoint(state);
  return { type: 'CONTINUE' };
}

/**
 * Apply a steering command during execution
 * 
 * @param state - Current execution state
 * @param command - Steering command to apply
 * @returns Updated execution state
 */
export function applySteering(
  state: ExecutionState,
  command: SteeringCommand
): ExecutionState {
  const updatedPreferences = applySteeringCommand(state.steeringPreferences, command);
  state.steeringPreferences = updatedPreferences;
  
  // Update steering session
  const session = getSteeringSession(state.sessionId);
  if (session) {
    updateSteeringSession(state.sessionId, {
      preferences: updatedPreferences,
      isPaused: false,
    });
  }
  
  // Handle specific commands
  switch (command.type) {
    case 'CONTINUE':
      clearCheckpoint(state);
      break;
      
    case 'ABORT':
      state.isComplete = true;
      break;
      
    case 'RETRY':
      // Mark for retry - execution loop will handle this
      clearCheckpoint(state);
      break;
  }
  
  return state;
}

/**
 * Check if we should pause at a checkpoint based on execution mode
 * 
 * @param state - Current execution state
 * @param step - Checkpoint step to check
 * @returns True if execution should pause
 */
export function shouldPauseAtCheckpoint(
  state: ExecutionState,
  step: string
): boolean {
  if (state.mode !== 'interactive') {
    return false;
  }
  
  // Check if this step is configured as a reflection point
  return state.steeringPreferences.reflectionPoints.includes(step);
}

/**
 * Get recent execution traces for review mode
 * 
 * @param ritualRef - Ritual reference (@author/name)
 * @param limit - Maximum number of traces to retrieve
 * @returns Array of execution traces
 */
export async function getExecutionTracesForReview(
  ritualRef: string,
  limit: number = 5
): Promise<ExecutionTraceRecord[]> {
  const { loadExecutionTraces } = await import('../gap-chat/steering.js');
  return loadExecutionTraces(ritualRef, limit);
}

/**
 * Display execution traces for review
 * 
 * @param ritualRef - Ritual reference
 * @param traces - Execution traces to display
 */
export function displayReviewTraces(
  ritualRef: string,
  traces: ExecutionTraceRecord[]
): void {
  const { formatExecutionTrace } = require('../gap-chat/steering.js');
  
  console.log(`\n📊 Review Mode: ${ritualRef}`);
  console.log(`   Showing last ${traces.length} execution(s)\n`);
  console.log('─'.repeat(60));
  
  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    console.log(`\n#${i + 1} ${formatExecutionTrace(trace)}`);
    
    // Show reasoning path highlights
    if (trace.traces.length > 0) {
      console.log('\n   Reasoning path:');
      const reasoningSteps = trace.traces
        .filter(t => t.type === 'thinking' || t.type === 'tool_start')
        .slice(0, 5);
      
      for (const step of reasoningSteps) {
        if (step.type === 'thinking' && step.message) {
          console.log(`      → ${step.message.slice(0, 60)}${step.message.length > 60 ? '...' : ''}`);
        } else if (step.type === 'tool_start' && step.tool) {
          console.log(`      → [Tool] ${step.tool}`);
        }
      }
    }
    
    if (trace.steeringPreferences) {
      console.log(`\n   Steering: framework=${trace.steeringPreferences.framework}, style=${trace.steeringPreferences.outputStyle.length}`);
    }
    
    console.log('\n' + '─'.repeat(60));
  }
  
  console.log('\n💡 To set preferences for future runs:');
  console.log('   summon run ' + ritualRef + ' "query" --interactive');
}
