// Ritual Engine v2 — Conditional Edge Support
// Extends the base RitualEngine with branching conditions

import {
  AgentPool,
  ContextManager,
  CheckpointManager,
} from './index.js';
import {
  MicroTask,
  TaskComplexity,
  SubAgentResult,
  StateMutation,
  Checkpoint,
  IDEType,
} from './types.js';
import { MetricsCollector } from '../observability/collector.js';
import {
  ConditionEngine,
  Condition,
  ConditionContext,
  ConditionTrace,
  EvaluationConfig,
  StepResult,
} from '../conditions/index.js';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Extended Types with Condition Support
// ============================================================================

export interface RitualTaskV2 {
  id: string;
  type: string;
  description: string;
  complexity: TaskComplexity;
  status: 'pending' | 'running' | 'completed' | 'failed';
  dependsOn?: string[];
  input: unknown;
  output?: unknown;
  mutations: StateMutation[];
  agentId?: string;
  sessionId?: string;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  iterationCount?: number; // Track how many times this step has been visited
}

export interface RitualV2 {
  id: string;
  goal: string;
  state: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  context: ContextManager;
  tasks: RitualTaskV2[];
  conditions: Condition[];
  conditionResults: Map<string, { outcome: 'then' | 'else'; timestamp: number }>;
  executionPath: string[]; // Record of step IDs in execution order
  metadata: {
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    totalTokensUsed: number;
    estimatedCost: number;
    conditionEvaluations: number;
    maxIterations: number; // Prevent infinite loops
  };
}

export interface RitualPlanV2 {
  goal: string;
  tasks: Array<{
    type: string;
    description: string;
    complexity: TaskComplexity['level'];
    dependsOn?: string[];
  }>;
  conditions?: Condition[];
  evaluation?: EvaluationConfig;
}

export interface RitualOptionsV2 {
  checkpointDir?: string;
  autoCheckpointInterval?: number;
  maxConcurrentTasks?: number;
  defaultTaskTimeout?: number;
  maxIterations?: number; // Max total steps to prevent infinite loops
  onTaskComplete?: (task: RitualTaskV2, result: SubAgentResult) => void;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  onConditionEvaluated?: (trace: ConditionTrace, ritual: RitualV2) => void;
  traceConditions?: boolean; // Enable condition tracing
}

export interface RitualExecutionResult {
  ritualId: string;
  success: boolean;
  finalOutput?: unknown;
  executionPath: string[];
  totalSteps: number;
  conditionEvaluations: number;
  iterationsByStep: Record<string, number>;
  traces?: ConditionTrace[];
  error?: string;
}

// ============================================================================
// Ritual Engine v2 with Conditions
// ============================================================================

export class RitualEngineV2 {
  private pool: AgentPool;
  private checkpointManager: CheckpointManager;
  private metricsCollector: MetricsCollector;
  private conditionEngine: ConditionEngine;
  private rituals: Map<string, RitualV2> = new Map();
  private options: Required<RitualOptionsV2>;
  private stepResults: Map<string, StepResult> = new Map();

  constructor(options: RitualOptionsV2 = {}) {
    this.options = {
      checkpointDir:
        options.checkpointDir ||
        path.join(os.homedir(), '.summon', 'rituals'),
      autoCheckpointInterval: options.autoCheckpointInterval || 60000,
      maxConcurrentTasks: options.maxConcurrentTasks || 5,
      defaultTaskTimeout: options.defaultTaskTimeout || 300000,
      maxIterations: options.maxIterations || 100,
      onTaskComplete: options.onTaskComplete || (() => {}),
      onCheckpoint: options.onCheckpoint || (() => {}),
      onConditionEvaluated: options.onConditionEvaluated || (() => {}),
      traceConditions: options.traceConditions ?? false,
    };

    this.pool = new AgentPool({
      onRoutingDecision: (decision) => {
        this.metricsCollector.recordRouting({
          timestamp: Date.now(),
          taskId: decision.taskId,
          ritualId: '',
          complexity: decision.complexity,
          routedTo: decision.routedTo,
          reason: decision.reason,
          estimatedCost: this.calculateEstimatedCost(
            decision.routedTo,
            decision.complexity.estimatedTokens
          ),
        });
      },
      onSubAgentEvent: (event) => {
        if (event.type === 'spawned') {
          this.metricsCollector.recordSubAgentSpawned(
            event.ritualId,
            event.taskId,
            event.agentType,
            event.sessionId!
          );
        } else if (event.type === 'completed') {
          this.metricsCollector.recordSubAgentCompleted(
            event.ritualId,
            event.taskId,
            event.agentType,
            event.durationMs!,
            event.tokensUsed!
          );
        } else if (event.type === 'failed') {
          this.metricsCollector.recordSubAgentFailed(
            event.ritualId,
            event.taskId,
            event.agentType,
            event.errorCode!,
            0
          );
        }
      },
    });

    this.checkpointManager = new CheckpointManager(this.options.checkpointDir);
    this.metricsCollector = new MetricsCollector(
      path.join(os.homedir(), '.summon', 'metrics')
    );
    this.conditionEngine = new ConditionEngine();
  }

