// Agent Factory — Real Sub-Agent Spawning via OpenClaw
// Replaces simulated AgentPool with live sessions_spawn() integration

import {
  MicroTask,
  TaskComplexity,
  SubAgentResult,
  IDEType,
  AgentCapabilities,
  StateMutation
} from '../durable/types.js';
import { sessions_spawn, sessions_list, sessions_history } from '../runtime/openclaw-client.js';

// ============================================================================
// Tier Configuration
// ============================================================================

export type UserTier = 'free' | 'paid';

export interface TierConfig {
  availableAgents: IDEType[];
  maxConcurrent: number;
  maxPerRitual: number;
  monthlyCredits?: number;
  observability: 'basic' | 'full';
}

export const TIER_CONFIGS: Record<UserTier, TierConfig> = {
  free: {
    availableAgents: ['codex', 'claude'],
    maxConcurrent: 2,
    maxPerRitual: 5,
    monthlyCredits: 100,
    observability: 'basic'
  },
  paid: {
    availableAgents: ['codex', 'claude', 'kimi', 'opencode'],
    maxConcurrent: 10,
    maxPerRitual: 50,
    observability: 'full'
  }
};

// ============================================================================
// Cost Configuration
// ============================================================================

export interface CostRates {
  per1KTokens: number;
  perSpawn: number; // Flat fee per spawn
}

export const AGENT_COSTS: Record<IDEType, CostRates> = {
  claude: { per1KTokens: 0.008, perSpawn: 0.001 },
  codex: { per1KTokens: 0.003, perSpawn: 0.001 },
  kimi: { per1KTokens: 0.0025, perSpawn: 0.0005 }, // Cheaper for paid tier
  opencode: { per1KTokens: 0.0008, perSpawn: 0.0005 } // Cheapest
};

// ============================================================================
// Agent Factory
// ============================================================================

export interface FactoryOptions {
  tier: UserTier;
  creditBalance: number;
  onProvision?: (decision: ProvisionDecision) => void;
  onSpawn?: (event: SpawnEvent) => void;
  onComplete?: (event: CompleteEvent) => void;
}

export interface ProvisionDecision {
  ritualId: string;
  taskId: string;
  agentType: IDEType;
  canProceed: boolean;
  estimatedCost: number;
  reason?: string;
}

export interface SpawnEvent {
  ritualId: string;
  taskId: string;
  agentType: IDEType;
  sessionKey: string;
  timestamp: number;
}

export interface CompleteEvent {
  ritualId: string;
  taskId: string;
  agentType: IDEType;
  sessionKey: string;
  success: boolean;
  durationMs: number;
  tokensUsed: number;
  actualCost: number;
  error?: string;
}

export interface ActiveSession {
  ritualId: string;
  taskId: string;
  agentType: IDEType;
  sessionKey: string;
  startedAt: number;
  status: 'spawning' | 'running' | 'completed' | 'failed';
}

export class AgentFactory {
  private tier: UserTier;
  private creditBalance: number;
  private activeSessions: Map<string, ActiveSession> = new Map();
  private onProvision?: (decision: ProvisionDecision) => void;
  private onSpawn?: (event: SpawnEvent) => void;
  private onComplete?: (event: CompleteEvent) => void;
  private agentCounter = 0;

  constructor(options: FactoryOptions) {
    this.tier = options.tier;
    this.creditBalance = options.creditBalance;
    this.onProvision = options.onProvision;
    this.onSpawn = options.onSpawn;
    this.onComplete = options.onComplete;
  }

  // ========================================================================
  // Provisioning
  // ========================================================================

