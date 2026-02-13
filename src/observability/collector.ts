// Observability — Ritual Metrics, Cost Tracking & Audit Trails
// AO Stress Test #2: See First, Automate Second

import { Ritual, RitualTask, SubAgentResult, IDEType } from '../durable/index.js';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Metric Types
// ============================================================================

export interface RitualMetrics {
  ritualId: string;
  goal: string;
  startedAt: number;
  completedAt?: number;
  durationMs: number;
  state: 'completed' | 'failed' | 'paused';
  
  // Task breakdown
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  
  // Cost analysis
  totalTokens: number;
  estimatedCost: number;
  costPerTask: number;
  
  // Agent usage
  agentCalls: Record<IDEType, number>;
  tokensByAgent: Record<IDEType, number>;
  costByAgent: Record<IDEType, number>;
  
  // Performance
  avgTaskDurationMs: number;
  maxTaskDurationMs: number;
  minTaskDurationMs: number;
  
  // Checkpoint stats
  checkpointsCreated: number;
  recoveryCount: number;
  
  // Sub-agent lifecycle (NEW)
  subAgentsSpawned: number;
  subAgentsCompleted: number;
  subAgentsFailed: number;
  subAgentsRetried: number;
  totalRetries: number;
}

export interface TaskMetrics {
  taskId: string;
  ritualId: string;
  type: string;
  complexity: string;
  agentType: IDEType;
  
  // Timing
  startedAt: number;
  completedAt: number;
  durationMs: number;
  queueTimeMs: number; // Time waiting for dependencies
  
  // Cost
  tokensUsed: number;
  estimatedCost: number;
  
  // Result
  success: boolean;
  errorCode?: string;
  retryCount: number;
  
  // Context
  inputSize: number; // chars
  outputSize: number; // chars
  mutationCount: number;
}

export interface RoutingDecision {
  timestamp: number;
  taskId: string;
  ritualId: string;
  complexity: {
    level: string;
    estimatedTokens: number;
    requiredTools: string[];
  };
  routedTo: IDEType;
  reason: string;
  estimatedCost: number;
  actualCost?: number;
  accuracy?: 'correct' | 'overkill' | 'underpowered'; // Post-hoc analysis
}

export interface CheckpointEvent {
  timestamp: number;
  ritualId: string;
  checkpointId: string;
  event: 'created' | 'loaded' | 'failed' | 'corrupted';
  sizeBytes: number;
  taskCount: number;
  mutationCount: number;
  durationMs: number; // Time to save/load
}

// ============================================================================
// Sub-Agent Lifecycle Events (NEW)
// ============================================================================

export interface SubAgentLifecycleEvent {
  timestamp: number;
  ritualId: string;
  taskId: string;
  agentType: IDEType;
  event: 'spawned' | 'completed' | 'failed' | 'retry';
  sessionId?: string;
  errorCode?: string;
  retryCount: number;
  durationMs?: number;
  tokensUsed?: number;
}

export interface SubAgentPoolStats {
  activeAgents: number;
  idleAgents: number;
  queuedTasks: number;
  totalSpawned: number;
  totalCompleted: number;
  totalFailed: number;
  totalRetries: number;
  byAgentType: Record<IDEType, {
    spawned: number;
    completed: number;
    failed: number;
    avgDurationMs: number;
  }>;
}

// ============================================================================
// Metrics Collector
// ============================================================================

