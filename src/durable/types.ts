// Durable Execution Engine — Core Types & Classes

// ============================================================================
// Core Types
// ============================================================================

export interface MicroTask<TInput = unknown, TOutput = unknown> {
  type: string;
  description: string;
  input: TInput;
  timeoutMs: number;
  maxTokens?: number;
  requiredTools?: string[];
  producesMutations: boolean;
  retryPolicy?: {
    maxAttempts: number;
    backoffMs: number;
  };
}

export interface SubAgentResult<TOutput = unknown> {
  success: boolean;
  output?: TOutput;
  mutations: StateMutation[];
  metrics: {
    startTime: number;
    endTime: number;
    durationMs: number;
    tokensUsed: number;
  };
  error?: {
    code: 'TIMEOUT' | 'VALIDATION_FAILED' | 'EXECUTION_ERROR' | 'MAX_TOKENS' | 'RATE_LIMITED';
    message: string;
  };
  sessionId: string;
  agentType: string;
}

export interface StateMutation {
  id: string;
  agentId: string;
  taskId: string;
  timestamp: number;
  path: string;
  operation: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'append' | 'merge';
  value?: unknown;
  previousValue?: unknown;
  description?: string;
}

export type IDEType = 'claude' | 'codex' | 'kimi' | 'opencode';

export interface AgentCapabilities {
  ideType: IDEType;
  maxTokens: number;
  specialties: string[];
  costPer1KTokens: number;
  latencyProfile: 'fast' | 'balanced' | 'thorough';
}

export interface TaskComplexity {
  level: 'trivial' | 'simple' | 'moderate' | 'complex' | 'deep';
  estimatedTokens: number;
  requiredTools: string[];
}

// ============================================================================
// Checkpoint Types
// ============================================================================

export interface Checkpoint {
  ritualId: string;
  checkpointId: string;
  createdAt: number;
  state: Record<string, unknown>;
  mutations: StateMutation[];
  completedTasks: string[];
  pendingTasks: string[];
  version: string;
}

export interface CheckpointOptions {
  checkpointDir?: string;
  maxHistory?: number;
  compressionThreshold?: number;
  autoSaveInterval?: number;
}
