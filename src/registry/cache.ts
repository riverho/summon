/**
 * Registry Cache — Local caching for rituals fetched from the registry
 * 
 * Cache location: ~/.summon/cache/
 * Structure:
 *   ~/.summon/cache/
 *     rituals/
 *       {author}/
 *         {name}/
 *           {version}.yaml
 *     index.json - Maps ritual IDs to cache entries
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { PATHS } from '../config/paths.js';

// ============================================================================
// Cache Configuration
// ============================================================================

const CACHE_DIR = join(PATHS.cache, 'rituals');
const CACHE_INDEX_FILE = join(PATHS.cache, 'index.json');
const DEFAULT_TTL_HOURS = 24; // Cache entries expire after 24 hours by default

// ============================================================================
// Types
// ============================================================================

/**
 * Cache entry metadata
 */
export interface CacheEntry {
  ritualId: string;
  author: string;
  name: string;
  version: string;
  cachedAt: number;
  expiresAt: number;
  filePath: string;
  size: number;
  etag?: string;
}

/**
 * Cache index structure
 */
interface CacheIndex {
  version: string;
  entries: Record<string, CacheEntry>;
  lastCleanedAt: number;
}

// ============================================================================
// Cache Index Management
// ============================================================================

/**
 * Ensure cache directory exists
 */
function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) {
    mkdirSync(CACHE_DIR, { recursive: true });
  }
}

/**
 * Load cache index from disk
 */
function loadCacheIndex(): CacheIndex {
  if (!existsSync(CACHE_INDEX_FILE)) {
    return {
      version: '1.0.0',
      entries: {},
      lastCleanedAt: Date.now(),
    };
  }

  try {
    const content = readFileSync(CACHE_INDEX_FILE, 'utf-8');
    return JSON.parse(content) as CacheIndex;
  } catch {
    // If index is corrupted, start fresh
    return {
      version: '1.0.0',
      entries: {},
      lastCleanedAt: Date.now(),
    };
  }
}

/**
 * Save cache index to disk
 */