  // ========================================================================
  // Ritual Lifecycle
  // ========================================================================

  async createRitual(
    goal: string,
    plan?: RitualPlanV2,
    evaluationConfig?: EvaluationConfig
  ): Promise<RitualV2> {
    const id = `ritual-v2-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    const ritual: RitualV2 = {
      id,
      goal,
      state: 'pending',
      context: new ContextManager({ goal }),
      tasks: [],
      conditions: plan?.conditions || [],
      conditionResults: new Map(),
      executionPath: [],
      metadata: {
        createdAt: Date.now(),
        totalTokensUsed: 0,
        estimatedCost: 0,
        conditionEvaluations: 0,
        maxIterations: this.options.maxIterations,
      },
    };

    if (plan) {
      // First pass: create all tasks
      for (const taskPlan of plan.tasks) {
        ritual.tasks.push(this.createTask(taskPlan));
      }

      // Second pass: map dependsOn from types to IDs
      const typeToId = new Map<string, string>();
      for (const task of ritual.tasks) {
        typeToId.set(task.type, task.id);
      }

      for (const task of ritual.tasks) {
        if (task.dependsOn && task.dependsOn.length > 0) {
          task.dependsOn = task.dependsOn
            .map((depType) => {
              const depId = typeToId.get(depType);
              if (!depId) {
                console.warn(
                  `Warning: Dependency '${depType}' not found for task '${task.type}'`
                );
              }
              return depId || depType;
            })
            .filter(Boolean) as string[];
        }
      }
    }

    // Reinitialize condition engine with ritual-specific config
    if (evaluationConfig) {
      this.conditionEngine = new ConditionEngine(evaluationConfig);
    }

    this.rituals.set(id, ritual);
    return ritual;
  }

  async executeRitual(ritualId: string): Promise<RitualExecutionResult> {
    const ritual = this.rituals.get(ritualId);
    if (!ritual) {
      throw new Error(`Ritual not found: ${ritualId}`);
    }

    ritual.state = 'running';
    ritual.metadata.startedAt = Date.now();
    this.stepResults.clear();
    this.conditionEngine.clearTraces();

    // Start metrics tracking
    this.metricsCollector.startRitual(ritual as unknown as import('./ritual-engine.js').Ritual);

    try {
      let currentStep = this.getFirstStep(ritual);
      let totalIterations = 0;

      while (currentStep && totalIterations < this.options.maxIterations) {
        totalIterations++;

        // Execute the current step
        const result = await this.executeStep(currentStep, ritual);

        // Record step result for condition evaluation
        const stepResult: StepResult = {
          stepId: currentStep.id,
          success: result.success,
          output: result.success ? result.output : result.error,
          metadata: {
            tokensUsed: result.metrics.tokensUsed,
            durationMs: result.metrics.durationMs,
            model: currentStep.agentId || 'unknown',
          },
        };
        this.stepResults.set(currentStep.id, stepResult);
        ritual.executionPath.push(currentStep.id);

        // Update task tracking
        currentStep.iterationCount = (currentStep.iterationCount || 0) + 1;

        // Save checkpoint after each step
        await this.saveCheckpoint(ritual);

        // Determine next step based on conditions
        const nextStepId = await this.determineNextStep(
          currentStep,
          stepResult,
          ritual
        );

        if (nextStepId === 'complete') {
          ritual.state = 'completed';
          ritual.metadata.completedAt = Date.now();
          break;
        }

        // Find the next step
        const nextStep = ritual.tasks.find((t) => t.id === nextStepId);
        if (!nextStep) {
          throw new Error(`Next step not found: ${nextStepId}`);
        }

        currentStep = nextStep;
      }

      if (totalIterations >= this.options.maxIterations) {
        ritual.state = 'failed';
        throw new Error(
          `Max iterations (${this.options.maxIterations}) reached - possible infinite loop`
        );
      }

      this.metricsCollector.completeRitual(ritualId, 'completed');

      // Calculate iterations by step
      const iterationsByStep: Record<string, number> = {};
      for (const stepId of ritual.executionPath) {
        iterationsByStep[stepId] = (iterationsByStep[stepId] || 0) + 1;
      }

      return {
        ritualId,
        success: true,
        finalOutput: this.buildFinalOutput(ritual),
        executionPath: ritual.executionPath,
        totalSteps: ritual.executionPath.length,
        conditionEvaluations: ritual.metadata.conditionEvaluations,
        iterationsByStep,
        traces: this.options.traceConditions
          ? this.conditionEngine.getTraces()
          : undefined,
      };
    } catch (err: any) {
      ritual.state = 'failed';
      this.metricsCollector.completeRitual(ritualId, 'failed');

      return {
        ritualId,
        success: false,
        executionPath: ritual.executionPath,
        totalSteps: ritual.executionPath.length,
        conditionEvaluations: ritual.metadata.conditionEvaluations,
        iterationsByStep: {},
        error: err.message,
        traces: this.options.traceConditions
          ? this.conditionEngine.getTraces()
          : undefined,
      };
    }
  }

  // ========================================================================
  // Step Execution
  // ========================================================================

  private async executeStep(
    task: RitualTaskV2,
    ritual: RitualV2
  ): Promise<SubAgentResult> {
    task.status = 'running';
    task.startedAt = Date.now();

    const microTask: MicroTask = {
      type: task.type,
      description: task.description,
      input: task.input,
      timeoutMs: this.options.defaultTaskTimeout,
      producesMutations: true,
    };

    // Include outputs from dependencies
    const depOutputs = this.getDependencyOutputs(task, ritual.tasks);
    microTask.input = {
      ...(task.input as object),
      context: depOutputs,
      iteration: task.iterationCount || 1,
    };

    try {
      const result = await this.pool.spawnSubAgent(
        microTask,
        task.complexity,
        ritual.id,
        task.id
      );

      task.completedAt = Date.now();
      task.sessionId = result.sessionId;

      if (result.success) {
        task.status = 'completed';
        task.output = result.output;
        task.mutations = result.mutations;
        task.agentId = result.agentType;

        if (result.mutations.length > 0) {
          ritual.context.applyMutations(result.mutations, result.agentType);
        }

        ritual.metadata.totalTokensUsed += result.metrics.tokensUsed;
        ritual.metadata.estimatedCost += this.calculateCost(result);

        this.metricsCollector.recordTaskComplete(
          task as unknown as import('./ritual-engine.js').RitualTask,
          result
        );
      } else {
        task.status = 'failed';
        task.error = result.error?.message || 'Unknown error';
        this.metricsCollector.recordTaskComplete(
          task as unknown as import('./ritual-engine.js').RitualTask,
          result
        );
      }

      this.options.onTaskComplete(task, result);
      return result;
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
      throw err;
    }
  }

  // ========================================================================
  // Conditional Branching
  // ========================================================================

  private async determineNextStep(
    currentStep: RitualTaskV2,
    result: StepResult,
    ritual: RitualV2
  ): Promise<string> {
    // Check if there's a condition for this step
    const condition = ritual.conditions.find((c) => c.from === currentStep.type);

    if (!condition) {
      // No condition, go to next sequential step
      return this.getNextSequentialStep(currentStep, ritual);
    }

    // Evaluate condition
    const context: ConditionContext = {
      stepResults: this.stepResults,
      currentStepId: currentStep.type,
      userQuery: ritual.goal,
      accumulatedOutput: this.buildAccumulatedOutput(ritual),
    };

    const evaluationResult = await this.conditionEngine.evaluate(
      condition,
      context
    );

    ritual.metadata.conditionEvaluations++;
    ritual.conditionResults.set(condition.id, {
      outcome: evaluationResult.outcome,
      timestamp: Date.now(),
    });

    // Notify listeners
    const trace = this.conditionEngine.getTraces().pop();
    if (trace) {
      this.options.onConditionEvaluated(trace, ritual);
    }

    return evaluationResult.outcome === 'then' ? condition.then : condition.else;
  }

  private getNextSequentialStep(
    currentStep: RitualTaskV2,
    ritual: RitualV2
  ): string {
    const currentIndex = ritual.tasks.findIndex((t) => t.id === currentStep.id);
    if (currentIndex < 0 || currentIndex >= ritual.tasks.length - 1) {
      return 'complete';
    }
    return ritual.tasks[currentIndex + 1].type;
  }

  private getFirstStep(ritual: RitualV2): RitualTaskV2 | undefined {
    // Find the first task that has no dependencies
    const firstTask = ritual.tasks.find(
      (t) => !t.dependsOn || t.dependsOn.length === 0
    );
    return firstTask || ritual.tasks[0];
  }

  // ========================================================================
  // Utilities
  // ========================================================================

  private getDependencyOutputs(
    task: RitualTaskV2,
    allTasks: RitualTaskV2[]
  ): Record<string, unknown> {
    if (!task.dependsOn) return {};

    const outputs: Record<string, unknown> = {};
    for (const depId of task.dependsOn) {
      const dep = allTasks.find((t) => t.id === depId);
      if (dep?.output) {
        outputs[dep.type] = dep.output;
      }
    }
    return outputs;
  }

  private buildAccumulatedOutput(ritual: RitualV2): string {
    const outputs: string[] = [];
    for (const stepId of ritual.executionPath) {
      const stepResult = this.stepResults.get(stepId);
      if (stepResult?.output) {
        const outputStr =
          typeof stepResult.output === 'string'
            ? stepResult.output
            : JSON.stringify(stepResult.output);
        outputs.push(`Step ${stepId}:\n${outputStr.slice(0, 500)}`);
      }
    }
    return outputs.join('\n\n---\n\n');
  }

  private buildFinalOutput(ritual: RitualV2): unknown {
    // Find the last completed step's output
    for (let i = ritual.executionPath.length - 1; i >= 0; i--) {
      const stepId = ritual.executionPath[i];
      const stepResult = this.stepResults.get(stepId);
      if (stepResult?.success) {
        return stepResult.output;
      }
    }
    return undefined;
  }

  private createTask(plan: RitualPlanV2['tasks'][0]): RitualTaskV2 {
    const complexityLevels: Record<string, TaskComplexity> = {
      trivial: { level: 'trivial', estimatedTokens: 1000, requiredTools: [] },
      simple: { level: 'simple', estimatedTokens: 4000, requiredTools: [] },
      moderate: { level: 'moderate', estimatedTokens: 8000, requiredTools: [] },
      complex: { level: 'complex', estimatedTokens: 16000, requiredTools: [] },
      deep: { level: 'deep', estimatedTokens: 32000, requiredTools: [] },
    };

    return {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: plan.type,
      description: plan.description,
      complexity: complexityLevels[plan.complexity] || complexityLevels.moderate,
      status: 'pending',
      dependsOn: plan.dependsOn,
      input: {},
      mutations: [],
      iterationCount: 0,
    };
  }

  private async saveCheckpoint(ritual: RitualV2): Promise<void> {
    const completedTasks = ritual.tasks
      .filter((t) => t.status === 'completed')
      .map((t) => t.id);

    const pendingTasks = ritual.tasks
      .filter((t) => t.status === 'pending')
      .map((t) => t.id);

    const checkpoint: Checkpoint = {
      ritualId: ritual.id,
      checkpointId: `chk-${Date.now()}`,
      createdAt: Date.now(),
      state: {
        ...ritual.context.getState(),
        executionPath: ritual.executionPath,
        conditionResults: Object.fromEntries(ritual.conditionResults),
      },
      mutations: ritual.context.getMutations(),
      completedTasks,
      pendingTasks,
      version: '2.1.0', // Condition support
    };

    await this.checkpointManager.save(checkpoint);
    this.options.onCheckpoint(checkpoint);
  }

  private calculateCost(result: SubAgentResult): number {
    const rates: Record<string, number> = {
      claude: 0.008,
      codex: 0.003,
      kimi: 0.005,
      opencode: 0.001,
    };

    const rate = rates[result.agentType] || 0.005;
    return (result.metrics.tokensUsed / 1000) * rate;
  }

  private calculateEstimatedCost(
    agentType: IDEType,
    estimatedTokens: number
  ): number {
    const rates: Record<string, number> = {
      claude: 0.008,
      codex: 0.003,
      kimi: 0.005,
      opencode: 0.001,
    };
    const rate = rates[agentType] || 0.005;
    return (estimatedTokens / 1000) * rate;
  }

  // ========================================================================
  // Public API
  // ========================================================================

  getRitual(ritualId: string): RitualV2 | undefined {
    return this.rituals.get(ritualId);
  }

  listRituals(): RitualV2[] {
    return Array.from(this.rituals.values());
  }

  getTraces(): ConditionTrace[] {
    return this.conditionEngine.getTraces();
  }

  getMermaidDiagram(ritualId: string): string | null {
    const ritual = this.rituals.get(ritualId);
    if (!ritual) return null;
    return this.conditionEngine.exportMermaidDiagram(ritual.conditions);
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createRitualEngineV2(options?: RitualOptionsV2): RitualEngineV2 {
  return new RitualEngineV2(options);
}
