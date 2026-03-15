/**
 * Ritual Types v2.0
 * 
 * Includes 3-layer tool manifest:
 * - builtin_tools
 * - cf_tools
 * - external_tools
 */

import { z } from 'zod';

// ============================================================================
// Tool Declarations
// ============================================================================

export const RitualToolDeclarationSchema = z.object({
  name: z.string(),
  version: z.string().optional().default('*'),
  alias: z.string().optional(),
  optional: z.boolean().default(false),
});

export type RitualToolDeclaration = z.infer<typeof RitualToolDeclarationSchema>;

// ============================================================================
// Manifest
// ============================================================================

export const RitualManifestSchema = z.object({
  // Layer 1: Built-in tools (ships with summon)
  builtin_tools: z.array(RitualToolDeclarationSchema).optional(),
  
  // Layer 2: CF-hosted tools (fetched from R2)
  cf_tools: z.array(RitualToolDeclarationSchema).optional(),
  
  // Layer 3: External tools (MCP, user-managed)
  external_tools: z.array(
    RitualToolDeclarationSchema.extend({
      via: z.literal('mcp'),
      server: z.string().optional(),
    })
  ).optional(),
});

export type RitualManifest = z.infer<typeof RitualManifestSchema>;

// ============================================================================
// Persona
// ============================================================================

export const RitualPersonaSchema = z.object({
  role: z.string(),
  goal: z.string().optional(),
  backstory: z.string().optional(),
  behavior: z.object({
    style: z.enum(['formal', 'casual', 'technical', 'professional']).optional(),
    priorities: z.array(z.string()).optional(),
    avoidances: z.array(z.string()).optional(),
    responseFormat: z.object({
      useTables: z.boolean().optional(),
      maxLength: z.number().optional(),
    }).optional(),
  }).optional(),
  
  // Tool usage guidance
  tool_guidance: z.record(z.string(), z.object({
    when: z.string(),
    priority: z.enum(['primary', 'secondary', 'fallback']),
    examples: z.array(z.string()).optional(),
  })).optional(),
});

export type RitualPersona = z.infer<typeof RitualPersonaSchema>;

// ============================================================================
// Model Configuration
// ============================================================================

export const RitualModelSchema = z.object({
  primary: z.string(),
  fallback: z.string().optional(),
  provider: z.enum(['openai', 'anthropic', 'openrouter', 'kimi', 'minimax']).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().optional(),
  maxIterations: z.number().default(10),
});

export type RitualModel = z.infer<typeof RitualModelSchema>;

// ============================================================================
// Skills
// ============================================================================

export const RitualSkillSchema = z.object({
  $ref: z.string(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type RitualSkill = z.infer<typeof RitualSkillSchema>;

// ============================================================================
// Function Calling
// ============================================================================

export const FunctionCallingStrategySchema = z.object({
  condition: z.string(),
  tools: z.array(z.string()),
  priority: z.enum(['high', 'medium', 'low']),
});

export const FunctionCallingChainSchema = z.object({
  name: z.string(),
  steps: z.array(z.object({
    tool: z.string(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    output_as: z.string().optional(),
  })),
});

export const RitualFunctionCallingSchema = z.object({
  mode: z.enum(['auto', 'manual', 'hybrid']).default('auto'),
  strategy: z.array(FunctionCallingStrategySchema).optional(),
  chains: z.array(FunctionCallingChainSchema).optional(),
});

export type RitualFunctionCalling = z.infer<typeof RitualFunctionCallingSchema>;

// ============================================================================
// Guardrails
// ============================================================================

export const RitualToolPolicySchema = z.object({
  max_calls_per_run: z.number().optional(),
  max_cost_per_run: z.number().optional(),  // cents
  require_approval: z.array(z.string()).optional(),  // tool names
  blocked_actions: z.array(z.string()).optional(),
});

export const RitualContentPolicySchema = z.object({
  blocked_topics: z.array(z.string()).optional(),
  blocked_patterns: z.array(z.string()).optional(),
});

export const RitualGuardrailsSchema = z.object({
  maxResponseLength: z.number().optional(),
  tool_policy: RitualToolPolicySchema.optional(),
  content_policy: RitualContentPolicySchema.optional(),
  
  // Training-specific
  training: z.object({
    sample_queries: z.array(z.string()).optional(),
    evaluation_criteria: z.array(z.string()).optional(),
  }).optional(),
});

export type RitualGuardrails = z.infer<typeof RitualGuardrailsSchema>;

// ============================================================================
// Complete Ritual
// ============================================================================

export const RitualSchema = z.object({
  // Metadata
  name: z.string(),
  version: z.string(),
  owner: z.string(),
  description: z.string(),
  
  // Core components
  persona: RitualPersonaSchema,
  skills: z.array(RitualSkillSchema),
  model: RitualModelSchema,
  
  // Tool manifest (3-layer)
  manifest: RitualManifestSchema.optional().default({}),
  
  // Function calling configuration
  function_calling: RitualFunctionCallingSchema.optional(),
  
  // Guardrails
  guardrails: RitualGuardrailsSchema.optional(),
  
  // Workflow
  workflow: z.object({
    style: z.enum(['loose', 'strict', 'autonomous']).optional(),
    maxIterations: z.number().optional(),
    timeoutMs: z.number().optional(),
    thinking: z.object({
      reflectionBeforeTool: z.boolean().optional(),
      reflectionBeforeAnswer: z.boolean().optional(),
    }).optional(),
  }).optional(),
});

export type Ritual = z.infer<typeof RitualSchema>;

// ============================================================================
// Validation
// ============================================================================

export function validateRitual(obj: unknown): Ritual {
  return RitualSchema.parse(obj);
}

export function parseRitualYaml(yaml: string): Ritual {
  const { parse } = require('yaml');
  const obj = parse(yaml);
  return validateRitual(obj);
}

// ============================================================================
// Example Ritual (for testing)
// ============================================================================

export const EXAMPLE_RITUAL: Ritual = {
  name: "yfinance-researcher",
  version: "1.0.0",
  owner: "river",
  description: "Stock research using Yahoo Finance",
  
  persona: {
    role: "Financial Researcher",
    goal: "Research stocks using Yahoo Finance data",
    backstory: "Expert in equity analysis",
  },
  
  skills: [{ $ref: "finance" }],
  
  model: {
    primary: "gpt-4o-mini",
    provider: "openai",
    maxIterations: 10,
  },
  
  manifest: {
    builtin_tools: [
      { name: "web_search", version: "*", optional: false },
    ],
    cf_tools: [
      { name: "yfinance", version: "^2.0.0", alias: "finance", optional: false },
    ],
  },
  
  function_calling: {
    mode: "auto",
    strategy: [
      {
        condition: "query contains stock ticker",
        tools: ["finance.get_quote", "finance.get_history"],
        priority: "high",
      },
    ],
  },
  
  guardrails: {
    tool_policy: {
      max_calls_per_run: 20,
      max_cost_per_run: 100,
    },
    content_policy: {
      blocked_topics: ["insider_trading", "market_manipulation"],
    },
  },
};
