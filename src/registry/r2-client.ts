/**
 * R2 Client — Cloudflare R2 client for fetching rituals from the Summon Registry
 * 
 * Fetches ritual YAML files from R2 and caches them locally for offline use.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const R2_BASE_URL = 'https://rituals.summon-ai.com';
const CACHE_DIR = join(homedir(), '.summon', 'cache', 'rituals');

export interface RitualMetadata {
  owner: string;
  name: string;
  version?: string;
  fetchedAt: Date;
  etag?: string;
}

export interface FetchedRitual {
  yaml: string;
  metadata: RitualMetadata;
  cached: boolean;
}

/**
 * Parse owner@ritual format into components
 */
export function parseRitualRef(ref: string): { owner: string; name: string; version?: string } {
  // Handle formats: owner@ritual, owner@ritual@v1.2.0, @owner/ritual
  const cleanRef = ref.replace(/^@/, '');
  
  // Check for version suffix
  const versionMatch = cleanRef.match(/@v?([\d.]+)$/);
  const version = versionMatch?.[1];
  
  // Remove version suffix for parsing
  const refWithoutVersion = version ? cleanRef.replace(/@v?[\d.]+$/, '') : cleanRef;
  
  // Split by @ or /
  const parts = refWithoutVersion.split(/[@\/]/);
  
  if (parts.length === 1) {
    // Just ritual name, use 'local' as owner
    return { owner: 'local', name: parts[0], version };
  }
  
  if (parts.length === 2) {
    return { owner: parts[0], name: parts[1], version };
  }
  
  throw new Error(`Invalid ritual reference: ${ref}`);
}

/**
 * Build R2 URL from components
 */
export function buildR2Url(owner: string, name: string, version?: string): string {
  const ritualPath = version 
    ? `${owner}@${name}/v${version}.yaml`
    : `${owner}@${name}/latest.yaml`;
  return `${R2_BASE_URL}/${ritualPath}`;
}

/**
 * Get local cache path for a ritual
 */
export function getCachePath(owner: string, name: string, version?: string): string {
  const filename = version ? `${name}@${version}.yaml` : `${name}.yaml`;
  return join(CACHE_DIR, owner, filename);
}

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir(): Promise<void> {
  if (!existsSync(CACHE_DIR)) {
    await mkdir(CACHE_DIR, { recursive: true });
  }
}

/**
 * Fetch ritual from R2 registry
 */
export async function fetchRitual(
  owner: string, 
  name: string, 
  version?: string,
  options?: { forceRefresh?: boolean }
): Promise<FetchedRitual> {
  // Check cache first (unless force refresh)
  if (!options?.forceRefresh) {
    const cached = await getRitualFromCache(owner, name, version);
    if (cached) {
      return cached;
    }
  }
  
  // Fetch from R2
  const url = buildR2Url(owner, name, version);
  
  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/yaml, text/yaml, text/plain, */*',
      },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Ritual not found: ${owner}@${name}${version ? `@v${version}` : ''}`);
      }
      throw new Error(`Failed to fetch ritual: ${response.status} ${response.statusText}`);
    }
    
    const yaml = await response.text();
    const etag = response.headers.get('etag') || undefined;
    
    // Cache the result
    const metadata = await cacheRitual(owner, name, yaml, version, etag);
    
    return {
      yaml,
      metadata,
      cached: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes('not found')) {
      throw error;
    }
    throw new Error(`Network error fetching ritual: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Cache a ritual locally
 */
export async function cacheRitual(
  owner: string,
  name: string,
  yaml: string,
  version?: string,
  etag?: string
): Promise<RitualMetadata> {
  await ensureCacheDir();
  
  const cachePath = getCachePath(owner, name, version);
  const cacheDir = dirname(cachePath);
  
  if (!existsSync(cacheDir)) {
    await mkdir(cacheDir, { recursive: true });
  }
  
  await writeFile(cachePath, yaml, 'utf-8');
  
  // Write metadata alongside
  const metadata: RitualMetadata = {
    owner,
    name,
    version,
    fetchedAt: new Date(),
    etag,
  };
  
  const metaPath = cachePath.replace('.yaml', '.meta.json');
  await writeFile(metaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  
  return metadata;
}

/**
 * Get ritual from local cache
 */
export async function getRitualFromCache(
  owner: string,
  name: string,
  version?: string
): Promise<FetchedRitual | null> {
  const cachePath = getCachePath(owner, name, version);
  
  if (!existsSync(cachePath)) {
    return null;
  }
  
  try {
    const yaml = await readFile(cachePath, 'utf-8');
    const metaPath = cachePath.replace('.yaml', '.meta.json');
    
    let metadata: RitualMetadata;
    
    if (existsSync(metaPath)) {
      const metaContent = await readFile(metaPath, 'utf-8');
      const meta = JSON.parse(metaContent);
      metadata = {
        ...meta,
        fetchedAt: new Date(meta.fetchedAt),
      };
    } else {
      metadata = {
        owner,
        name,
        version,
        fetchedAt: new Date(),
      };
    }
    
    return {
      yaml,
      metadata,
      cached: true,
    };
  } catch {
    return null;
  }
}

/**
 * Clear ritual cache for a specific owner or all
 */
export async function clearRitualCache(owner?: string): Promise<number> {
  const { rm } = await import('fs/promises');
  
  if (owner) {
    const ownerDir = join(CACHE_DIR, owner);
    if (existsSync(ownerDir)) {
      await rm(ownerDir, { recursive: true, force: true });
      return 1;
    }
    return 0;
  }
  
  if (existsSync(CACHE_DIR)) {
    await rm(CACHE_DIR, { recursive: true, force: true });
    await mkdir(CACHE_DIR, { recursive: true });
  }
  
  return 1;
}

/**
 * List cached rituals
 */
export async function listCachedRituals(owner?: string): Promise<RitualMetadata[]> {
  const { readdir } = await import('fs/promises');
  const rituals: RitualMetadata[] = [];
  
  if (!existsSync(CACHE_DIR)) {
    return rituals;
  }
  
  const owners = owner 
    ? [owner]
    : await readdir(CACHE_DIR).catch(() => [] as string[]);
  
  for (const o of owners) {
    const ownerDir = join(CACHE_DIR, o);
    if (!existsSync(ownerDir)) continue;
    
    const files = await readdir(ownerDir).catch(() => [] as string[]);
    
    for (const file of files) {
      if (file.endsWith('.meta.json')) {
        try {
          const metaPath = join(ownerDir, file);
          const metaContent = await readFile(metaPath, 'utf-8');
          const meta = JSON.parse(metaContent);
          rituals.push({
            ...meta,
            fetchedAt: new Date(meta.fetchedAt),
          });
        } catch {
          // Skip invalid metadata
        }
      }
    }
  }
  
  return rituals.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
}
