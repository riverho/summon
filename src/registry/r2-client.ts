/**
 * R2 Client — Cloudflare R2 client for fetching rituals from the Summon Registry
 * 
 * Fetches ritual YAML files from R2 and caches them locally for offline use.
 * 
 * [HARDENING] Includes request timeouts, retry logic with exponential backoff,
 * circuit breaker pattern, and graceful network error handling.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname, normalize, resolve } from 'path';
import { homedir } from 'os';

const R2_BASE_URL = 'https://rituals.summon-ai.com';
const CACHE_DIR = join(homedir(), '.summon', 'cache', 'rituals');

/**
 * SECURITY FIX: Sanitize path components to prevent directory traversal attacks
 * Rejects or escapes dangerous characters: .., /, \, null bytes
 */
function sanitizePathComponent(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('Invalid path component: must be a non-empty string');
  }

  // Reject null bytes
  if (input.includes('\0')) {
    throw new Error('Invalid path component: contains null bytes');
  }

  // Reject path traversal attempts
  if (input.includes('..')) {
    throw new Error('Invalid path component: contains path traversal sequence ".."');
  }

  // Reject absolute paths and directory separators
  if (input.includes('/') || input.includes('\\')) {
    throw new Error('Invalid path component: contains directory separators');
  }

  // Reject empty strings or strings that are just dots
  if (!input.trim() || /^\.+$/.test(input)) {
    throw new Error('Invalid path component: empty or only dots');
  }

  return input;
}

/**
 * SECURITY FIX: Validate that a resolved path stays within the cache directory
 */
function validateCachePath(resolvedPath: string): void {
  const resolvedCacheDir = resolve(CACHE_DIR);
  const resolvedTarget = resolve(resolvedPath);

  // Ensure the resolved path is within the cache directory
  if (!resolvedTarget.startsWith(resolvedCacheDir + '/') &&
      resolvedTarget !== resolvedCacheDir) {
    throw new Error('Security violation: path escapes cache directory');
  }
}

// [HARDENING] Request configuration
const DEFAULT_REQUEST_TIMEOUT_MS = 10000; // 10s timeout for R2 requests
const MAX_RETRIES = 3; // Max retry attempts
const MAX_RETRY_DELAY_MS = 30000; // Cap retry delay at 30s
const BACKOFF_MULTIPLIER = 2; // Exponential backoff multiplier

// [HARDENING] Circuit breaker configuration
const CIRCUIT_BREAKER_THRESHOLD = 5; // Failures before opening circuit
const CIRCUIT_BREAKER_RESET_MS = 60000; // 1 minute before trying again

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/**
 * [HARDENING] Circuit breaker for R2 requests
 * Prevents cascading failures when R2 is unavailable
 */
class R2CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttempt = 0;

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'CLOSED';
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailureTime = Date.now();

    if (this.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state = 'OPEN';
      this.nextAttempt = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    }
  }

  canExecute(): boolean {
    if (this.state === 'CLOSED') return true;
    
    if (this.state === 'OPEN') {
      if (Date.now() >= this.nextAttempt) {
        this.state = 'HALF_OPEN';
        return true;
      }
      return false;
    }
    
    // HALF_OPEN - allow one request to test
    return true;
  }

  getState(): CircuitState {
    return this.state;
  }

  getRemainingCooldown(): number {
    if (this.state !== 'OPEN') return 0;
    return Math.max(0, this.nextAttempt - Date.now());
  }
}

// [HARDENING] Global circuit breaker instance
const circuitBreaker = new R2CircuitBreaker();

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

export interface FetchOptions {
  forceRefresh?: boolean;
  timeoutMs?: number;
  retries?: number;
}

/**
 * [HARDENING] Fetch with timeout using AbortController
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * [HARDENING] Sleep utility for retry delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * [HARDENING] Calculate retry delay with exponential backoff and jitter
 */
function calculateRetryDelay(attempt: number): number {
  const baseDelay = Math.min(
    1000 * Math.pow(BACKOFF_MULTIPLIER, attempt),
    MAX_RETRY_DELAY_MS
  );
  // Add jitter (±25%) to prevent thundering herd
  const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, baseDelay + jitter);
}