  /**
   * Check if agent can be provisioned for this task
   */
  async provisionAgent(
    ritualId: string,
    task: MicroTask,
    complexity: TaskComplexity
  ): Promise<ProvisionDecision> {
    const taskId = `${task.type}-${++this.agentCounter}`;
    const agentType = this.routeTask(complexity);
    const estimatedCost = this.calculateEstimatedCost(agentType, complexity);

    // Check tier access
    const tierConfig = TIER_CONFIGS[this.tier];
    if (!tierConfig.availableAgents.includes(agentType)) {
      const decision: ProvisionDecision = {
        ritualId,
        taskId,
        agentType,
        canProceed: false,
        estimatedCost,
        reason: `${agentType} requires paid tier (current: ${this.tier})`
      };
      this.onProvision?.(decision);
      return decision;
    }

    // Check concurrent limits
    const currentRitualSessions = this.getRitualSessionCount(ritualId);
    if (currentRitualSessions >= tierConfig.maxPerRitual) {
      const decision: ProvisionDecision = {
        ritualId,
        taskId,
        agentType,
        canProceed: false,
        estimatedCost,
        reason: `Max ${tierConfig.maxPerRitual} sessions per ritual reached`
      };
      this.onProvision?.(decision);
      return decision;
    }

    // Check credits (for free tier, enforce hard limit)
    if (this.tier === 'free' && this.creditBalance < estimatedCost) {
      const decision: ProvisionDecision = {
        ritualId,
        taskId,
        agentType,
        canProceed: false,
        estimatedCost,
        reason: `Insufficient credits (${this.creditBalance.toFixed(2)} < ${estimatedCost.toFixed(2)})`
      };
      this.onProvision?.(decision);
      return decision;
    }

    const decision: ProvisionDecision = {
      ritualId,
      taskId,
      agentType,
      canProceed: true,
      estimatedCost
    };
    this.onProvision?.(decision);
    return decision;
  }

  // ========================================================================
  // Spawning
  // ========================================================================

  /**
   * Spawn a real sub-agent via OpenClaw sessions_spawn
   */
  async spawnSubAgent<TInput, TOutput>(
    ritualId: string,
    task: MicroTask<TInput, TOutput>,
    complexity: TaskComplexity
  ): Promise<SubAgentResult<TOutput>> {
    const startTime = Date.now();

    // Step 1: Provision
    const provision = await this.provisionAgent(ritualId, task, complexity);
    if (!provision.canProceed) {
      return this.createFailedResult(provision.reason!, startTime);
    }

    const taskId = provision.taskId;
    const agentType = provision.agentType;

    // Step 2: Build spawn task
    const spawnTask = this.buildSpawnTask(ritualId, task, complexity, taskId);

    try {
      // Step 3: Spawn via OpenClaw
      const sessionResult = await sessions_spawn({
        task: spawnTask,
        agentId: agentType,
        label: `ritual-${ritualId}-task-${taskId}`,
        runTimeoutSeconds: Math.ceil(task.timeoutMs / 1000),
        cleanup: 'keep' // Keep for result retrieval
      });

      // Track active session
      const session: ActiveSession = {
        ritualId,
        taskId,
        agentType,
        sessionKey: sessionResult.sessionKey,
        startedAt: startTime,
        status: 'spawning'
      };
      this.activeSessions.set(sessionResult.sessionKey, session);

      this.onSpawn?.({
        ritualId,
        taskId,
        agentType,
        sessionKey: sessionResult.sessionKey,
        timestamp: Date.now()
      });

      // Step 4: Wait for completion
      const result = await this.waitForCompletion<TOutput>(
        sessionResult.sessionKey,
        session,
        task.timeoutMs
      );

      // Step 5: Deduct actual cost
      const actualCost = this.calculateActualCost(agentType, result.metrics.tokensUsed);
      this.creditBalance -= actualCost;

      // Cleanup
      this.activeSessions.delete(sessionResult.sessionKey);

      this.onComplete?.({
        ritualId,
        taskId,
        agentType,
        sessionKey: sessionResult.sessionKey,
        success: result.success,
        durationMs: result.metrics.durationMs,
        tokensUsed: result.metrics.tokensUsed,
        actualCost,
        error: result.error?.message
      });

      return result;

    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMessage = err.message || 'Unknown spawn error';

      this.onComplete?.({
        ritualId,
        taskId,
        agentType,
        sessionKey: 'failed',
        success: false,
        durationMs,
        tokensUsed: 0,
        actualCost: 0,
        error: errorMessage
      });

      return this.createFailedResult(errorMessage, startTime);
    }
  }

