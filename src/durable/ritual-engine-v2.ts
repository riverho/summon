// Ritual Engine v2 — Integrated with AgentFactory + CreditSystem
// Full pay tier support, real OpenClaw spawning, and cost tracking

import {
  AgentFactory,
  UserTier,
  ProvisionDecision,
  SpawnEvent,
  CompleteEvent
} from '../factory/index.js';
import { CreditSystem } from '../billing/index.js';
import {
  ContextManager,
  CheckpointManager
} from './index.js';
import {
  MicroTask,
  TaskComplexity,
  SubAgentResult,
  StateMutation,
  Checkpoint,
  IDEType
} from './types.js';
import { MetricsCollector } from '../observability/collector.js';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// Types
// ============================================================================

export interface Ritual {
  id: string;
  goal: string;
  state: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  context: ContextManager;
  tasks: RitualTask[];
  metadata: {
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
    totalTokensUsed: number;
    estimatedCost: number;
    actualCost: number;
    userId: string;
    tier: UserTier;
  };
}

export interface RitualTask {
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
  estimatedCost: number;
  actualCost: number;
}

export interface RitualPlan {
  goal: string;
  tasks: Array<{
    type: string;
    description: string;
    complexity: TaskComplexity['level'];
    dependsOn?: string[];
    estimatedTokens?: number;
  }>;
}

export interface RitualOptions {
  checkpointDir?: string;
  autoCheckpointInterval?: number;
  maxConcurrentTasks?: number;
  defaultTaskTimeout?: number;
  onTaskComplete?: (task: RitualTask, result: SubAgentResult) => void;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
  onCostUpdate?: (ritualId: string, actualCost: number, remainingCredits: number) => void;
}

// ============================================================================
// Ritual Engine v2
// ============================================================================

export class RitualEngineV2 {
  private factory: AgentFactory;
  private creditSystem: CreditSystem;
  private checkpointManager: CheckpointManager;
  private metricsCollector: MetricsCollector;
  private rituals: Map<string, Ritual> = new Map();
  private options: Required<RitualOptions>;

  constructor(
    factory: AgentFactory,
    creditSystem: CreditSystem,
    options: RitualOptions = {}
  ) {
    this.factory = factory;
    this.creditSystem = creditSystem;
    this.options = {
      checkpointDir: options.checkpointDir || path.join(os.homedir(), '.summon', 'rituals'),
      autoCheckpointInterval: options.autoCheckpointInterval || 60000,
      maxConcurrentTasks: options.maxConcurrentTasks || 5,
      defaultTaskTimeout: options.defaultTaskTimeout || 300000,
      onTaskComplete: options.onTaskComplete || (() => {}),
      onCheckpoint: options.onCheckpoint || (() => {}),
      onCostUpdate: options.onCostUpdate || (() => {})
    };

    this.checkpointManager = new CheckpointManager(this.options.checkpointDir);
    this.metricsCollector = new MetricsCollector(path.join(os.homedir(), '.summon', 'metrics'));

    // Wire up factory events
    this.factory = new AgentFactory({
      tier: creditSystem.getTier(),
      creditBalance: creditSystem.getBalance(),
      onProvision: (decision) => this.handleProvisionDecision(decision),
      onSpawn: (event) => this.handleSpawnEvent(event),
      onComplete: (event) => this.handleCompleteEvent(event)
    });
  }

  // =======================================================================
  // Ritual Lifecycle
  // =======================================================================

