import type { StorageAdapter } from './types.js';
export * from './types.js';

/**
 * Create a storage adapter based on SUMMON_STORAGE env.
 */
export function createStorageAdapter(): StorageAdapter {
  const provider = process.env.SUMMON_STORAGE || 'local';

  switch (provider) {
    case 'local':
      throw new Error('Storage adapter "local" is not implemented yet.');
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}
