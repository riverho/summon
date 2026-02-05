import { z } from 'zod';

// ============================================================================
// Core Storage Types
// ============================================================================

/**
 * Supported component categories stored in the registry.
 */
export const ComponentTypeSchema = z.enum([
  'persona',
  'skill',
  'agent',
  'tool',
  'workflow',
  'other',
]);

export type ComponentType = z.infer<typeof ComponentTypeSchema>;

/**
 * Append-only session event stored in JSONL.
 */
export const SessionEventSchema = z.object({
  timestamp: z.string().describe('ISO-8601 timestamp'),
  type: z.enum(['user', 'assistant', 'tool_start', 'tool_end', 'tool_error', 'system']),
  payload: z.unknown().optional(),
});

export type SessionEvent = z.infer<typeof SessionEventSchema>;

/**
 * Session metadata stored alongside events.
 */
export const SessionMetaSchema = z.object({
  sessionId: z.string().describe('Stable session identifier'),
  createdAt: z.string().describe('ISO-8601 timestamp'),
  updatedAt: z.string().describe('ISO-8601 timestamp'),
  model: z.string().optional(),
  tags: z.array(z.string()).default([]),
  status: z.enum(['active', 'completed', 'archived', 'failed']).default('active'),
});

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

/**
 * Long-term memory fact entry.
 */
export const MemoryFactSchema = z.object({
  id: z.string().optional(),
  content: z.string().describe('Atomic memory content'),
  tags: z.array(z.string()).default([]),
  source: z.string().optional(),
  createdAt: z.string().describe('ISO-8601 timestamp'),
  updatedAt: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export type MemoryFact = z.infer<typeof MemoryFactSchema>;

/**
 * Registry component metadata for installed personas/skills/etc.
 */
export const ComponentSchema = z.object({
  componentId: z.string().describe('Unique component identifier'),
  type: ComponentTypeSchema,
  version: z.string().optional(),
  path: z.string().optional(),
  hash: z.string().optional(),
  source: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
});

export type Component = z.infer<typeof ComponentSchema>;

// ============================================================================
// Config Types
// ============================================================================

/**
 * User configuration persisted in settings/config.json.
 */
export const UserConfigSchema = z.object({
  provider: z.string().optional(),
  modelId: z.string().optional(),
  defaultModel: z.string().optional(),
  toolPrefs: z.record(z.string(), z.boolean()).optional(),
  telemetry: z.boolean().optional(),
  storageVersion: z.string().optional(),
}).catchall(z.unknown());

export type UserConfig = z.infer<typeof UserConfigSchema>;

// ============================================================================
// Storage Adapter Interface
// ============================================================================

export interface StorageAdapter {
  // Sessions
  writeEvent(sessionId: string, event: SessionEvent): Promise<void>;
  readEvents(sessionId: string, options?: { limit?: number; cursor?: string }): Promise<SessionEvent[]>;
  getSessionMeta(sessionId: string): Promise<SessionMeta>;

  // Memory
  appendFact(fact: MemoryFact): Promise<void>;
  queryMemory(query: string): Promise<MemoryFact[]>;

  // Registry
  getComponent(id: string): Promise<Component>;
  listComponents(type: ComponentType): Promise<Component[]>;

  // Settings
  getConfig(): Promise<UserConfig>;
  setConfig(config: Partial<UserConfig>): Promise<void>;
}
