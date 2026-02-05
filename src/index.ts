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
} from './components/types.js';

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

// Orchestration
export {
  AgentOrchestrator,
} from './orchestration/orchestrator.js';

export * from './orchestration/types.js';

// Storage
export * from './storage/index.js';
