import { z } from 'zod';
import { AgentCompositionSchema, ModelConfigSchema, PersonaOrRefSchema, SkillOrRefSchema } from '../components/types.js';

// ============================================================================
// Multi-agent Orchestration Config (team.yaml)
// ============================================================================

export const OrchestrationPatternSchema = z.enum(['parallel', 'sequential', 'hierarchical']);
export type OrchestrationPattern = z.infer<typeof OrchestrationPatternSchema>;

export const OrchestrationConfigSchema = z.object({
  pattern: OrchestrationPatternSchema.default('parallel'),
  maxAgents: z.number().int().positive().max(20).default(5),
  maxIterations: z.number().int().positive().default(20),
  timeoutMs: z.number().int().positive().default(120_000),
});
export type OrchestrationConfig = z.infer<typeof OrchestrationConfigSchema>;

export const AgentNodeSchema = z.object({
  id: z.string().min(1),

  // Ritual file path (future): points to a single-agent YAML composition.
  ritual: z.string().optional(),

  // Inline/refs (today)
  persona: PersonaOrRefSchema.optional(),
  skills: z.array(SkillOrRefSchema).optional(),
  model: ModelConfigSchema.optional(),

  // Wiring
  outputTo: z.array(z.string()).optional(),
  listenFrom: z.array(z.string()).optional(),
});
export type AgentNode = z.infer<typeof AgentNodeSchema>;

export const OutputConfigSchema = z.object({
  format: z.enum(['markdown', 'json', 'structured']).default('markdown'),
  aggregator: z.enum(['last', 'first', 'concatenate', 'summarize']).default('concatenate'),
});
export type OutputConfig = z.infer<typeof OutputConfigSchema>;

export const MultiAgentConfigSchema = z.object({
  name: z.string().min(1),
  version: z.string().default('1.0.0'),
  description: z.string().optional(),

  orchestration: OrchestrationConfigSchema,
  agents: z.array(AgentNodeSchema).min(1),

  sharedContext: z.array(z.string()).optional(),
  output: OutputConfigSchema.optional(),
});

export type MultiAgentConfig = z.infer<typeof MultiAgentConfigSchema>;

// ============================================================================
// Events
// ============================================================================

export type OrchestrationEvent =
  | { type: 'agent_start'; agentId: string }
  | { type: 'agent_thinking'; agentId: string; content: string }
  | { type: 'agent_tool_call'; agentId: string; tool: string; args: unknown }
  | { type: 'agent_tool_end'; agentId: string; tool: string; durationMs: number }
  | { type: 'agent_tool_error'; agentId: string; tool: string; error: string }
  | { type: 'agent_done'; agentId: string; output: string }
  | { type: 'handoff'; from: string; to: string; data: unknown }
  | { type: 'orchestration_done'; result: string };

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert an AgentNode to a standard AgentComposition-like object.
 *
 * Notes:
 * - This uses the existing single-agent composition model.
 * - If `ritual` is provided, the orchestrator should load that file directly.
 */
export function toAgentComposition(agent: AgentNode) {
  const composition = {
    name: agent.id,
    version: '1.0.0',
    persona: agent.persona ?? {
      role: 'Agent',
      goal: 'Help complete the assigned task',
      backstory: 'A specialist sub-agent in a multi-agent team.',
    },
    skills: agent.skills ?? [],
    model: agent.model,
  };

  // Ensure shape stays compatible with the current composition schema.
  // This is a runtime assert, not compile-time.
  AgentCompositionSchema.partial().parse(composition);
  return composition;
}
