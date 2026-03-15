/**
 * True Agent Runtime — summon with self-evaluation
 * 
 * Wraps standard summon execution with self-monitoring.
 * Closes the gap: workflow → true agent.
 */

import { executeRitual, type ExecutionContext, type ExecutionResult } from '../runtime/engine.js';
import type { Ritual } from '../ritual/types.js';
import { getSelfMonitor, type SelfEvaluation } from './self-monitor.js';

// ============================================================================
// Types
// ============================================================================

export interface TrueAgentConfig {
  goalId: string;
  objective: string;
  thresholds?: {
    minSuccessRate: number;
    maxLatency: number;
    maxInterventions: number;
  };
  autoSteer: boolean;  // Whether to auto-trigger /commands
}

export interface TrueAgentResult extends ExecutionResult {
  selfEvaluation?: SelfEvaluation;
  recommendedAction?: string;
  autoSteerTriggered?: boolean;
}

// ============================================================================
// True Agent Runtime
// ============================================================================

export class TrueAgentRuntime {
  private config: TrueAgentConfig;
  private monitor = getSelfMonitor();

  constructor(config: TrueAgentConfig) {
    this.config = {
      thresholds: {
        minSuccessRate: 0.7,   // 70% tool success
        maxLatency: 5000,      // 5 seconds
        maxInterventions: 3,   // 3 human steers = failing
      },
      ...config
    };
    
    // Initialize goal tracking
    this.monitor.createGoal({
      id: config.goalId,
      objective: config.objective,
      thresholds: this.config.thresholds!
    });
  }

  /**
   * Execute with self-monitoring
   */
  async execute(
    ritual: Ritual,
    context: ExecutionContext
  ): Promise<TrueAgentResult> {
    const startTime = Date.now();
    
    // Track if human steered during execution
    let humanSteered = false;
    let replanned = false;
    const toolResults: Array<{ success: boolean; latency: number }> = [];

    // Wrap progress callback to track metrics
    const originalCallback = context.options?.onProgress;
    const wrappedCallback = (event: any) => {
      // Track tool events
      if (event.type === 'tool_end') {
        toolResults.push({
          success: !event.error,
          latency: event.duration || 0
        });
      }
      
      // Track steering events (human intervention)
      if (event.type === 'steering_command') {
        humanSteered = true;
      }
      
      // Track replanning
      if (event.type === 'replan') {
        replanned = true;
      }
      
      // Call original callback
      originalCallback?.(event);
    };

    // Execute with wrapped context
    const result = await executeRitual(ritual, {
      ...context,
      options: {
        ...context.options,
        onProgress: wrappedCallback
      }
    });

    // Record execution for self-monitoring
    this.monitor.recordExecution({
      goalId: this.config.goalId,
      toolsUsed: result.traces
        ?.filter(t => t.type === 'tool_end')
        .map(t => (t as any).tool) || [],
      toolResults,
      humanSteered,
      replanned
    });

    // Self-evaluate
    const evaluation = this.monitor.evaluate(this.config.goalId);

    // Auto-steer if enabled and needed
    let autoSteerResult;
    if (this.config.autoSteer && evaluation.recommendedAction !== 'continue') {
      autoSteerResult = await this.monitor.autoSteer(
        this.config.goalId,
        evaluation
      );
    }

    return {
      ...result,
      selfEvaluation: evaluation,
      recommendedAction: autoSteerResult?.action,
      autoSteerTriggered: !!autoSteerResult && evaluation.recommendedAction !== 'continue'
    };
  }

  /**
   * Check if agent should self-steer and return proposal
   */
  async checkAndPropose(): Promise<{
    shouldAct: boolean;
    action?: string;
    proposal?: string;
    evaluation?: SelfEvaluation;
  }> {
    const evaluation = this.monitor.evaluate(this.config.goalId);
    
    if (evaluation.recommendedAction === 'continue') {
      return { shouldAct: false };
    }

    const steer = await this.monitor.autoSteer(this.config.goalId, evaluation);
    
    return {
      shouldAct: true,
      action: steer.action,
      proposal: steer.proposal,
      evaluation
    };
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

export async function runWithSelfMonitoring(
  ritual: Ritual,
  query: string,
  config: TrueAgentConfig
): Promise<TrueAgentResult> {
  const agent = new TrueAgentRuntime(config);
  
  return agent.execute(ritual, {
    query,
    options: {
      mode: 'autonomous'
    }
  });
}

export async function checkGoalHealth(
  goalId: string
): Promise<SelfEvaluation> {
  const monitor = getSelfMonitor();
  return monitor.evaluate(goalId);
}
