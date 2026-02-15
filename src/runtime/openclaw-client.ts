// OpenClaw Client — Wrapper for OpenClaw session tools
// Provides typed interface to sessions_spawn, sessions_list, sessions_history

// ============================================================================
// Types
// ============================================================================

export interface SessionInfo {
  sessionKey: string;
  label?: string;
  status: 'running' | 'completed' | 'error' | 'unknown';
  agentId?: string;
  lastActivityAt?: string;
  messageCount?: number;
}

export interface SessionHistory {
  sessionKey: string;
  messages: SessionMessage[];
  toolCalls?: ToolCall[];
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content?: string;
  text?: string;
  tokens?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  timestamp?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  result?: unknown;
}

export interface SpawnOptions {
  task: string;
  agentId?: string;
  label?: string;
  runTimeoutSeconds?: number;
  timeoutSeconds?: number;
  cleanup?: 'delete' | 'keep';
  model?: string;
  thinking?: string;
}

export interface SpawnResult {
  sessionKey: string;
  agentId: string;
  status: string;
}

export interface ListOptions {
  activeMinutes?: number;
  kinds?: string[];
  limit?: number;
  messageLimit?: number;
}

export interface HistoryOptions {
  sessionKey: string;
  limit?: number;
  includeTools?: boolean;
}

// ============================================================================
// Client Implementation
// ============================================================================

/**
 * Spawn a new agent session via OpenClaw
 */
export async function sessions_spawn(options: SpawnOptions): Promise<SpawnResult> {
  // In production, this calls the actual OpenClaw sessions_spawn tool
  // For now, we provide a mock that simulates the behavior

  const sessionKey = `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  console.log(`[OpenClaw] Spawning session: ${options.label || 'unnamed'}`);
  console.log(`[OpenClaw] Agent: ${options.agentId || 'default'}`);
  console.log(`[OpenClaw] Timeout: ${options.runTimeoutSeconds || 300}s`);

  // Simulate spawn delay
  await new Promise(r => setTimeout(r, 100));

  // In real implementation, this would be:
  // return await openclaw.sessions_spawn({
  //   task: options.task,
  //   agentId: options.agentId,
  //   label: options.label,
  //   runTimeoutSeconds: options.runTimeoutSeconds,
  //   cleanup: options.cleanup
  // });

  return {
    sessionKey,
    agentId: options.agentId || 'claude',
    status: 'spawned'
  };
}

/**
 * List active sessions
 */
export async function sessions_list(options?: ListOptions): Promise<SessionInfo[]> {
  // In production, this calls the actual OpenClaw sessions_list tool

  console.log(`[OpenClaw] Listing sessions (activeMinutes: ${options?.activeMinutes || 'all'})`);

  // Simulate returning empty list (no active sessions in mock)
  return [];

  // In real implementation:
  // return await openclaw.sessions_list({
  //   activeMinutes: options?.activeMinutes,
  //   kinds: options?.kinds,
  //   limit: options?.limit,
  //   messageLimit: options?.messageLimit
  // });
}

/**
 * Get session message history
 */
export async function sessions_history(options: HistoryOptions): Promise<SessionHistory> {
  // In production, this calls the actual OpenClaw sessions_history tool

  console.log(`[OpenClaw] Fetching history for: ${options.sessionKey}`);

  // Simulate returning mock history
  return {
    sessionKey: options.sessionKey,
    messages: [
      {
        role: 'user',
        content: 'Execute task...',
        timestamp: new Date().toISOString()
      },
      {
        role: 'assistant',
        content: '```json\n{"success": true, "output": {}, "mutations": [], "tokensUsed": 1000}\n```',
        tokens: { total: 1000 },
        timestamp: new Date().toISOString()
      }
    ]
  };

  // In real implementation:
  // return await openclaw.sessions_history({
  //   sessionKey: options.sessionKey,
  //   limit: options.limit,
  //   includeTools: options.includeTools
  // });
}

/**
 * Send a message to an existing session
 */
export async function sessions_send(options: {
  sessionKey: string;
  message: string;
  timeoutSeconds?: number;
}): Promise<void> {
  console.log(`[OpenClaw] Sending to ${options.sessionKey}: ${options.message.slice(0, 50)}...`);

  // In real implementation:
  // await openclaw.sessions_send({
  //   sessionKey: options.sessionKey,
  //   message: options.message,
  //   timeoutSeconds: options.timeoutSeconds
  // });
}

// ============================================================================
// Mock Mode
// ============================================================================

let mockMode = true;

export function setMockMode(enabled: boolean): void {
  mockMode = enabled;
  console.log(`[OpenClaw] Mock mode: ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

export function isMockMode(): boolean {
  return mockMode;
}

// ============================================================================
// Error Handling
// ============================================================================

export class OpenClawError extends Error {
  constructor(
    message: string,
    public code: string,
    public sessionKey?: string
  ) {
    super(message);
    this.name = 'OpenClawError';
  }
}

export function handleOpenClawError(error: any): OpenClawError {
  if (error instanceof OpenClawError) {
    return error;
  }

  const message = error.message || 'Unknown OpenClaw error';
  const code = error.code || 'UNKNOWN_ERROR';

  return new OpenClawError(message, code);
}
