// Summon - Composable Agent Framework
// Main entry point for programmatic usage

// Component Types
export {
  Persona,
  Skill,
  AgentComposition,
  Behavior,
  ResponseFormat,
  ModelConfig,
  PersonaSchema,
  SkillSchema,
  AgentCompositionSchema,
  BehaviorSchema,
  ResponseFormatSchema,
  ModelConfigSchema,
  PersonaFileSchema,
  SkillFileSchema,
  ComponentRegistry,
  AgentEvent,
  ToolStartEvent,
  ToolEndEvent,
  ToolErrorEvent,
  ThinkingEvent,
  AnswerStartEvent,
  DoneEvent,
  ToolCallRecord,
  ComposedAgentConfig,
  // Guardrail types (NEW)
  GuardrailConfig,
  GuardrailConfigSchema,
  GuardrailCheckEvent,
  GuardrailFailedEvent,
  RetryPolicy,
  RetryPolicySchema,
} from './components/types.js';

// Guardrails (NEW)
export {
  GuardrailValidator,
  GuardrailValidationError,
  createSchemaGuardrail,
  createRegexGuardrail,
  createFunctionGuardrail,
  createLlmJudgeGuardrail,
  validateWithSchema,
} from './guardrails/validator.js';

export {
  jsonSchema,
  noTodos,
  properErrorHandling,
  codeComplexity,
  requiredFields,
  nonEmptyFields,
  arrayLength,
  semanticJudge,
  relevance,
  toneCheck,
  fileExists,
  directoryStructure,
  fileContent,
  combineGuardrails,
  anyOf,
} from './guardrails/rules.js';

export type {
  GuardrailResult,
  GuardrailError,
  ValidationResult,
} from './guardrails/types.js';

// Advanced Guardrails (v2)
export {
  GuardrailEngine,
  createGuardrailsFromPreferences,
  loadGuardrails,
  mergeGuardrails,
  DEFAULT_ADVANCED_GUARDRAILS,
} from './guardrails/advanced.js';

export type {
  AdvancedGuardrails,
  ContentPolicy,
  ToolPolicy,
  CostPolicy,
  QualityPolicy,
  TimePolicy,
  GuardrailCheck,
  GuardrailCheckResult,
  GuardrailContext,
} from './guardrails/advanced.js';

// User Preferences
export {
  loadPreferences,
  savePreferences,
  mergePreferences,
  updatePreference,
  setStylePreference,
  setFormatPreference,
  setSafetyPreference,
  getRitualOverrides,
  setRitualOverrides,
  preferencesToSystemPrompt,
  getPreferencesContext,
  validatePreferences,
  DEFAULT_PREFERENCES,
  getPreferencesPath,
} from './preferences/index.js';

export type {
  UserPreferences,
  UserIdentity,
  StylePreferences,
  FormatPreferences,
  SafetyPreferences,
  LearningPreferences,
} from './preferences/index.js';

// User Memory (Long-term)
export {
  UserMemoryManager,
  getUserMemoryManager,
  setUserMemoryManager,
  createDefaultMemory,
} from './memory/index.js';

export type {
  UserMemory,
  SummarizedInteraction,
  RitualModification,
  TrainingPattern,
  LearnedPreferences,
  RitualPreferenceOverride,
} from './memory/index.js';

// A/B Testing
export {
  ABTestManager,
  getABTestManager,
  setABTestManager,
  createStandardTest,
  DEFAULT_METRICS,
} from './ab-testing/index.js';

export type {
  ABTest,
  VariantConfig,
  TestMetric,
  VariantResult,
  UserAssignment,
  TestReport,
} from './ab-testing/index.js';

// Component Registry
export {
  createComponentRegistry,
  loadAgentComposition,
  getPersona,
  getSkill,
  getSkills,
  listPersonas,
  listSkills,
  validateComposition,
} from './components/registry.js';

// Composer
export {
  composeAgent,
  quickCompose,
  buildSystemPrompt,
  getRequiredTools,
  bindTools,
  ComposedAgentSpec,
} from './components/composer.js';

