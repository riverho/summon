/**
 * Registry Client — HTTP client for fetching rituals from the Summon Registry
 * 
 * API Base: https://summon-registry-api.shape02174.workers.dev
 * 
 * Endpoints:
 * - GET /api/v1/rituals/:author/:name -> returns ritual metadata
 * - GET /api/v1/rituals/:author/:name/:version/download -> returns YAML
 */

import { PATHS } from '../config/paths.js';

// Registry API Configuration
const REGISTRY_API_BASE = 'https://summon-registry-api.shape02174.workers.dev';

// ============================================================================
// Types
// ============================================================================

/**
 * Ritual metadata returned by the registry API
 */
export interface RitualMetadata {
  id: string;
  author: string;
  name: string;
  version: string;
  description?: string;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  dependencies?: string[];
}

/**
 * Ritual object combining metadata and content
 */
export interface Ritual {
  metadata: RitualMetadata;
  yaml: string;
}

/**
 * Registry API error response
 */
export interface RegistryError {
  error: string;
  code: string;
  details?: string;
}

/**
 * Options for fetching rituals
 */
export interface FetchOptions {
  version?: string;
  skipCache?: boolean;
  timeoutMs?: number;
}

// ============================================================================
// Registry Client
// ============================================================================

/**
 * Fetch ritual metadata from the registry
 * 
 * @param author - Ritual author/namespace
 * @param name - Ritual name
 * @param version - Optional version (defaults to latest)
 * @returns Ritual metadata
 */
export async function fetchRitualMetadata(
  author: string,
  name: string,
  version?: string
): Promise<RitualMetadata> {
  const url = version
    ? `${REGISTRY_API_BASE}/api/v1/rituals/${encodeURIComponent(author)}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
    : `${REGISTRY_API_BASE}/api/v1/rituals/${encodeURIComponent(author)}/${encodeURIComponent(name)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'summon-runtime/0.1.0',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    let errorData: RegistryError | undefined;
    
    try {
      errorData = JSON.parse(errorText) as RegistryError;
    } catch {
      // Not JSON, use text as-is
    }

    throw new RegistryClientError(
      errorData?.error || `Failed to fetch ritual metadata: ${response.statusText}`,
      response.status,
      errorData?.code || 'UNKNOWN_ERROR'
    );
  }

  const data = await response.json() as RitualMetadata;
  return data;
}

/**
 * Get the download URL for a ritual
 * 
 * @param metadata - Ritual metadata from fetchRitualMetadata
 * @returns Direct download URL for the ritual YAML
 */
export function getDownloadUrl(metadata: RitualMetadata): string {
  // If the metadata already has a downloadUrl, use it
  if (metadata.downloadUrl) {
    return metadata.downloadUrl;
  }

  // Otherwise construct it from the registry API
  return `${REGISTRY_API_BASE}/api/v1/rituals/${encodeURIComponent(metadata.author)}/${encodeURIComponent(metadata.name)}/${encodeURIComponent(metadata.version)}/download`;
}

/**
 * Download ritual YAML content
 * 
 * @param downloadUrl - URL to download the YAML from
 * @returns Raw YAML content
 */
export async function downloadRitualYaml(downloadUrl: string): Promise<string> {
  const response = await fetch(downloadUrl, {
    method: 'GET',
    headers: {
      'Accept': 'text/yaml, text/plain, application/octet-stream, */*',
      'User-Agent': 'summon-runtime/0.1.0',
    },
  });

  if (!response.ok) {
    throw new RegistryClientError(
      `Failed to download ritual: ${response.statusText}`,
      response.status,
      'DOWNLOAD_FAILED'
    );
  }

  return response.text();
}

/**
 * Fetch a complete ritual (metadata + YAML content)
 * 
 * @param author - Ritual author/namespace
 * @param name - Ritual name  
 * @param options - Fetch options (version, skipCache, timeout)
 * @returns Complete ritual with metadata and YAML
 */
export async function fetchRitual(
  author: string,
  name: string,
  options: FetchOptions = {}
): Promise<Ritual> {
  const { version } = options;

  // Fetch metadata first
  const metadata = await fetchRitualMetadata(author, name, version);

  // Get download URL
  const downloadUrl = getDownloadUrl(metadata);

  // Download the YAML content
  const yaml = await downloadRitualYaml(downloadUrl);

  return {
    metadata,
    yaml,
  };
}

/**
 * Parse @author/name[@version] reference
 * 
 * @param ref - Reference string like "@river/stock-price-checker" or "@river/stock-price-checker@1.0.0"
 * @returns Parsed components
 */
export function parseRitualRef(ref: string): { author: string; name: string; version?: string } {
  // Remove leading @ if present
  const cleanRef = ref.startsWith('@') ? ref.slice(1) : ref;

  // Parse author/name@version format
  const match = cleanRef.match(/^([^/]+)\/([^@]+)(?:@(.+))?$/);
  
  if (!match) {
    throw new RegistryClientError(
      `Invalid ritual reference: ${ref}. Expected format: @author/name or @author/name@version`,
      400,
      'INVALID_REFERENCE'
    );
  }

  const [, author, name, version] = match;
  
  return {
    author,
    name,
    version: version || undefined,
  };
}

/**
 * Fetch ritual by reference string (@author/name[@version])
 * 
 * @param ref - Reference like "@river/stock-price-checker"
 * @param options - Fetch options
 * @returns Complete ritual
 */
export async function fetchRitualByRef(
  ref: string,
  options: FetchOptions = {}
): Promise<Ritual> {
  const { author, name, version } = parseRitualRef(ref);
  return fetchRitual(author, name, { ...options, version });
}

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Custom error class for registry client errors
 */
export class RegistryClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(message);
    this.name = 'RegistryClientError';
    Object.setPrototypeOf(this, RegistryClientError.prototype);
  }

  /**
   * Check if this is a "not found" error
   */
  isNotFound(): boolean {
    return this.statusCode === 404 || this.code === 'RITUAL_NOT_FOUND';
  }

  /**
   * Check if this is an auth error
   */
  isAuthError(): boolean {
    return this.statusCode === 401 || this.statusCode === 403;
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { REGISTRY_API_BASE };