/**
 * [HARDENING] Check if error is retryable
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    // Retry on network errors, timeouts, and 5xx errors
    if (message.includes('timeout') || 
        message.includes('network') ||
        message.includes('econnrefused') ||
        message.includes('enotfound') ||
        message.includes('etimedout') ||
        message.includes('socket') ||
        message.includes('fetch failed')) {
      return true;
    }
    // Don't retry 4xx errors (client errors)
    if (message.includes('404') || message.includes('403') || message.includes('401')) {
      return false;
    }
  }
  return true; // Default to retry for unknown errors
}

/**
 * [HARDENING] Classify HTTP status codes
 */
function classifyHttpError(status: number): { retryable: boolean; message: string } {
  switch (status) {
    case 404:
      return { retryable: false, message: 'Ritual not found' };
    case 403:
      return { retryable: false, message: 'Access denied' };
    case 401:
      return { retryable: false, message: 'Unauthorized' };
    case 429:
      return { retryable: true, message: 'Rate limited - retry after delay' };
    case 500:
    case 502:
    case 503:
    case 504:
      return { retryable: true, message: `Server error (${status})` };
    default:
      if (status >= 500) {
        return { retryable: true, message: `Server error (${status})` };
      }
      return { retryable: false, message: `HTTP error (${status})` };
  }
}

/**
 * Parse owner@ritual format into components
 * SECURITY FIX: Sanitizes inputs to prevent path traversal attacks
 */
export function parseRitualRef(ref: string): { owner: string; name: string; version?: string } {
  // [HARDENING] Input validation
  if (!ref || typeof ref !== 'string') {
    throw new Error('Invalid ritual reference: empty or non-string value');
  }

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
    // SECURITY FIX: Sanitize the name to prevent path traversal
    return { owner: 'local', name: sanitizePathComponent(parts[0]), version };
  }

  if (parts.length === 2) {
    // SECURITY FIX: Sanitize both owner and name to prevent path traversal
    return {
      owner: sanitizePathComponent(parts[0]),
      name: sanitizePathComponent(parts[1]),
      version
    };
  }

  throw new Error(`Invalid ritual reference: ${ref}`);
}

/**
 * Build R2 URL from components
 */
export function buildR2Url(owner: string, name: string, version?: string): string {
  // [HARDENING] Input validation
  if (!owner || !name) {
    throw new Error('Owner and name are required to build R2 URL');
  }
  
  const ritualPath = version 
    ? `${owner}@${name}/v${version}.yaml`
    : `${owner}@${name}/latest.yaml`;
  return `${R2_BASE_URL}/${ritualPath}`;
}

/**
 * Get local cache path for a ritual
 * SECURITY FIX: Validates path doesn't escape cache directory
 */
export function getCachePath(owner: string, name: string, version?: string): string {
  // SECURITY FIX: Sanitize all path components
  const safeOwner = sanitizePathComponent(owner);
  const safeName = sanitizePathComponent(name);
  const safeVersion = version ? sanitizePathComponent(version) : undefined;

  const filename = safeVersion ? `${safeName}@${safeVersion}.yaml` : `${safeName}.yaml`;
  const cachePath = join(CACHE_DIR, safeOwner, filename);

  // SECURITY FIX: Validate final path stays within cache directory
  validateCachePath(cachePath);

  return cachePath;
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
 * [HARDENING] Fetch with retry logic and circuit breaker
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs: number,
  maxRetries: number
): Promise<Response> {
  // Check circuit breaker
  if (!circuitBreaker.canExecute()) {
    const remainingMs = circuitBreaker.getRemainingCooldown();
    throw new Error(`Circuit breaker is OPEN. Try again in ${Math.ceil(remainingMs / 1000)}s`);
  }

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      
      // Handle HTTP errors
      if (!response.ok) {
        const classification = classifyHttpError(response.status);
        
        if (!classification.retryable || attempt >= maxRetries) {
          if (response.status === 404) {
            throw new Error(`Ritual not found`);
          }
          throw new Error(`Failed to fetch ritual: ${response.status} ${response.statusText}`);
        }
        
        // Retryable HTTP error - wait and retry
        const delay = calculateRetryDelay(attempt);
        await sleep(delay);
        continue;
      }
      
      // Success - record in circuit breaker
      circuitBreaker.recordSuccess();
      return response;
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Check if we should retry
      if (attempt >= maxRetries || !isRetryableError(error)) {
        break;
      }
      
      // Wait with exponential backoff
      const delay = calculateRetryDelay(attempt);
      await sleep(delay);
    }
  }

  // All retries exhausted - record failure and throw
  circuitBreaker.recordFailure();
  throw lastError || new Error('Request failed after retries');
}

