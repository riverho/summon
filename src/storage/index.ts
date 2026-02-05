import type { StorageAdapter } from './types.js';
import { LocalStorageAdapter } from './local.js';

export * from './types.js';
export * from './local.js';

/**
 * Create a storage adapter based on SUMMON_STORAGE env.
 */
export function createStorageAdapter(): StorageAdapter {
  const provider = process.env.SUMMON_STORAGE || 'local';

  switch (provider) {
    case 'local':
      return new LocalStorageAdapter();
    default:
      throw new Error(`Unknown storage provider: ${provider}`);
  }
}
