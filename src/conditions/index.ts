// Conditions Module — Conditional Edge Evaluation for Summon Framework
// Enables runtime branching in rituals based on step results

export {
  ConditionEngine,
  createConditionEngine,
  validateCondition,
  validateConditions,
} from './engine.js';

export type {
  Condition,
  ConditionContext,
  ConditionEvaluationResult,
  ConditionTrace,
  EvaluationConfig,
  StepResult,
  EvaluationMethod,
} from './engine.js';

// Schema types for YAML rituals
export type {
  ConditionConfig,
  EvaluationSettings,
  ConditionedRitualConfig,
} from './schema.js';
