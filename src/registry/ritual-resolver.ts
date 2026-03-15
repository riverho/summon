/**
 * Ritual Resolver — Parse and resolve owner@ritual format references
 * 
 * Supports formats:
 * - owner@ritual → Resolves to latest version
 * - owner@ritual@version → Specific version
 * - @owner/ritual → Alternative format (same as registry client)
 * - @owner/ritual@version → With version
 * 
 * The resolver coordinates between:
 * - Local cache (fastest)
 * - R2 storage (registry backend)
 * - Direct API fallback
 */

import {
  fetchRitualByRef,
  parseRitualRef,
  type Ritual,
  type FetchOptions,
  RegistryClientError,
} from './client.js';
import {
  getCachedRitualByComponents,
  cacheRitualByComponents,
  type CacheEntry,
} from './cache.js';
import { fetchRitualFromR2, type R2FetchOptions } from './r2-client.js';
import { parseRitualYaml } from '../ritual/loader.js';
import type { Ritual as RitualType } from '../ritual/types.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Parsed ritual reference
 */
export interface ParsedRitualRef {
  /** Original reference string */
  original: string;
  /** Owner/author of the ritual */
  owner: string;
  /** Name of the ritual */
  name: string;
  /** Version (undefined = latest) */
  version?: string;
  /** Format type detected */
  format: 'owner@ritual' | 'owner@ritual@version' | '@owner/ritual' | '@owner/ritual@version';
}

/**
 * Resolved ritual with metadata about the resolution process
 */
export interface ResolvedRitual {
  /** The parsed ritual reference */
  parsedRef: ParsedRitualRef;
  /** The ritual YAML content */
  yaml: string;
  /** Parsed ritual object */
  ritual: RitualType;
  /** Where the ritual was resolved from */
  source: 'cache' | 'r2' | 'api';
  /** Cache entry info (if cached) */
  cacheInfo?: CacheEntry;
  /** When the ritual was resolved */
  resolvedAt: number;
}

/**
 * Resolution options
 */
export interface ResolutionOptions {
  /** Skip cache lookup */
  skipCache?: boolean;
  /** Skip R2 and go directly to API */
  skipR2?: boolean;
  /** Force refresh from source */
  forceRefresh?: boolean;
  /** Timeout for fetch operations */
  timeoutMs?: number;
  /** Preferred source priority */
  priority?: ('cache' | 'r2' | 'api')[];
}

// ============================================================================
// Reference Parsing
// ============================================================================

/**
 * Parse owner@ritual format reference
 * 
 * Supported formats:
 * - "river@stock-checker" → { owner: "river", name: "stock-checker" }
 * - "river@stock-checker@v1.0.0" → { owner: "river", name: "stock-checker", version: "v1.0.0" }
 * - "@river/stock-checker" → { owner: "river", name: "stock-checker" }
 * - "@river/stock-checker@1.0.0" → { owner: "river", name: "stock-checker", version: "1.0.0" }
 * 
 * @param ref - Reference string to parse
 * @returns Parsed reference components
 * @throws RitualResolverError if format is invalid
 */
export function parseOwnerRitualRef(ref: string): ParsedRitualRef {
  if (!ref || typeof ref !== 'string') {
    throw new RitualResolverError(
      'Reference cannot be empty',
      'EMPTY_REFERENCE',
      ref
    );
  }

  const trimmedRef = ref.trim();

  // Try owner@ritual@version format first (most specific)
  const atVersionMatch = trimmedRef.match(/^([^@/\s]+)@([^@/\s]+)@(.+)$/);
  if (atVersionMatch) {
    const [, owner, name, version] = atVersionMatch;
    return {
      original: trimmedRef,
      owner: owner.toLowerCase(),
      name: name.toLowerCase(),
      version,
      format: 'owner@ritual@version',
    };
  }

  // Try owner@ritual format (no version)
  const atMatch = trimmedRef.match(/^([^@/\s]+)@([^@/\s]+)$/);
  if (atMatch) {
    const [, owner, name] = atMatch;
    return {
      original: trimmedRef,
      owner: owner.toLowerCase(),
      name: name.toLowerCase(),
      format: 'owner@ritual',
    };
  }

  // Try @owner/ritual@version format (registry style with version)
  const slashVersionMatch = trimmedRef.match(/^@([^/\s]+)\/([^@/\s]+)@(.+)$/);
  if (slashVersionMatch) {
    const [, owner, name, version] = slashVersionMatch;
    return {
      original: trimmedRef,
      owner: owner.toLowerCase(),
      name: name.toLowerCase(),
      version,
      format: '@owner/ritual@version',
    };
  }

  // Try @owner/ritual format (registry style without version)
  const slashMatch = trimmedRef.match(/^@([^/\s]+)\/([^/\s]+)$/);
  if (slashMatch) {
    const [, owner, name] = slashMatch;
    return {
      original: trimmedRef,
      owner: owner.toLowerCase(),
      name: name.toLowerCase(),
      format: '@owner/ritual',
    };
  }

  throw new RitualResolverError(
    `Invalid ritual reference format: "${ref}". Expected formats: owner@ritual, owner@ritual@version, @owner/ritual, or @owner/ritual@version`,
    'INVALID_FORMAT',
    ref
  );
}

