// Condition Schema Types — YAML Configuration Types for Conditional Edges

/**
 * Condition configuration as specified in YAML
 */
export interface ConditionConfig {
  id: string;
  from: string;
  condition: string;
  then: string;
  else: string;
  evaluation?: EvaluationSettings;
}

/**
 * Evaluation settings for conditions
 */
export interface EvaluationSettings {
  model?: string;        // 'default' or specific model name
  timeout?: string;      // Duration string like '5s', '1m'
  max_retries?: number;
}

/**
 * Extended ritual config that includes conditions
 */
export interface ConditionedRitualConfig {
  name: string;
  version: string;
  steps: Array<{
    id: string;
    name?: string;
    agent: string;
    [key: string]: unknown;
  }>;
  conditions?: ConditionConfig[];
  evaluation?: EvaluationSettings;
}

/**
 * Parse duration string to milliseconds
 * Supports: 1s, 5s, 1m, 2m, 1h, etc.
 */
export function parseDuration(duration: string): number {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) {
    throw new Error(`Invalid duration format: ${duration}. Use format like '5s', '1m', '2h'`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit];
}

/**
 * Convert condition config to engine format
 */
export function normalizeConditionConfig(
  config: ConditionConfig,
  globalSettings?: EvaluationSettings
) {
  const evaluation = config.evaluation || globalSettings;

  return {
    id: config.id,
    from: config.from,
    condition: config.condition,
    then: config.then,
    else: config.else,
    evaluation: evaluation ? {
      model: evaluation.model || 'default',
      timeout: evaluation.timeout ? parseDuration(evaluation.timeout) : 5000,
      maxRetries: evaluation.max_retries || 2,
    } : undefined,
  };
}

/**
 * Example YAML structure:
 * 
 * name: adaptive-researcher
 * version: 1.0.0
 * 
 * steps:
 *   - id: research
 *     name: Research Phase
 *     agent: researcher
 *   - id: analyze
 *     name: Analysis Phase  
 *     agent: analyzer
 *   - id: write
 *     name: Writing Phase
 *     agent: writer
 * 
 * conditions:
 *   - id: quality-check
 *     from: analyze
 *     condition: "confidence < 0.8"
 *     then: research    # Loop back
 *     else: write       # Continue
 *     
 *   - id: completeness-check
 *     from: research
 *     condition: "sources.length < 3"
 *     then: research    # Stay and gather more
 *     else: analyze
 *     
 *   - id: final-review
 *     from: write
 *     condition: "word_count < 500"
 *     then: write       # Expand
 *     else: complete    # Done
 * 
 * evaluation:
 *   model: default
 *   timeout: 5s
 *   max_retries: 2
 */