// ComposedAgent Runtime
export { ComposedAgent } from './components/composed-agent.js';

// Runtime Utilities
export {
  callLlm,
  getChatModel,
  getFastModel,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
} from './runtime/llm.js';

export {
  loadConfig,
  saveConfig,
  getSetting,
  setSetting,
} from './runtime/config.js';

export {
  checkApiKeyExists,
  checkApiKeyExistsForProvider,
  getApiKeyNameForProvider,
  getProviderDisplayName,
  saveApiKeyToEnv,
  saveApiKeyForProvider,
} from './runtime/env.js';

export {
  InMemoryChatHistory,
  Message,
} from './runtime/memory.js';

export {
  Session,
  SessionEntry,
  ToolContext,
} from './runtime/session.js';

export {
  ToolRegistry,
  RegisteredTool,
  globalToolRegistry,
} from './runtime/tools.js';

// Tool Loader
export {
  loadExternalTools,
  registerExternalTools,
  listExternalToolFiles,
  ExternalToolDefinition,
} from './runtime/tool-loader.js';

// Orchestration
export {
  AgentOrchestrator,
} from './orchestration/orchestrator.js';

export * from './orchestration/types.js';

// Storage
export * from './storage/index.js';

// Durable Execution Engine (AO Port)
export {
  RitualEngine,
  createRitualEngine,
  RitualEngineV2,
  createRitualEngineV2,
  AgentPool,
  ContextManager,
  CheckpointManager,
} from './durable/index.js';

export type {
  Ritual,
  RitualTask,
  RitualPlan,
  RitualOptions,
  RitualV2,
  RitualTaskV2,
  RitualPlanV2,
  RitualOptionsV2,
  RitualExecutionResult,
  MicroTask,
  TaskComplexity,
  SubAgentResult,
  StateMutation,
  Checkpoint,
  IDEType,
} from './durable/index.js';

// Conditional Edges Engine
export {
  ConditionEngine,
  createConditionEngine,
  validateCondition,
  validateConditions,
} from './conditions/index.js';

export type {
  Condition,
  ConditionContext,
  ConditionEvaluationResult,
  ConditionTrace,
  EvaluationConfig,
  StepResult,
  EvaluationMethod,
} from './conditions/index.js';

// Observability (AO Stress Test #2)
export {
  MetricsCollector,
  getMetricsCollector,
  Dashboard,
} from './observability/index.js';

export type {
  RitualMetrics,
  TaskMetrics,
  RoutingDecision,
  CheckpointEvent,
  RoutingAccuracyReport,
  DailySummary,
  SubAgentLifecycleEvent,
  SubAgentPoolStats,
} from './observability/index.js';

export type { WeeklyReport } from './observability/dashboard.js';

// Agent Factory (Real OpenClaw Integration)
export {
  AgentFactory,
  createAgentFactory,
  TIER_CONFIGS,
  AGENT_COSTS,
} from './factory/index.js';

export type {
  UserTier,
  TierConfig,
  CostRates,
  FactoryOptions,
  ProvisionDecision,
  SpawnEvent,
  CompleteEvent,
  ActiveSession,
} from './factory/index.js';

// OpenClaw Client
export {
  sessions_spawn,
  sessions_list,
  sessions_history,
  sessions_send,
  setMockMode,
  isMockMode,
  OpenClawError,
  handleOpenClawError,
} from './runtime/openclaw-client.js';

export type {
  SessionInfo,
  SessionHistory,
  SessionMessage,
  ToolCall,
  SpawnOptions,
  SpawnResult,
  ListOptions,
  HistoryOptions,
} from './runtime/openclaw-client.js';

// Billing System
export {
  CreditSystem,
  getCreditSystem,
  setCreditSystem,
} from './billing/index.js';

export type {
  CreditAccount,
  CreditTransaction,
  UsageReport,
  BillingConfig,
} from './billing/index.js';