/**
 * Check if a string looks like an owner@ritual reference
 * 
 * @param ref - String to check
 * @returns True if it matches owner@ritual format
 */
export function isOwnerRitualRef(ref: string): boolean {
  if (!ref || typeof ref !== 'string') return false;
  
  try {
    parseOwnerRitualRef(ref);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert parsed reference to registry client format (@owner/name)
 * 
 * @param parsed - Parsed reference
 * @returns Registry format reference string
 */
export function toRegistryRef(parsed: ParsedRitualRef): string {
  const versionSuffix = parsed.version ? `@${parsed.version}` : '';
  return `@${parsed.owner}/${parsed.name}${versionSuffix}`;
}

/**
 * Normalize any reference format to owner@ritual format
 * 
 * @param ref - Reference to normalize
 * @returns Normalized owner@ritual format (with version if present)
 */
export function normalizeRitualRef(ref: string): string {
  const parsed = parseOwnerRitualRef(ref);
  const versionSuffix = parsed.version ? `@${parsed.version}` : '';
  return `${parsed.owner}@${parsed.name}${versionSuffix}`;
}

// ============================================================================
// Resolution Logic
// ============================================================================

/**
 * Try to resolve from local cache
 */
async function tryResolveFromCache(
  parsed: ParsedRitualRef
): Promise<ResolvedRitual | null> {
  const version = parsed.version || 'latest';
  const cached = getCachedRitualByComponents(parsed.owner, parsed.name, version);
  
  if (!cached) {
    return null;
  }

  try {
    const ritual = parseRitualYaml(cached);
    return {
      parsedRef: parsed,
      yaml: cached,
      ritual,
      source: 'cache',
      resolvedAt: Date.now(),
    };
  } catch {
    // Cache corrupted, will refetch
    return null;
  }
}

/**
 * Try to resolve from R2 storage
 */
async function tryResolveFromR2(
  parsed: ParsedRitualRef,
  options?: R2FetchOptions
): Promise<ResolvedRitual | null> {
  try {
    const result = await fetchRitualFromR2(
      parsed.owner,
      parsed.name,
      parsed.version,
      options
    );
    
    // Cache the result for future use
    const cacheVersion = parsed.version || result.metadata?.version || 'latest';
    cacheRitualByComponents(parsed.owner, parsed.name, cacheVersion, result.yaml);
    
    return {
      parsedRef: parsed,
      yaml: result.yaml,
      ritual: parseRitualYaml(result.yaml),
      source: 'r2',
      resolvedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof RitualResolverError && error.code === 'NOT_FOUND_R2') {
      return null;
    }
    throw error;
  }
}

/**
 * Try to resolve from API (fallback)
 */
async function tryResolveFromApi(
  parsed: ParsedRitualRef,
  options?: FetchOptions
): Promise<ResolvedRitual | null> {
  try {
    const registryRef = toRegistryRef(parsed);
    const result = await fetchRitualByRef(registryRef, options);
    
    // Cache the result
    const cacheVersion = parsed.version || result.metadata.version;
    cacheRitualByComponents(parsed.owner, parsed.name, cacheVersion, result.yaml);
    
    const ritual = parseRitualYaml(result.yaml);
    
    return {
      parsedRef: parsed,
      yaml: result.yaml,
      ritual,
      source: 'api',
      resolvedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof RegistryClientError && error.isNotFound()) {
      return null;
    }
    throw error;
  }
}

/**
 * Resolve a ritual reference to its YAML content
 * 
 * Resolution order:
 * 1. Local cache (fastest)
 * 2. R2 storage (distributed cache)
 * 3. Registry API (source of truth)
 * 
 * @param ref - Ritual reference (owner@ritual or @owner/ritual format)
 * @param options - Resolution options
 * @returns Resolved ritual with metadata
 * @throws RitualResolverError if resolution fails
 */
export async function resolveRitual(
  ref: string,
  options: ResolutionOptions = {}
): Promise<ResolvedRitual> {
  const {
    skipCache = false,
    skipR2 = false,
    forceRefresh = false,
    timeoutMs = 30000,
    priority = ['cache', 'r2', 'api'],
  } = options;

  // Parse the reference
  const parsed = parseOwnerRitualRef(ref);
  
  // Determine effective priority based on options
  let effectivePriority = [...priority];
  if (forceRefresh || skipCache) {
    effectivePriority = effectivePriority.filter(p => p !== 'cache');
  }
  if (skipR2) {
    effectivePriority = effectivePriority.filter(p => p !== 'r2');
  }

  // Try each source in priority order
  const errors: Array<{ source: string; error: Error }> = [];

  for (const source of effectivePriority) {
    try {
      let result: ResolvedRitual | null = null;

      switch (source) {
        case 'cache':
          result = await tryResolveFromCache(parsed);
          break;
        case 'r2':
          result = await tryResolveFromR2(parsed, { timeoutMs });
          break;
        case 'api':
          result = await tryResolveFromApi(parsed, { timeoutMs });
          break;
      }

      if (result) {
        return result;
      }
    } catch (error) {
      errors.push({
        source,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }

  // All sources failed or returned null
  const notFoundError = errors.find(e => 
    e.error instanceof RitualResolverError && 
    (e.error.code === 'NOT_FOUND' || e.error.code === 'NOT_FOUND_R2')
  );

  if (notFoundError) {
    throw new RitualResolverError(
      `Ritual not found: ${ref}`,
      'NOT_FOUND',
      ref,
      errors.map(e => `${e.source}: ${e.error.message}`)
    );
  }

  // Construct error message from all attempts
  const errorDetails = errors.map(e => `  - ${e.source}: ${e.error.message}`).join('\n');
  throw new RitualResolverError(
    `Failed to resolve ritual "${ref}". Tried sources: ${effectivePriority.join(', ')}\n${errorDetails}`,
    'RESOLUTION_FAILED',
    ref,
    errors.map(e => `${e.source}: ${e.error.message}`)
  );
}

/**
 * Resolve multiple rituals in parallel
 * 
 * @param refs - Array of ritual references
 * @param options - Resolution options
 * @returns Map of reference to resolved ritual
 */
export async function resolveRituals(
  refs: string[],
  options: ResolutionOptions = {}
): Promise<Map<string, ResolvedRitual>> {
  const results = new Map<string, ResolvedRitual>();
  
  const promises = refs.map(async ref => {
    try {
      const resolved = await resolveRitual(ref, options);
      return { ref, resolved, error: null };
    } catch (error) {
      return { 
        ref, 
        resolved: null, 
        error: error instanceof Error ? error : new Error(String(error)) 
      };
    }
  });

  const settled = await Promise.allSettled(promises);
  
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      const { ref, resolved, error } = result.value;
      if (resolved) {
        results.set(ref, resolved);
      } else if (error) {
        throw error; // Re-throw first error
      }
    }
  }

  return results;
}

/**
 * Prefetch rituals into cache for faster access
 * 
 * @param refs - Rituals to prefetch
 * @returns Results of prefetch operation
 */
export async function prefetchRituals(
  refs: string[]
): Promise<{ ref: string; success: boolean; error?: string }[]> {
  const results = await Promise.all(
    refs.map(async ref => {
      try {
        const parsed = parseOwnerRitualRef(ref);
        
        // Skip if already cached
        const version = parsed.version || 'latest';
        const cached = getCachedRitualByComponents(parsed.owner, parsed.name, version);
        if (cached) {
          return { ref, success: true };
        }

        // Fetch and cache
        await resolveRitual(ref, { skipCache: true });
        return { ref, success: true };
      } catch (error) {
        return { 
          ref, 
          success: false, 
          error: error instanceof Error ? error.message : String(error) 
        };
      }
    })
  );

  return results;
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Custom error class for ritual resolution failures
 */
export class RitualResolverError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly ref?: string,
    public readonly details?: string[]
  ) {
    super(message);
    this.name = 'RitualResolverError';
    Object.setPrototypeOf(this, RitualResolverError.prototype);
  }

  /**
   * Check if this is a "not found" error
   */
  isNotFound(): boolean {
    return this.code === 'NOT_FOUND' || this.code === 'NOT_FOUND_R2';
  }

  /**
   * Check if this is a network/connectivity error
   */
  isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT';
  }

  /**
   * Check if this is a validation/parse error
   */
  isValidationError(): boolean {
    return this.code === 'INVALID_FORMAT' || this.code === 'PARSE_ERROR';
  }
}

// ============================================================================
// Convenience Exports
// ============================================================================

export {
  RegistryClientError,
  type Ritual,
  type FetchOptions,
} from './client.js';

export {
  type CacheEntry,
} from './cache.js';

export {
  fetchRitualFromR2,
  type R2FetchOptions,
  type R2RitualResult,
} from './r2-client.js';