export class MetricsCollector {
  private ritualMetrics: Map<string, Partial<RitualMetrics>> = new Map();
  private taskMetrics: TaskMetrics[] = [];
  private routingDecisions: RoutingDecision[] = [];
  private checkpointEvents: CheckpointEvent[] = [];
  private subAgentEvents: SubAgentLifecycleEvent[] = [];
  private outputDir: string;
  
  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.ensureDir();
  }
  
  private ensureDir(): void {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }
  
  // ========================================================================
  // Ritual Lifecycle
  // ========================================================================
  
  startRitual(ritual: Ritual): void {
    this.ritualMetrics.set(ritual.id, {
      ritualId: ritual.id,
      goal: ritual.goal,
      startedAt: Date.now(),
      state: 'completed',
      totalTasks: ritual.tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      totalTokens: 0,
      estimatedCost: 0,
      agentCalls: { claude: 0, codex: 0, kimi: 0, opencode: 0 },
      tokensByAgent: { claude: 0, codex: 0, kimi: 0, opencode: 0 },
      costByAgent: { claude: 0, codex: 0, kimi: 0, opencode: 0 },
      avgTaskDurationMs: 0,
      maxTaskDurationMs: 0,
      minTaskDurationMs: Infinity,
      checkpointsCreated: 0,
      recoveryCount: 0,
      durationMs: 0,
      // Sub-agent lifecycle (NEW)
      subAgentsSpawned: 0,
      subAgentsCompleted: 0,
      subAgentsFailed: 0,
      subAgentsRetried: 0,
      totalRetries: 0
    });
  }
  
  completeRitual(ritualId: string, state: 'completed' | 'failed' | 'paused'): void {
    const metrics = this.ritualMetrics.get(ritualId);
    if (!metrics) return;
    
    metrics.completedAt = Date.now();
    metrics.durationMs = metrics.completedAt - (metrics.startedAt || 0);
    metrics.state = state;
    
    // Calculate averages
    const taskDurations = this.taskMetrics
      .filter(t => t.ritualId === ritualId)
      .map(t => t.durationMs);
    
    if (taskDurations.length > 0) {
      metrics.avgTaskDurationMs = taskDurations.reduce((a, b) => a + b, 0) / taskDurations.length;
      metrics.maxTaskDurationMs = Math.max(...taskDurations);
      metrics.minTaskDurationMs = Math.min(...taskDurations);
    }
    
    metrics.costPerTask = (metrics.totalTasks || 0) > 0 ? (metrics.estimatedCost || 0) / (metrics.totalTasks || 1) : 0;
    
    // Persist immediately
    this.persist();
  }
  
  // ========================================================================
  // Task Events
  // ========================================================================
  
  recordTaskComplete(task: RitualTask, result: SubAgentResult): void {
    const ritualMetrics = this.ritualMetrics.get(task.id.split('-')[0] + '-' + task.id.split('-')[1]);
    
    // Find ritual ID from task ID pattern
    const ritualId = this.findRitualIdForTask(task.id);
    
    const taskMetric: TaskMetrics = {
      taskId: task.id,
      ritualId: ritualId || 'unknown',
      type: task.type,
      complexity: task.complexity.level,
      agentType: result.agentType as IDEType,
      startedAt: task.startedAt || 0,
      completedAt: task.completedAt || Date.now(),
      durationMs: (task.completedAt || Date.now()) - (task.startedAt || 0),
      queueTimeMs: 0, // Would need queue start time
      tokensUsed: result.metrics.tokensUsed,
      estimatedCost: this.calculateCost(result),
      success: result.success,
      errorCode: result.error?.code,
      retryCount: 0,
      inputSize: JSON.stringify(task.input).length,
      outputSize: JSON.stringify(task.output).length,
      mutationCount: task.mutations.length
    };
    
    this.taskMetrics.push(taskMetric);
    
    // Update ritual aggregates
    if (ritualMetrics) {
      ritualMetrics.totalTokens = (ritualMetrics.totalTokens || 0) + result.metrics.tokensUsed;
      ritualMetrics.estimatedCost = (ritualMetrics.estimatedCost || 0) + taskMetric.estimatedCost;
      
      if (result.success) {
        ritualMetrics.completedTasks = (ritualMetrics.completedTasks || 0) + 1;
      } else {
        ritualMetrics.failedTasks = (ritualMetrics.failedTasks || 0) + 1;
      }
      
      const agent = result.agentType as IDEType;
      ritualMetrics.agentCalls![agent] = (ritualMetrics.agentCalls![agent] || 0) + 1;
      ritualMetrics.tokensByAgent![agent] = (ritualMetrics.tokensByAgent![agent] || 0) + result.metrics.tokensUsed;
      ritualMetrics.costByAgent![agent] = (ritualMetrics.costByAgent![agent] || 0) + taskMetric.estimatedCost;
    }
  }
  
  // ========================================================================
  // Routing Audit
  // ========================================================================
  
  recordRouting(decision: RoutingDecision): void {
    this.routingDecisions.push(decision);
  }
  
  analyzeRoutingAccuracy(): RoutingAccuracyReport {
    const analyzed = this.routingDecisions.map(d => {
      // Post-hoc analysis: was the routing correct?
      const task = this.taskMetrics.find(t => t.taskId === d.taskId);
      if (!task) return { ...d, accuracy: undefined };
      
      const estimatedDuration = this.getExpectedDuration(d.complexity.level);
      const actualDuration = task.durationMs;
      
      // Overkill: expensive agent for simple task
      // Underpowered: cheap agent struggling with complex task (retries, long duration)
      let accuracy: 'correct' | 'overkill' | 'underpowered' = 'correct';
      
      if (d.routedTo === 'claude' && d.complexity.level === 'trivial') {
        accuracy = 'overkill';
      } else if (d.routedTo === 'codex' && d.complexity.level === 'deep') {
        accuracy = 'underpowered';
      } else if (actualDuration > estimatedDuration * 3) {
        accuracy = 'underpowered'; // Took way longer than expected
      }
      
      return { ...d, accuracy, actualCost: task.estimatedCost };
    });
    
    const total = analyzed.length;
    const correct = analyzed.filter(d => d.accuracy === 'correct').length;
    const overkill = analyzed.filter(d => d.accuracy === 'overkill').length;
    const underpowered = analyzed.filter(d => d.accuracy === 'underpowered').length;
    
    const wastedCost = analyzed
      .filter(d => d.accuracy === 'overkill')
      .reduce((sum, d) => sum + (d.actualCost || 0) * 0.5, 0); // 50% of overkill cost is waste
    
    return {
      total,
      correct,
      overkill,
      underpowered,
      accuracyRate: total > 0 ? correct / total : 0,
      wastedCost,
      recommendations: this.generateRoutingRecommendations(analyzed)
    };
  }
  
  private generateRoutingRecommendations(analyzed: Array<RoutingDecision & { accuracy?: string; actualCost?: number }>): string[] {
    const recs: string[] = [];
    
    const overkillPatterns = analyzed.filter(d => d.accuracy === 'overkill');
    if (overkillPatterns.length > 3) {
      recs.push(`Consider routing '${overkillPatterns[0].complexity.level}' tasks to cheaper agents (potential savings: ~50%)`);
    }
    
    const underpoweredPatterns = analyzed.filter(d => d.accuracy === 'underpowered');
    if (underpoweredPatterns.length > 3) {
      recs.push(`Upgrade routing for '${underpoweredPatterns[0].complexity.level}' tasks to prevent timeouts`);
    }
    
    return recs;
  }
  
  private getExpectedDuration(complexity: string): number {
    const durations: Record<string, number> = {
      trivial: 5000,
      simple: 15000,
      moderate: 45000,
      complex: 120000,
      deep: 300000
    };
    return durations[complexity] || 30000;
  }
  
  // ========================================================================
  // Checkpoint Events
  // ========================================================================
  
  recordCheckpoint(event: CheckpointEvent): void {
    this.checkpointEvents.push(event);
    
    const ritualMetrics = this.ritualMetrics.get(event.ritualId);
    if (ritualMetrics && event.event === 'created') {
      ritualMetrics.checkpointsCreated = (ritualMetrics.checkpointsCreated || 0) + 1;
    }
    if (ritualMetrics && event.event === 'loaded') {
      ritualMetrics.recoveryCount = (ritualMetrics.recoveryCount || 0) + 1;
    }
  }
  
  // ========================================================================
  // Sub-Agent Lifecycle Events (NEW)
  // ========================================================================
  
  recordSubAgentSpawned(ritualId: string, taskId: string, agentType: IDEType, sessionId: string): void {
    this.subAgentEvents.push({
      timestamp: Date.now(),
      ritualId,
      taskId,
      agentType,
      event: 'spawned',
      sessionId,
      retryCount: 0
    });
    
    const metrics = this.ritualMetrics.get(ritualId);
    if (metrics) {
      metrics.subAgentsSpawned = (metrics.subAgentsSpawned || 0) + 1;
    }
  }
  
  recordSubAgentCompleted(ritualId: string, taskId: string, agentType: IDEType, durationMs: number, tokensUsed: number): void {
    this.subAgentEvents.push({
      timestamp: Date.now(),
      ritualId,
      taskId,
      agentType,
      event: 'completed',
      retryCount: 0,
      durationMs,
      tokensUsed
    });
    
    const metrics = this.ritualMetrics.get(ritualId);
    if (metrics) {
      metrics.subAgentsCompleted = (metrics.subAgentsCompleted || 0) + 1;
    }
  }
  
  recordSubAgentFailed(ritualId: string, taskId: string, agentType: IDEType, errorCode: string, retryCount: number): void {
    this.subAgentEvents.push({
      timestamp: Date.now(),
      ritualId,
      taskId,
      agentType,
      event: 'failed',
      errorCode,
      retryCount
    });
    
    const metrics = this.ritualMetrics.get(ritualId);
    if (metrics) {
      metrics.subAgentsFailed = (metrics.subAgentsFailed || 0) + 1;
    }
  }
  
  recordSubAgentRetry(ritualId: string, taskId: string, agentType: IDEType, retryCount: number): void {
    this.subAgentEvents.push({
      timestamp: Date.now(),
      ritualId,
      taskId,
      agentType,
      event: 'retry',
      retryCount
    });
    
    const metrics = this.ritualMetrics.get(ritualId);
    if (metrics) {
      metrics.subAgentsRetried = (metrics.subAgentsRetried || 0) + 1;
      metrics.totalRetries = (metrics.totalRetries || 0) + 1;
    }
  }
  
  getSubAgentStats(ritualId?: string): SubAgentPoolStats {
    const events = ritualId 
      ? this.subAgentEvents.filter(e => e.ritualId === ritualId)
      : this.subAgentEvents;
    
    const spawned = events.filter(e => e.event === 'spawned');
    const completed = events.filter(e => e.event === 'completed');
    const failed = events.filter(e => e.event === 'failed');
    
    const byAgentType: SubAgentPoolStats['byAgentType'] = {
      claude: { spawned: 0, completed: 0, failed: 0, avgDurationMs: 0 },
      codex: { spawned: 0, completed: 0, failed: 0, avgDurationMs: 0 },
      kimi: { spawned: 0, completed: 0, failed: 0, avgDurationMs: 0 },
      opencode: { spawned: 0, completed: 0, failed: 0, avgDurationMs: 0 }
    };
    
    for (const agent of ['claude', 'codex', 'kimi', 'opencode'] as IDEType[]) {
      const agentEvents = events.filter(e => e.agentType === agent);
      const agentSpawned = agentEvents.filter(e => e.event === 'spawned').length;
      const agentCompleted = agentEvents.filter(e => e.event === 'completed').length;
      const agentFailed = agentEvents.filter(e => e.event === 'failed').length;
      const agentDurations = agentEvents
        .filter(e => e.event === 'completed' && e.durationMs)
        .map(e => e.durationMs!);
      
      byAgentType[agent] = {
        spawned: agentSpawned,
        completed: agentCompleted,
        failed: agentFailed,
        avgDurationMs: agentDurations.length > 0 
          ? agentDurations.reduce((a, b) => a + b, 0) / agentDurations.length 
          : 0
      };
    }
    
    return {
      activeAgents: spawned.length - completed.length - failed.length,
      idleAgents: 0, // Would need pool state
      queuedTasks: 0, // Would need queue state
      totalSpawned: spawned.length,
      totalCompleted: completed.length,
      totalFailed: failed.length,
      totalRetries: events.filter(e => e.event === 'retry').length,
      byAgentType
    };
  }
  
  // ========================================================================
  // Persistence
  // ========================================================================
  
  persist(): void {
    const timestamp = new Date().toISOString().slice(0, 10);
    
    // Daily metrics file
    const dailyFile = path.join(this.outputDir, `metrics-${timestamp}.json`);
    const data = {
      rituals: Array.from(this.ritualMetrics.values()),
      tasks: this.taskMetrics,
      routing: this.routingDecisions,
      checkpoints: this.checkpointEvents,
      subAgents: this.subAgentEvents
    };
    
    fs.writeFileSync(dailyFile, JSON.stringify(data, null, 2));
  }
  
  load(date?: string): void {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const file = path.join(this.outputDir, `metrics-${targetDate}.json`);
    
    if (!fs.existsSync(file)) return;
    
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'));
    
    this.ritualMetrics = new Map(data.rituals.map((r: RitualMetrics) => [r.ritualId, r]));
    this.taskMetrics = data.tasks || [];
    this.routingDecisions = data.routing || [];
    this.checkpointEvents = data.checkpoints || [];
    this.subAgentEvents = data.subAgents || [];
  }
  
  // ========================================================================
  // Queries
  // ========================================================================
  
  getRitualReport(ritualId: string): RitualMetrics | undefined {
    return this.ritualMetrics.get(ritualId) as RitualMetrics | undefined;
  }
  
  getTaskReport(taskId: string): TaskMetrics | undefined {
    return this.taskMetrics.find(t => t.taskId === taskId);
  }
  
  getDailySummary(date?: string): DailySummary {
    const targetDate = date || new Date().toISOString().slice(0, 10);
    this.load(targetDate);
    
    const rituals = Array.from(this.ritualMetrics.values());
    const tasks = this.taskMetrics;
    
    return {
      date: targetDate,
      totalRituals: rituals.length,
      completedRituals: rituals.filter(r => r.state === 'completed').length,
      failedRituals: rituals.filter(r => r.state === 'failed').length,
      totalTasks: tasks.length,
      totalTokens: rituals.reduce((sum, r) => sum + (r.totalTokens || 0), 0),
      totalCost: rituals.reduce((sum, r) => sum + (r.estimatedCost || 0), 0),
      avgRitualDuration: rituals.length > 0 
        ? rituals.reduce((sum, r) => sum + (r.durationMs || 0), 0) / rituals.length 
        : 0,
      routingAccuracy: this.analyzeRoutingAccuracy()
    };
  }
  
  private findRitualIdForTask(taskId: string): string | undefined {
    // Task ID format: task-{timestamp}-{random}
    // We need to find which ritual this task belongs to
    // For now, return undefined — in production, tasks would store ritualId
    return undefined;
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
}

// ============================================================================
// Types
// ============================================================================

export interface RoutingAccuracyReport {
  total: number;
  correct: number;
  overkill: number;
  underpowered: number;
  accuracyRate: number;
  wastedCost: number;
  recommendations: string[];
}

export interface DailySummary {
  date: string;
  totalRituals: number;
  completedRituals: number;
  failedRituals: number;
  totalTasks: number;
  totalTokens: number;
  totalCost: number;
  avgRitualDuration: number;
  routingAccuracy: RoutingAccuracyReport;
}

// ============================================================================
// Singleton
// ============================================================================

let globalCollector: MetricsCollector | null = null;

export function getMetricsCollector(outputDir?: string): MetricsCollector {
  if (!globalCollector) {
    const dir = outputDir || path.join(process.env.HOME || '/tmp', '.summon', 'metrics');
    globalCollector = new MetricsCollector(dir);
  }
  return globalCollector;
}
