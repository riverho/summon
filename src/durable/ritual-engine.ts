// Ritual Engine — Durable Execution Orchestrator
// Combines AgentPool + ContextManager + CheckpointManager for immortal goals

import { 
  AgentPool, 
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
}

export interface RitualPlan {
  goal: string;
  tasks: Array<{
    type: string;
    description: string;
    complexity: TaskComplexity['level'];
    dependsOn?: string[];
  }>;
}

export interface RitualOptions {
  checkpointDir?: string;
  autoCheckpointInterval?: number;
  maxConcurrentTasks?: number;
  defaultTaskTimeout?: number;
  onTaskComplete?: (task: RitualTask, result: SubAgentResult) => void;
  onCheckpoint?: (checkpoint: Checkpoint) => void;
}

// ============================================================================
// Ritual Engine
// ============================================================================

export class RitualEngine {
  private pool: AgentPool;
  private checkpointManager: CheckpointManager;
  private metricsCollector: MetricsCollector;
  private rituals: Map<string, Ritual> = new Map();
  private options: Required<RitualOptions>;
  
  constructor(options: RitualOptions = {}) {
    this.options = {
      checkpointDir: options.checkpointDir || path.join(os.homedir(), '.summon', 'rituals'),
      autoCheckpointInterval: options.autoCheckpointInterval || 60000,
      maxConcurrentTasks: options.maxConcurrentTasks || 5,
      defaultTaskTimeout: options.defaultTaskTimeout || 300000,
      onTaskComplete: options.onTaskComplete || (() => {}),
      onCheckpoint: options.onCheckpoint || (() => {})
    };
    
    this.pool = new AgentPool({
      onRoutingDecision: (decision) => {
        this.metricsCollector.recordRouting({
          timestamp: Date.now(),
          taskId: decision.taskId,
          ritualId: '', // Would need to track this better
          complexity: decision.complexity,
          routedTo: decision.routedTo,
          reason: decision.reason,
          estimatedCost: this.calculateEstimatedCost(decision.routedTo, decision.complexity.estimatedTokens)
        });
      }
    });
    this.checkpointManager = new CheckpointManager(this.options.checkpointDir);
    this.metricsCollector = new MetricsCollector(path.join(os.homedir(), '.summon', 'metrics'));
  }
  
  // ========================================================================
  // Ritual Lifecycle
  // ========================================================================
  
  async createRitual(goal: string, plan?: RitualPlan): Promise<Ritual> {
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
        estimatedCost: 0
      }
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
          task.dependsOn = task.dependsOn.map(depType => {
            const depId = typeToId.get(depType);
            if (!depId) {
              console.warn(`Warning: Dependency '${depType}' not found for task '${task.type}'`);
            }
            return depId || depType; // Fallback to original if not found
          }).filter(Boolean) as string[];
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
    
    // Start metrics tracking
    this.metricsCollector.startRitual(ritual);
    
    try {
      await this.executeRitual(ritual);
      this.metricsCollector.completeRitual(ritualId, 'completed');
    } catch (err) {
      this.metricsCollector.completeRitual(ritualId, 'failed');
      throw err;
    }
  }
  
  async resumeRitual(ritualId: string): Promise<void> {
    const checkpoint = this.checkpointManager.load(ritualId);
    if (!checkpoint) throw new Error(`No checkpoint found for ritual: ${ritualId}`);
    
    const ritual = this.rituals.get(ritualId) || await this.createRitual(checkpoint.state.goal as string);
    
    ritual.state = 'running';
    ritual.context = new ContextManager(checkpoint.state);
    
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
  }
  
  getRitual(ritualId: string): Ritual | undefined {
    return this.rituals.get(ritualId);
  }
  
  listRituals(): Ritual[] {
    return Array.from(this.rituals.values());
  }
  
  // ========================================================================
  // Task Execution
  // ========================================================================
  
  private async executeRitual(ritual: Ritual): Promise<void> {
    const pendingTasks = ritual.tasks.filter(t => t.status === 'pending');
    
    while (pendingTasks.length > 0) {
      const readyTasks = pendingTasks.filter(t => this.isReady(t, ritual.tasks));
      
      if (readyTasks.length === 0) {
        throw new Error('No tasks ready to execute');
      }
      
      const batch = readyTasks.slice(0, this.options.maxConcurrentTasks);
      await Promise.all(batch.map(task => this.executeTask(task, ritual)));
      await this.saveCheckpoint(ritual);
      
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
    
    const microTask: MicroTask = {
      type: task.type,
      description: task.description,
      input: task.input,
      timeoutMs: this.options.defaultTaskTimeout,
      producesMutations: true
    };
    
    const depOutputs = this.getDependencyOutputs(task, ritual.tasks);
    microTask.input = {
      ...task.input as object,
      context: depOutputs
    };
    
    try {
      const result = await this.pool.spawnSubAgent(microTask, task.complexity, ritual.id, task.id);
      
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
        
        // Record task metrics
        this.metricsCollector.recordTaskComplete(task, result);
      } else {
        task.status = 'failed';
        task.error = result.error?.message || 'Unknown error';
        
        // Record failed task metrics too
        this.metricsCollector.recordTaskComplete(task, result);
      }
      
      this.options.onTaskComplete(task, result);
      
    } catch (err: any) {
      task.status = 'failed';
      task.error = err.message;
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
  
  private getDependencyOutputs(task: RitualTask, allTasks: RitualTask[]): Record<string, unknown> {
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
  
  private createTask(plan: RitualPlan['tasks'][0]): RitualTask {
    const complexityLevels: Record<string, TaskComplexity> = {
      trivial: { level: 'trivial', estimatedTokens: 1000, requiredTools: [] },
      simple: { level: 'simple', estimatedTokens: 4000, requiredTools: [] },
      moderate: { level: 'moderate', estimatedTokens: 8000, requiredTools: [] },
      complex: { level: 'complex', estimatedTokens: 16000, requiredTools: [] },
      deep: { level: 'deep', estimatedTokens: 32000, requiredTools: [] }
    };
    
    return {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      type: plan.type,
      description: plan.description,
      complexity: complexityLevels[plan.complexity] || complexityLevels.moderate,
      status: 'pending',
      dependsOn: plan.dependsOn,
      input: {},
      mutations: []
    };
  }
  
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
      version: '2.0.0'
    };
    
    await this.checkpointManager.save(checkpoint);
    this.options.onCheckpoint(checkpoint);
  }
  
  private calculateCost(result: SubAgentResult): number {
    const rates: Record<string, number> = {
      claude: 0.008,
      codex: 0.003,
      kimi: 0.005,
      opencode: 0.001
    };
    
    const rate = rates[result.agentType] || 0.005;
    return (result.metrics.tokensUsed / 1000) * rate;
  }
  
  private calculateEstimatedCost(agentType: IDEType, estimatedTokens: number): number {
    const rates: Record<string, number> = {
      claude: 0.008,
      codex: 0.003,
      kimi: 0.005,
      opencode: 0.001
    };
    const rate = rates[agentType] || 0.005;
    return (estimatedTokens / 1000) * rate;
  }
  
  getRitualStats(ritualId: string): {
    totalTasks: number;
    completed: number;
    failed: number;
    pending: number;
    progress: number;
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
      progress: total > 0 ? completed / total : 0
    };
  }
}

export function createRitualEngine(options?: RitualOptions): RitualEngine {
  return new RitualEngine(options);
}
