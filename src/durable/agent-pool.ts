// Agent Pool — Multi-IDE Coordination with Routing

import { 
  MicroTask, 
  TaskComplexity, 
  SubAgentResult, 
  IDEType, 
  AgentCapabilities 
} from './types.js';

// ============================================================================
// Default Configurations
// ============================================================================

const DEFAULT_CAPABILITIES: Record<IDEType, AgentCapabilities> = {
  claude: {
    ideType: 'claude',
    maxTokens: 200000,
    specialties: ['architecture', 'review', 'analysis', 'typescript', 'planning'],
    costPer1KTokens: 0.008,
    latencyProfile: 'thorough'
  },
  codex: {
    ideType: 'codex',
    maxTokens: 128000,
    specialties: ['implementation', 'refactoring', 'quick-fixes', 'editing'],
    costPer1KTokens: 0.003,
    latencyProfile: 'fast'
  },
  kimi: {
    ideType: 'kimi',
    maxTokens: 1000000,
    specialties: ['long-context', 'chinese', 'large-codebases', 'summarization'],
    costPer1KTokens: 0.005,
    latencyProfile: 'balanced'
  },
  opencode: {
    ideType: 'opencode',
    maxTokens: 128000,
    specialties: ['experimental', 'custom', 'open-source'],
    costPer1KTokens: 0.001,
    latencyProfile: 'balanced'
  }
};

// ============================================================================
// Agent Pool
// ============================================================================

export class AgentPool {
  private agentCounter = 0;
  private onRoutingDecision?: (decision: { taskId: string; complexity: TaskComplexity; routedTo: IDEType; reason: string }) => void;
  private onSubAgentEvent?: (event: { type: 'spawned' | 'completed' | 'failed'; ritualId: string; taskId: string; agentType: IDEType; sessionId?: string; durationMs?: number; tokensUsed?: number; errorCode?: string }) => void;
  
  constructor(options?: { 
    onRoutingDecision?: (decision: { taskId: string; complexity: TaskComplexity; routedTo: IDEType; reason: string }) => void;
    onSubAgentEvent?: (event: { type: 'spawned' | 'completed' | 'failed'; ritualId: string; taskId: string; agentType: IDEType; sessionId?: string; durationMs?: number; tokensUsed?: number; errorCode?: string }) => void;
  }) {
    this.onRoutingDecision = options?.onRoutingDecision;
    this.onSubAgentEvent = options?.onSubAgentEvent;
  }
  
  /**
   * Route task to appropriate IDE based on complexity and tools
   */
  routeTask(complexity: TaskComplexity): IDEType {
    // If specific tools required, match to IDE capabilities
    if (complexity.requiredTools.length > 0) {
      // For now, default to claude for complex tool use
      if (complexity.level === 'complex' || complexity.level === 'deep') {
        return 'claude';
      }
    }
    
    switch (complexity.level) {
      case 'trivial':
      case 'simple':
        return 'codex'; // Fast, cheap
      case 'moderate':
        return 'kimi'; // Balanced
      case 'complex':
      case 'deep':
        return 'claude'; // Deep analysis
      default:
        return 'codex';
    }
  }
  
  /**
   * Spawn ephemeral sub-agent for single micro-task
   */
  async spawnSubAgent<TInput, TOutput>(
    task: MicroTask<TInput, TOutput>,
    complexity: TaskComplexity,
    ritualId: string,
    taskId?: string
  ): Promise<SubAgentResult<TOutput>> {
    const startTime = Date.now();
    const ideType = this.routeTask(complexity);
    const agentId = `${ideType}-${++this.agentCounter}-${Date.now().toString(36).slice(-4)}`;
    
    // Emit routing decision
    if (this.onRoutingDecision && taskId) {
      this.onRoutingDecision({
        taskId,
        complexity,
        routedTo: ideType,
        reason: `Complexity: ${complexity.level} → ${ideType}`
      });
    }
    
    // Emit spawned event
    if (this.onSubAgentEvent && taskId) {
      this.onSubAgentEvent({
        type: 'spawned',
        ritualId,
        taskId,
        agentType: ideType,
        sessionId: `session-${agentId}`
      });
    }
    
    // For now, simulate sub-agent execution
    // In production, this would use sessions_spawn
    await new Promise(r => setTimeout(r, 100)); // Simulate spawn delay
    
    const durationMs = Date.now() - startTime;
    const tokensUsed = Math.floor(Math.random() * 2000) + 500;
    
    // Emit completed event
    if (this.onSubAgentEvent && taskId) {
      this.onSubAgentEvent({
        type: 'completed',
        ritualId,
        taskId,
        agentType: ideType,
        sessionId: `session-${agentId}`,
        durationMs,
        tokensUsed
      });
    }
    
    return {
      success: true,
      output: {} as TOutput,
      mutations: [],
      metrics: {
        startTime,
        endTime: Date.now(),
        durationMs,
        tokensUsed
      },
      sessionId: `session-${agentId}`,
      agentType: ideType
    };
  }
  
  /**
   * Spawn multiple sub-agents in parallel
   */
  async spawnBatch<TInput, TOutput>(
    taskTemplate: MicroTask<TInput, TOutput>,
    inputs: TInput[],
    complexity: TaskComplexity,
    ritualId: string,
    options: { concurrency?: number; continueOnError?: boolean } = {}
  ): Promise<SubAgentResult<TOutput>[]> {
    const { concurrency = 5, continueOnError = true } = options;
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
}