  async createRitual(
    goal: string,
    userId: string,
    plan?: RitualPlan
  ): Promise<Ritual> {
    const id = `ritual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const ritual: Ritual = {
      id,
      goal,
      state: 'pending',
      context: new ContextManager({ goal }),
      tasks: [],
      metadata: {
        createdAt: Date.now(),
        totalTokensUsed: 0,
        estimatedCost: 0,
        actualCost: 0,
        userId,
        tier: this.creditSystem.getTier()
      }
    };

    if (plan) {
      // Calculate total estimated cost
      let totalEstimated = 0;

      for (const taskPlan of plan.tasks) {
        const task = this.createTask(taskPlan);
        ritual.tasks.push(task);
        totalEstimated += task.estimatedCost;
      }

      ritual.metadata.estimatedCost = totalEstimated;

      // Map dependencies
      const typeToId = new Map<string, string>();
      for (const task of ritual.tasks) {
        typeToId.set(task.type, task.id);
      }

      for (const task of ritual.tasks) {
        const planTask = plan.tasks.find(t => t.type === task.type);
        if (planTask?.dependsOn) {
          task.dependsOn = planTask.dependsOn
            .map(depType => typeToId.get(depType))
            .filter((id): id is string => !!id);
        }
      }

      // Check if user has enough credits (free tier only)
      const tier = this.creditSystem.getTier();
      if (tier === 'free') {
        const balance = this.creditSystem.getBalance();
        if (balance < totalEstimated) {
          console.warn(`⚠️  Warning: Estimated cost ($${totalEstimated.toFixed(2)}) exceeds balance ($${balance.toFixed(2)})`);
          console.warn(`   Ritual may fail mid-execution. Consider upgrading to paid tier.`);
        }
      }
    }

    this.rituals.set(id, ritual);
    return ritual;
  }

  async startRitual(ritualId: string): Promise<void> {
    const ritual = this.rituals.get(ritualId);
    if (!ritual) throw new Error(`Ritual not found: ${ritualId}`);

    ritual.state = 'running';
    ritual.metadata.startedAt = Date.now();

    // Update factory with current credit balance
    this.factory = new AgentFactory({
      tier: this.creditSystem.getTier(),
      creditBalance: this.creditSystem.getBalance(),
      onProvision: (decision) => this.handleProvisionDecision(decision),
      onSpawn: (event) => this.handleSpawnEvent(event),
      onComplete: (event) => this.handleCompleteEvent(event)
    });

    this.metricsCollector.startRitual(ritual);

    try {
      await this.executeRitual(ritual);
      this.metricsCollector.completeRitual(ritualId, 'completed');
      console.log(`\n✅ Ritual completed: ${ritualId}`);
      console.log(`   Total cost: $${ritual.metadata.actualCost.toFixed(4)}`);
      console.log(`   Remaining credits: $${this.creditSystem.getBalance().toFixed(2)}`);
    } catch (err) {
      this.metricsCollector.completeRitual(ritualId, 'failed');
      console.error(`\n❌ Ritual failed: ${ritualId}`);
      throw err;
    }
  }

  async resumeRitual(ritualId: string): Promise<void> {
    const checkpoint = this.checkpointManager.load(ritualId);
    if (!checkpoint) throw new Error(`No checkpoint found for ritual: ${ritualId}`);

    const ritual = this.rituals.get(ritualId) || await this.createRitual(
      checkpoint.state.goal as string,
      'resumed-user'
    );

    ritual.state = 'running';
    ritual.context = new ContextManager(checkpoint.state);

    // Restore task states
    for (const taskId of checkpoint.completedTasks) {
      const task = ritual.tasks.find(t => t.id === taskId);
      if (task) task.status = 'completed';
    }

    for (const mutation of checkpoint.mutations) {
      ritual.context.applyMutations([mutation], mutation.agentId);
    }

    await this.executeRitual(ritual);
  }

  async pauseRitual(ritualId: string): Promise<void> {
    const ritual = this.rituals.get(ritualId);
    if (!ritual) return;

    ritual.state = 'paused';
    await this.saveCheckpoint(ritual);
    console.log(`⏸️  Ritual paused: ${ritualId}`);
  }

  getRitual(ritualId: string): Ritual | undefined {
    return this.rituals.get(ritualId);
  }

  listRituals(): Ritual[] {
    return Array.from(this.rituals.values());
  }

  // =======================================================================
  // Task Execution
  // =======================================================================

  private async executeRitual(ritual: Ritual): Promise<void> {
    const pendingTasks = ritual.tasks.filter(t => t.status === 'pending');

    while (pendingTasks.length > 0) {
      const readyTasks = pendingTasks.filter(t => this.isReady(t, ritual.tasks));

      if (readyTasks.length === 0) {
        throw new Error('Deadlock: No tasks ready to execute');
      }

      const batch = readyTasks.slice(0, this.options.maxConcurrentTasks);
      await Promise.all(batch.map(task => this.executeTask(task, ritual)));

      // Save checkpoint after each batch
      await this.saveCheckpoint(ritual);

      // Update cost tracking
      this.options.onCostUpdate(
        ritual.id,
        ritual.metadata.actualCost,
        this.creditSystem.getBalance()
      );

      // Refresh pending list
      pendingTasks.length = 0;
      pendingTasks.push(...ritual.tasks.filter(t => t.status === 'pending'));
    }

    ritual.state = 'completed';
    ritual.metadata.completedAt = Date.now();
    await this.saveCheckpoint(ritual);
  }

  private async executeTask(task: RitualTask, ritual: Ritual): Promise<void> {
    task.status = 'running';
    task.startedAt = Date.now();

    // Check credits before execution
    const tier = this.creditSystem.getTier();
    if (tier === 'free') {
      const balance = this.creditSystem.getBalance();
      if (balance < task.estimatedCost) {
        task.status = 'failed';
        task.error = `Insufficient credits: $${balance.toFixed(2)} < $${task.estimatedCost.toFixed(2)}`;
        task.completedAt = Date.now();
        return;
      }
    }

    const microTask: MicroTask = {
      type: task.type,
      description: task.description,
      input: task.input,
      timeoutMs: this.options.defaultTaskTimeout,
      producesMutations: true
    };

    // Add dependency outputs to input
    const depOutputs = this.getDependencyOutputs(task, ritual.tasks);
    microTask.input = {
      ...task.input as object,
      context: depOutputs
    };

    try {
      const result = await this.factory.spawnSubAgent(
        microTask,
        task.complexity,
        ritual.id
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

        // Update ritual metadata
        ritual.metadata.totalTokensUsed += result.metrics.tokensUsed;
        const actualCost = this.creditSystem.calculateActualCost(
          result.agentType,
          result.metrics.tokensUsed
        );
        task.actualCost = actualCost;
        ritual.metadata.actualCost += actualCost;

        // Deduct credits
        await this.creditSystem.deduct(actualCost, {
          ritualId: ritual.id,
          taskId: task.id,
          agentType: result.agentType,
          description: `Task ${task.type} via ${result.agentType}`
        });

        this.metricsCollector.recordTaskComplete(task, result);
      } else {
        task.status = 'failed';
        task.error = result.error?.message || 'Unknown error';

        // Refund estimated cost on failure (free tier only)
        if (tier === 'free' && task.estimatedCost > 0) {
          await this.creditSystem.refund(task.estimatedCost, {
            ritualId: ritual.id,
            taskId: task.id,
            reason: `Task failed: ${task.error}`
          });
        }

        this.metricsCollector.recordTaskComplete(task, result);
      }

      this.options.onTaskComplete(task, result);

    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
      task.completedAt = Date.now();

      // Refund on exception too
      if (tier === 'free' && task.estimatedCost > 0) {
        await this.creditSystem.refund(task.estimatedCost, {
          ritualId: ritual.id,
          taskId: task.id,
          reason: `Task exception: ${err.message}`
        });
      }
    }
  }

  private isReady(task: RitualTask, allTasks: RitualTask[]): boolean {
    if (task.status !== 'pending') return false;
    if (!task.dependsOn || task.dependsOn.length === 0) return true;

    return task.dependsOn.every(depId => {
      const dep = allTasks.find(t => t.id === depId);
      return dep?.status === 'completed';
    });
  }

  private getDependencyOutputs(
    task: RitualTask,
    allTasks: RitualTask[]
  ): Record<string, unknown> {
    if (!task.dependsOn) return {};

    const outputs: Record<string, unknown> = {};
    for (const depId of task.dependsOn) {
      const dep = allTasks.find(t => t.id === depId);
      if (dep?.output) {
        outputs[dep.type] = dep.output;
      }
    }
    return outputs;
  }

  // =======================================================================
  // Checkpointing
  // =======================================================================

  private async saveCheckpoint(ritual: Ritual): Promise<void> {
    const completedTasks = ritual.tasks
      .filter(t => t.status === 'completed')
      .map(t => t.id);

    const pendingTasks = ritual.tasks
      .filter(t => t.status === 'pending')
      .map(t => t.id);

    const checkpoint: Checkpoint = {
      ritualId: ritual.id,
      checkpointId: `chk-${Date.now()}`,
      createdAt: Date.now(),
      state: ritual.context.getState(),
      mutations: ritual.context.getMutations(),
      completedTasks,
      pendingTasks,
      version: '2.1.0'
    };

    await this.checkpointManager.save(checkpoint);
    this.options.onCheckpoint(checkpoint);
  }

  // =======================================================================
  // Event Handlers
  // =======================================================================

  private handleProvisionDecision(decision: ProvisionDecision): void {
    if (!decision.canProceed) {
      console.log(`🚫 Task ${decision.taskId}: ${decision.reason}`);
    }
  }

  private handleSpawnEvent(event: SpawnEvent): void {
    console.log(`🚀 Spawned ${event.agentType} for task ${event.taskId}`);
  }

  private handleCompleteEvent(event: CompleteEvent): void {
    const emoji = event.success ? '✅' : '❌';
    console.log(`${emoji} Task ${event.taskId} ${event.success ? 'completed' : 'failed'} ($${event.actualCost.toFixed(4)})`);
  }

  // =======================================================================
  // Task Factory
  // =======================================================================

  private createTask(
    plan: RitualPlan['tasks'][0]
  ): RitualTask {
    const complexityLevels: Record<string, TaskComplexity> = {
      trivial: { level: 'trivial', estimatedTokens: 1000, requiredTools: [] },
      simple: { level: 'simple', estimatedTokens: 4000, requiredTools: [] },
      moderate: { level: 'moderate', estimatedTokens: 8000, requiredTools: [] },
      complex: { level: 'complex', estimatedTokens: 16000, requiredTools: [] },
      deep: { level: 'deep', estimatedTokens: 32000, requiredTools: [] }
    };

    const complexity = complexityLevels[plan.complexity] || complexityLevels.moderate;

    // Estimate cost based on default routing
    const estimatedCost = this.creditSystem.calculateEstimatedCost(
      this.getDefaultAgentForComplexity(complexity.level),
      plan.estimatedTokens || complexity.estimatedTokens
    );

    return {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: plan.type,
      description: plan.description,
      complexity,
      status: 'pending',
      dependsOn: plan.dependsOn,
      input: {},
      mutations: [],
      estimatedCost,
      actualCost: 0
    };
  }

  private getDefaultAgentForComplexity(level: string): IDEType {
    switch (level) {
      case 'trivial':
      case 'simple':
        return 'codex';
      case 'moderate':
        return 'kimi';
      case 'complex':
      case 'deep':
        return 'claude';
      default:
        return 'codex';
    }
  }

  // =======================================================================
  // Stats
  // =======================================================================

  getRitualStats(ritualId: string): {
    totalTasks: number;
    completed: number;
    failed: number;
    pending: number;
    progress: number;
    estimatedCost: number;
    actualCost: number;
    savings: number;
  } | null {
    const ritual = this.rituals.get(ritualId);
    if (!ritual) return null;

    const total = ritual.tasks.length;
    const completed = ritual.tasks.filter(t => t.status === 'completed').length;
    const failed = ritual.tasks.filter(t => t.status === 'failed').length;
    const pending = ritual.tasks.filter(t => t.status === 'pending').length;

    return {
      totalTasks: total,
      completed,
      failed,
      pending,
      progress: total > 0 ? completed / total : 0,
      estimatedCost: ritual.metadata.estimatedCost,
      actualCost: ritual.metadata.actualCost,
      savings: ritual.metadata.estimatedCost - ritual.metadata.actualCost
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createRitualEngineV2(
  userId: string,
  options?: RitualOptions
): Promise<RitualEngineV2> {
  const creditSystem = await (await import('../billing/index.js')).getCreditSystem(userId);
  const factory = await (await import('../factory/index.js')).createAgentFactory(
    creditSystem.getTier(),
    {
      creditBalance: creditSystem.getBalance()
    }
  );

  return new RitualEngineV2(factory, creditSystem, options);
}
