/**
 * Self-Monitoring Layer — Bridges Agentic Workflow → True Agent
 * 
 * Tracks execution success, auto-triggers steering when needed.
 * Works with both attention-layer and summon.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ============================================================================
// Types
// ============================================================================

export interface ExecutionMetrics {
  toolSuccessRate: number;      // 0-1, % of successful tool calls
  averageLatency: number;       // ms
  humanInterventions: number;   // How many times human had to steer
  replanningEvents: number;     // How many strategy pivots
  lastEvaluated: string;        // ISO timestamp
}

export interface SelfEvaluation {
  overallHealth: 'healthy' | 'degraded' | 'failing';
  primaryIssue?: string;
  recommendedAction: 'continue' | 'evaluate' | 'pivot' | 'alert';
  confidence: number;           // 0-1
  reasoning: string;
}

export interface AgentGoal {
  id: string;
  objective: string;
  metrics: ExecutionMetrics;
  thresholds: {
    minSuccessRate: number;     // Below this = degraded
    maxLatency: number;         // Above this = degraded
    maxInterventions: number;   // Above this = failing
  };
}

// ============================================================================
// Self Monitor
// ============================================================================

export class SelfMonitor {
  private goalsPath: string;
  private metricsPath: string;

  constructor() {
    const baseDir = join(homedir(), '.summon', 'agent');
    this.goalsPath = join(baseDir, 'goals.json');
    this.metricsPath = join(baseDir, 'metrics.json');
  }

  /**
   * Record execution trace for analysis
   */
  recordExecution(trace: {
    goalId: string;
    toolsUsed: string[];
    toolResults: Array<{ success: boolean; latency: number }>;
    humanSteered: boolean;
    replanned: boolean;
  }): void {
    const metrics = this.loadMetrics(trace.goalId);
    
    // Update running metrics
    const totalTools = metrics.totalTools + trace.toolsUsed.length;
    const successfulTools = metrics.successfulTools + 
      trace.toolResults.filter(r => r.success).length;
    
    metrics.toolSuccessRate = successfulTools / totalTools;
    metrics.averageLatency = this.runningAverage(
      metrics.averageLatency,
      trace.toolResults.reduce((sum, r) => sum + r.latency, 0) / trace.toolResults.length,
      metrics.executionCount
    );
    
    if (trace.humanSteered) metrics.humanInterventions++;
    if (trace.replanned) metrics.replanningEvents++;
    
    metrics.executionCount++;
    metrics.lastEvaluated = new Date().toISOString();
    
    this.saveMetrics(trace.goalId, metrics);
  }

  /**
   * Self-evaluate and decide next action
   */
  evaluate(goalId: string): SelfEvaluation {
    const goal = this.loadGoal(goalId);
    const metrics = this.loadMetrics(goalId);
    
    const issues: string[] = [];
    
    // Check success rate
    if (metrics.toolSuccessRate < goal.thresholds.minSuccessRate) {
      issues.push(`Tool success rate ${(metrics.toolSuccessRate * 100).toFixed(1)}% below threshold ${(goal.thresholds.minSuccessRate * 100).toFixed(1)}%`);
    }
    
    // Check latency
    if (metrics.averageLatency > goal.thresholds.maxLatency) {
      issues.push(`Average latency ${metrics.averageLatency.toFixed(0)}ms above threshold ${goal.thresholds.maxLatency}ms`);
    }
    
    // Check human intervention rate
    if (metrics.humanInterventions > goal.thresholds.maxInterventions) {
      issues.push(`Too many human interventions (${metrics.humanInterventions})`);
    }
    
    // Decide action
    let evaluation: SelfEvaluation;
    
    if (issues.length === 0) {
      evaluation = {
        overallHealth: 'healthy',
        recommendedAction: 'continue',
        confidence: 0.9,
        reasoning: 'All metrics within thresholds, continuing current strategy'
      };
    } else if (metrics.humanInterventions >= goal.thresholds.maxInterventions) {
      evaluation = {
        overallHealth: 'failing',
        primaryIssue: issues[0],
        recommendedAction: 'pivot',
        confidence: 0.8,
        reasoning: `Multiple human interventions suggest fundamental strategy issue: ${issues.join(', ')}`
      };
    } else if (issues.length >= 2) {
      evaluation = {
        overallHealth: 'degraded',
        primaryIssue: issues[0],
        recommendedAction: 'evaluate',
        confidence: 0.7,
        reasoning: `Multiple degradation signals: ${issues.join('; ')}`
      };
    } else {
      evaluation = {
        overallHealth: 'degraded',
        primaryIssue: issues[0],
        recommendedAction: 'alert',
        confidence: 0.6,
        reasoning: `Single issue detected: ${issues[0]}`
      };
    }
    
    return evaluation;
  }

  /**
   * Auto-trigger attention-layer /commands based on evaluation
   */
  async autoSteer(goalId: string, evaluation: SelfEvaluation): Promise<{
    action: string;
    humanGate: boolean;
    proposal?: string;
  }> {
    switch (evaluation.recommendedAction) {
      case 'continue':
        return { 
          action: 'continue',
          humanGate: false 
        };
        
      case 'evaluate':
        return {
          action: '/evaluate',
          humanGate: true,
          proposal: `Self-monitoring detected degradation: ${evaluation.reasoning}. ` +
                   `Recommend running attention funnel to analyze alternative approaches.`
        };
        
      case 'pivot':
        return {
          action: '/pivot',
          humanGate: true,
          proposal: `Strategy failing after ${this.loadMetrics(goalId).humanInterventions} human interventions. ` +
                   `Recommend pivoting to different approach: ${evaluation.primaryIssue}`
        };
        
      case 'alert':
        return {
          action: 'alert',
          humanGate: true,
          proposal: `Performance degradation: ${evaluation.reasoning}. ` +
                   `Monitoring continues but human awareness recommended.`
        };
    }
  }

  /**
   * Create persistent goal with self-monitoring
   */
  createGoal(goal: Omit<AgentGoal, 'metrics'>): void {
    const fullGoal: AgentGoal = {
      ...goal,
      metrics: {
        toolSuccessRate: 1.0,
        averageLatency: 0,
        humanInterventions: 0,
        replanningEvents: 0,
        lastEvaluated: new Date().toISOString()
      }
    };
    
    this.saveGoal(goal.id, fullGoal);
  }

  // ============================================================================
  // Persistence
  // ============================================================================

  private loadMetrics(goalId: string): any {
    if (!existsSync(this.metricsPath)) return this.defaultMetrics();
    
    const data = JSON.parse(readFileSync(this.metricsPath, 'utf-8'));
    return data[goalId] || this.defaultMetrics();
  }

  private saveMetrics(goalId: string, metrics: any): void {
    const data = existsSync(this.metricsPath) 
      ? JSON.parse(readFileSync(this.metricsPath, 'utf-8'))
      : {};
    data[goalId] = metrics;
    
    const dir = join(homedir(), '.summon', 'agent');
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(this.metricsPath, JSON.stringify(data, null, 2));
  }

  private loadGoal(goalId: string): AgentGoal {
    if (!existsSync(this.goalsPath)) {
      throw new Error(`Goal ${goalId} not found`);
    }
    
    const data = JSON.parse(readFileSync(this.goalsPath, 'utf-8'));
    return data[goalId];
  }

  private saveGoal(goalId: string, goal: AgentGoal): void {
    const data = existsSync(this.goalsPath)
      ? JSON.parse(readFileSync(this.goalsPath, 'utf-8'))
      : {};
    data[goalId] = goal;
    
    const dir = join(homedir(), '.summon', 'agent');
    if (!existsSync(dir)) {
      require('fs').mkdirSync(dir, { recursive: true });
    }
    
    writeFileSync(this.goalsPath, JSON.stringify(data, null, 2));
  }

  private defaultMetrics(): any {
    return {
      totalTools: 0,
      successfulTools: 0,
      toolSuccessRate: 1.0,
      averageLatency: 0,
      humanInterventions: 0,
      replanningEvents: 0,
      executionCount: 0,
      lastEvaluated: new Date().toISOString()
    };
  }

  private runningAverage(current: number, newVal: number, count: number): number {
    return (current * count + newVal) / (count + 1);
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

let globalMonitor: SelfMonitor | null = null;

export function getSelfMonitor(): SelfMonitor {
  if (!globalMonitor) {
    globalMonitor = new SelfMonitor();
  }
  return globalMonitor;
}

export async function evaluateGoal(goalId: string): Promise<SelfEvaluation> {
  const monitor = getSelfMonitor();
  return monitor.evaluate(goalId);
}

export async function autoSteer(goalId: string): Promise<{
  action: string;
  humanGate: boolean;
  proposal?: string;
}> {
  const monitor = getSelfMonitor();
  const evaluation = monitor.evaluate(goalId);
  return monitor.autoSteer(goalId, evaluation);
}