/**
 * Fetch ritual from R2 registry
 */
export async function fetchRitual(
  owner: string, 
  name: string, 
  version?: string,
  options?: FetchOptions
): Promise<FetchedRitual> {
  // [HARDENING] Input validation
  if (!owner || !name) {
    throw new Error('Owner and name are required to fetch ritual');
  }
  
  const timeoutMs = options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const maxRetries = options?.retries ?? MAX_RETRIES;
  
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
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          'Accept': 'application/yaml, text/yaml, text/plain, */*',
        },
      },
      timeoutMs,
      maxRetries
    );
    
    const yaml = await response.text();
    const etag = response.headers.get('etag') || undefined;
    
    // [HARDENING] Validate YAML content
    if (!yaml || yaml.trim().length === 0) {
      throw new Error('Received empty ritual content from R2');
    }
    
    // Cache the result
    const metadata = await cacheRitual(owner, name, yaml, version, etag);
    
    return {
      yaml,
      metadata,
      cached: false,
    };
  } catch (error) {
    // [HARDENING] Enhanced error classification
    if (error instanceof Error) {
      // Pass through specific errors
      if (error.message.includes('not found') || 
          error.message.includes('Circuit breaker') ||
          error.message.includes('timeout')) {
        throw error;
      }
      
      // Wrap network errors with context
      throw new Error(`Network error fetching ritual ${owner}@${name}: ${error.message}`);
    }
    
    throw new Error(`Unexpected error fetching ritual: ${String(error)}`);
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
  
  // [HARDENING] Atomic write - write to temp file then rename
  const tempPath = `${cachePath}.tmp`;
  await writeFile(tempPath, yaml, 'utf-8');
  
  // Rename for atomicity
  const { rename } = await import('fs/promises');
  await rename(tempPath, cachePath);
  
  // Write metadata alongside
  const metadata: RitualMetadata = {
    owner,
    name,
    version,
    fetchedAt: new Date(),
    etag,
  };
  
  const metaPath = cachePath.replace('.yaml', '.meta.json');
  const tempMetaPath = `${metaPath}.tmp`;
  await writeFile(tempMetaPath, JSON.stringify(metadata, null, 2), 'utf-8');
  await rename(tempMetaPath, metaPath);
  
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
    
    // [HARDENING] Validate cached content
    if (!yaml || yaml.trim().length === 0) {
      return null;
    }
    
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
    // [HARDENING] Return null on any error - fail closed
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
          // Skip invalid metadata - [HARDENING] fail closed, skip corrupt entries
        }
      }
    }
  }
  
  return rituals.sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime());
}

/**
 * [HARDENING] Get circuit breaker state for monitoring
 */
export function getCircuitBreakerState(): {
  state: CircuitState;
  failures: number;
  remainingCooldownMs: number;
} {
  return {
    state: circuitBreaker.getState(),
    failures: circuitBreaker['failures'] ?? 0,
    remainingCooldownMs: circuitBreaker.getRemainingCooldown(),
  };
}

/**
 * [HARDENING] Reset circuit breaker (for testing or recovery)
 */
export function resetCircuitBreaker(): void {
  circuitBreaker.recordSuccess();
}

// Aliases for backward compatibility
export const fetchRitualFromR2 = fetchRitual;
export type R2FetchOptions = FetchOptions;
export type R2RitualResult = FetchedRitual;