  /**
   * Spawn multiple sub-agents in parallel with concurrency control
   */
  async spawnBatch<TInput, TOutput>(
    ritualId: string,
    taskTemplate: MicroTask<TInput, TOutput>,
    inputs: TInput[],
    complexity: TaskComplexity,
    options: { concurrency?: number; continueOnError?: boolean } = {}
  ): Promise<SubAgentResult<TOutput>[]> {
    const tierConfig = TIER_CONFIGS[this.tier];
    const concurrency = Math.min(
      options.concurrency || 5,
      tierConfig.maxConcurrent
    );
    const { continueOnError = true } = options;

    const results: SubAgentResult<TOutput>[] = [];

    for (let i = 0; i < inputs.length; i += concurrency) {
      const batch = inputs.slice(i, i + concurrency);

      const batchPromises = batch.map(input => {
        const task = { ...taskTemplate, input };
        return this.spawnSubAgent(task, complexity, ritualId);
      });

      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result as SubAgentResult<TOutput>);
        if (!result.success && !continueOnError) {
          return results;
        }
      }
    }

    return results;
  }

  // ========================================================================
  // Task Building
  // ========================================================================

  private buildSpawnTask<TInput>(
    ritualId: string,
    task: MicroTask<TInput, unknown>,
    complexity: TaskComplexity,
    taskId: string
  ): string {
    return `
# Micro-Task Execution

**Ritual ID:** ${ritualId}  
**Task ID:** ${taskId}  
**Type:** ${task.type}  
**Complexity:** ${complexity.level}

## Description
${task.description}

## Input
\`\`\`json
${JSON.stringify(task.input, null, 2)}
\`\`\`

## Required Tools
${complexity.requiredTools.length > 0 ? complexity.requiredTools.join(', ') : 'None'}

## Instructions
1. Execute the task described above
2. ${task.producesMutations ? 'Apply any state mutations using the mutation format' : 'No mutations required'}
3. Complete within ${task.timeoutMs}ms
4. Return results in the specified format

## Output Format
Return ONLY a JSON object with this structure:
\`\`\`json
{
  "success": true | false,
  "output": <your output here>,
  "mutations": [
    {
      "path": "state.key",
      "operation": "add" | "replace" | "append" | "merge" | "remove",
      "value": <new value>,
      "description": "What this mutation does"
    }
  ],
  "tokensUsed": <number>,
  "summary": "Brief summary of what was done"
}
\`\`\`

If you encounter an error, return:
\`\`\`json
{
  "success": false,
  "error": {
    "code": "TIMEOUT" | "VALIDATION_FAILED" | "EXECUTION_ERROR" | "MAX_TOKENS" | "RATE_LIMITED",
    "message": "Description of what went wrong"
  }
}
\`\`\`
`;
  }

  // ========================================================================
  // Completion Polling
  // ========================================================================

  private async waitForCompletion<TOutput>(
    sessionKey: string,
    session: ActiveSession,
    timeoutMs: number
  ): Promise<SubAgentResult<TOutput>> {
    const pollInterval = 2000; // 2 seconds
    const maxWait = Math.min(timeoutMs + 10000, 600000); // Task timeout + buffer, max 10 min

    for (let waited = 0; waited < maxWait; waited += pollInterval) {
      // Update session status
      session.status = 'running';

      // Check session list
      const sessions = await sessions_list({ activeMinutes: 30 });
      const sessionInfo = sessions.find(s => s.sessionKey === sessionKey);

      if (!sessionInfo) {
        // Session not found, might be completed and cleaned up
        // Try to fetch history directly
        try {
          const history = await sessions_history({ sessionKey, limit: 50 });
          return this.parseResultFromHistory<TOutput>(history, session);
        } catch {
          return this.createFailedResult('Session disappeared', session.startedAt);
        }
      }

      // Check if completed
      if (sessionInfo.status === 'completed' || sessionInfo.status === 'error') {
        const history = await sessions_history({ sessionKey, limit: 50 });
        const result = this.parseResultFromHistory<TOutput>(history, session);

        if (sessionInfo.status === 'error' && result.success) {
          // Mark as failed if session errored
          return {
            ...result,
            success: false,
            error: { code: 'EXECUTION_ERROR', message: 'Session ended with error status' }
          };
        }

        return result;
      }

      // Wait before next poll
      await new Promise(r => setTimeout(r, pollInterval));
    }

    // Timeout
    return this.createFailedResult('Task timeout waiting for completion', session.startedAt);
  }

  private parseResultFromHistory<TOutput>(
    history: any,
    session: ActiveSession
  ): SubAgentResult<TOutput> {
    // Look for JSON response in the history
    const messages = history.messages || [];

    // Find the last assistant message with JSON
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'assistant') {
        const content = msg.content || msg.text || '';

        // Try to extract JSON
        const jsonMatch = content.match(/```json\s*([\s\S]*?)```/) ||
                         content.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          try {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const parsed = JSON.parse(jsonStr.trim());

            const endTime = Date.now();

            return {
              success: parsed.success ?? true,
              output: parsed.output as TOutput,
              mutations: parsed.mutations || [],
              metrics: {
                startTime: session.startedAt,
                endTime,
                durationMs: endTime - session.startedAt,
                tokensUsed: parsed.tokensUsed || msg.tokens?.total || 0
              },
              sessionId: session.sessionKey,
              agentType: session.agentType,
              error: parsed.error
            };
          } catch (e) {
            // JSON parse failed, continue searching
          }
        }
      }
    }

    // No valid JSON found, return text as output
    const lastAssistant = messages.reverse().find((m: any) => m.role === 'assistant');
    const endTime = Date.now();

    return {
      success: true,
      output: (lastAssistant?.content || lastAssistant?.text || 'No response') as TOutput,
      mutations: [],
      metrics: {
        startTime: session.startedAt,
        endTime,
        durationMs: endTime - session.startedAt,
        tokensUsed: lastAssistant?.tokens?.total || 0
      },
      sessionId: session.sessionKey,
      agentType: session.agentType
    };
  }

  // ========================================================================
  // Routing & Cost
  // ========================================================================

  private routeTask(complexity: TaskComplexity): IDEType {
    const tierConfig = TIER_CONFIGS[this.tier];

    // Determine ideal agent based on complexity
    let idealAgent: IDEType;

    switch (complexity.level) {
      case 'trivial':
      case 'simple':
        idealAgent = 'codex';
        break;
      case 'moderate':
        idealAgent = 'kimi';
        break;
      case 'complex':
      case 'deep':
        idealAgent = 'claude';
        break;
      default:
        idealAgent = 'codex';
    }

    // If ideal agent not available in tier, find fallback
    if (!tierConfig.availableAgents.includes(idealAgent)) {
      return this.findFallbackAgent(complexity, tierConfig.availableAgents);
    }

    return idealAgent;
  }

  private findFallbackAgent(complexity: TaskComplexity, available: IDEType[]): IDEType {
    // Priority order for fallbacks
    const priority: IDEType[] = ['claude', 'kimi', 'codex', 'opencode'];

    for (const agent of priority) {
      if (available.includes(agent)) {
        return agent;
      }
    }

    return available[0] || 'claude';
  }

  private calculateEstimatedCost(agentType: IDEType, complexity: TaskComplexity): number {
    const rates = AGENT_COSTS[agentType];
    const tokenCost = (complexity.estimatedTokens / 1000) * rates.per1KTokens;
    return tokenCost + rates.perSpawn;
  }

  private calculateActualCost(agentType: IDEType, tokensUsed: number): number {
    const rates = AGENT_COSTS[agentType];
    const tokenCost = (tokensUsed / 1000) * rates.per1KTokens;
    return tokenCost + rates.perSpawn;
  }

  // ========================================================================
  // Helpers
  // ========================================================================

  private createFailedResult<TOutput>(errorMessage: string, startTime: number): SubAgentResult<TOutput> {
    return {
      success: false,
      output: undefined as TOutput,
      mutations: [],
      metrics: {
        startTime,
        endTime: Date.now(),
        durationMs: Date.now() - startTime,
        tokensUsed: 0
      },
      sessionId: 'failed',
      agentType: 'claude',
      error: {
        code: 'EXECUTION_ERROR',
        message: errorMessage
      }
    };
  }

  private getRitualSessionCount(ritualId: string): number {
    let count = 0;
    for (const session of this.activeSessions.values()) {
      if (session.ritualId === ritualId) {
        count++;
      }
    }
    return count;
  }

  getActiveSessions(): ActiveSession[] {
    return Array.from(this.activeSessions.values());
  }

  getCreditBalance(): number {
    return this.creditBalance;
  }

  addCredits(amount: number): void {
    this.creditBalance += amount;
  }
}

// ============================================================================
// Factory Factory (ha!)
// ============================================================================

export async function createAgentFactory(
  tier: UserTier,
  options?: Partial<Omit<FactoryOptions, 'tier' | 'creditBalance'>>
): Promise<AgentFactory> {
  // In production, fetch user's credit balance from storage
  const initialCredits = tier === 'free' ? TIER_CONFIGS.free.monthlyCredits! : 0;

  return new AgentFactory({
    tier,
    creditBalance: initialCredits,
    ...options
  });
}
