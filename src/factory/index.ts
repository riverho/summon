// Agent Factory — Barrel Export
export {
  AgentFactory,
  createAgentFactory,
  TIER_CONFIGS,
  AGENT_COSTS
} from './agent-factory.js';

export type {
  UserTier,
  TierConfig,
  CostRates,
  FactoryOptions,
  ProvisionDecision,
  SpawnEvent,
  CompleteEvent,
  ActiveSession
} from './agent-factory.js';

// IDEType comes from durable types
export type { IDEType } from '../durable/types.js';
