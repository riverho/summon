/**
 * Registry Module — Client and cache for Summon Registry
 * 
 * Provides:
 * - HTTP client for fetching rituals from registry API
 * - Local filesystem caching with TTL
 * - Reference parsing (@author/name@version)
 */

// Client exports
export {
  // Main functions
  fetchRitual,
  fetchRitualMetadata,
  fetchRitualByRef,
  downloadRitualYaml,
  getDownloadUrl,
  parseRitualRef,
  
  // Constants
  REGISTRY_API_BASE,
  
  // Error handling
  RegistryClientError,
  
  // Types
  type RitualMetadata,
  type Ritual,
  type RegistryError,
  type FetchOptions,
} from './client.js';

// Cache exports
export {
  // Main functions
  cacheRitual,
  getCachedRitual,
  cacheRitualByComponents,
  getCachedRitualByComponents,
  
  // Cache management
  isCached,
  invalidateCacheEntry,
  clearCache,
  cleanExpiredEntries,
  
  // Cache info
  getCacheStats,
  listCachedRituals,
  
  // Constants
  CACHE_DIR,
  DEFAULT_TTL_HOURS,
  
  // Types
  type CacheEntry,
} from './cache.js';