function saveCacheIndex(index: CacheIndex): void {
  ensureCacheDir();
  writeFileSync(CACHE_INDEX_FILE, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Generate a unique ritual ID from components
 */
function generateRitualId(author: string, name: string, version: string): string {
  return `${author}/${name}@${version}`;
}

/**
 * Get cache file path for a ritual
 */
function getCacheFilePath(author: string, name: string, version: string): string {
  // Sanitize for filesystem
  const safeAuthor = author.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeVersion = version.replace(/[^a-zA-Z0-9._-]/g, '_');
  
  return join(CACHE_DIR, safeAuthor, safeName, `${safeVersion}.yaml`);
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Cache a ritual locally
 * 
 * @param ritualId - Unique ritual identifier (author/name@version)
 * @param yamlContent - Raw YAML content to cache
 * @param ttlHours - Time-to-live in hours (default: 24)
 * @returns Cache entry metadata
 */
export function cacheRitual(
  ritualId: string,
  yamlContent: string,
  ttlHours: number = DEFAULT_TTL_HOURS
): CacheEntry {
  ensureCacheDir();

  // Parse ritualId to get components
  const match = ritualId.match(/^([^/]+)\/([^@]+)@(.+)$/);
  if (!match) {
    throw new Error(`Invalid ritual ID format: ${ritualId}. Expected: author/name@version`);
  }

  const [, author, name, version] = match;
  const filePath = getCacheFilePath(author, name, version);

  // Ensure parent directories exist
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write YAML to cache
  writeFileSync(filePath, yamlContent, 'utf-8');

  // Create cache entry
  const now = Date.now();
  const entry: CacheEntry = {
    ritualId,
    author,
    name,
    version,
    cachedAt: now,
    expiresAt: now + ttlHours * 60 * 60 * 1000,
    filePath,
    size: Buffer.byteLength(yamlContent, 'utf-8'),
  };

  // Update index
  const index = loadCacheIndex();
  index.entries[ritualId] = entry;
  saveCacheIndex(index);

  return entry;
}

/**
 * Get a cached ritual if it exists and hasn't expired
 * 
 * @param ritualId - Unique ritual identifier (author/name@version)
 * @returns YAML content or null if not cached or expired
 */
export function getCachedRitual(ritualId: string): string | null {
  const index = loadCacheIndex();
  const entry = index.entries[ritualId];

  if (!entry) {
    return null;
  }

  // Check if expired
  if (entry.expiresAt < Date.now()) {
    // Clean up expired entry
    invalidateCacheEntry(ritualId);
    return null;
  }

  // Check if file still exists
  if (!existsSync(entry.filePath)) {
    delete index.entries[ritualId];
    saveCacheIndex(index);
    return null;
  }

  try {
    return readFileSync(entry.filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Check if a ritual is cached and still valid
 * 
 * @param ritualId - Unique ritual identifier
 * @returns True if cached and not expired
 */
export function isCached(ritualId: string): boolean {
  return getCachedRitual(ritualId) !== null;
}

/**
 * Remove a specific entry from the cache
 * 
 * @param ritualId - Ritual to remove
 */
export function invalidateCacheEntry(ritualId: string): void {
  const index = loadCacheIndex();
  const entry = index.entries[ritualId];

  if (entry) {
    // Try to delete file (ignore errors)
    try {
      if (existsSync(entry.filePath)) {
        unlinkSync(entry.filePath);
      }
    } catch {
      // Ignore deletion errors
    }

    // Remove from index
    delete index.entries[ritualId];
    saveCacheIndex(index);
  }
}

/**
 * Clear all cached rituals
 */
export function clearCache(): void {
  const index = loadCacheIndex();

  // Delete all cached files
  for (const entry of Object.values(index.entries)) {
    try {
      if (existsSync(entry.filePath)) {
        unlinkSync(entry.filePath);
      }
    } catch {
      // Ignore deletion errors
    }
  }

  // Reset index
  saveCacheIndex({
    version: '1.0.0',
    entries: {},
    lastCleanedAt: Date.now(),
  });
}

/**
 * Clean expired entries from cache
 * 
 * @returns Number of entries cleaned
 */
export function cleanExpiredEntries(): number {
  const index = loadCacheIndex();
  const now = Date.now();
  let cleaned = 0;

  for (const [ritualId, entry] of Object.entries(index.entries)) {
    if (entry.expiresAt < now) {
      try {
        if (existsSync(entry.filePath)) {
          unlinkSync(entry.filePath);
        }
      } catch {
        // Ignore deletion errors
      }
      delete index.entries[ritualId];
      cleaned++;
    }
  }

  if (cleaned > 0) {
    index.lastCleanedAt = now;
    saveCacheIndex(index);
  }

  return cleaned;
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  totalEntries: number;
  totalSize: number;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  const index = loadCacheIndex();
  const entries = Object.values(index.entries);

  if (entries.length === 0) {
    return {
      totalEntries: 0,
      totalSize: 0,
      oldestEntry: null,
      newestEntry: null,
    };
  }

  const totalSize = entries.reduce((sum, e) => sum + e.size, 0);
  const cachedAts = entries.map(e => e.cachedAt);

  return {
    totalEntries: entries.length,
    totalSize,
    oldestEntry: Math.min(...cachedAts),
    newestEntry: Math.max(...cachedAts),
  };
}

/**
 * Get list of all cached ritual IDs
 */
export function listCachedRituals(): string[] {
  const index = loadCacheIndex();
  return Object.keys(index.entries);
}

// ============================================================================
// Cache Operations (by components)
// ============================================================================

/**
 * Cache a ritual by components
 * 
 * @param author - Ritual author
 * @param name - Ritual name
 * @param version - Ritual version
 * @param yamlContent - YAML content to cache
 * @param ttlHours - Time-to-live in hours
 * @returns Cache entry metadata
 */
export function cacheRitualByComponents(
  author: string,
  name: string,
  version: string,
  yamlContent: string,
  ttlHours: number = DEFAULT_TTL_HOURS
): CacheEntry {
  const ritualId = generateRitualId(author, name, version);
  return cacheRitual(ritualId, yamlContent, ttlHours);
}

/**
 * Get cached ritual by components
 * 
 * @param author - Ritual author
 * @param name - Ritual name
 * @param version - Ritual version
 * @returns YAML content or null
 */
export function getCachedRitualByComponents(
  author: string,
  name: string,
  version: string
): string | null {
  const ritualId = generateRitualId(author, name, version);
  return getCachedRitual(ritualId);
}

// ============================================================================
// Re-exports
// ============================================================================

export { CACHE_DIR, DEFAULT_TTL_HOURS };
