import { appendFile, mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import type { StorageAdapter, SessionEvent, SessionMeta, MemoryFact, Component, ComponentType, UserConfig } from './types.js';
import { SUMMON_HOME } from '../config/paths.js';

function nowIso(): string {
  return new Date().toISOString();
}

function defaultRoot(): string {
  return SUMMON_HOME;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await ensureDir(join(path, '..'));
  await writeFile(path, JSON.stringify(value, null, 2));
}

export class LocalStorageAdapter implements StorageAdapter {
  private readonly root: string;
  private readonly sessionsDir: string;
  private readonly memoryDir: string;
  private readonly registryDir: string;
  private readonly settingsDir: string;

  constructor(rootDir: string = defaultRoot()) {
    this.root = rootDir;
    this.sessionsDir = join(rootDir, 'sessions');
    this.memoryDir = join(rootDir, 'memory');
    this.registryDir = join(rootDir, 'registry');
    this.settingsDir = join(rootDir, 'settings');
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async writeEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await ensureDir(this.sessionsDir);

    const file = join(this.sessionsDir, `${sessionId}.jsonl`);
    await appendFile(file, JSON.stringify(event) + '\n');

    // Update meta
    const meta = await this.getSessionMeta(sessionId);
    const updated: SessionMeta = {
      ...meta,
      updatedAt: nowIso(),
    };
    await writeJson(join(this.sessionsDir, `${sessionId}.meta.json`), updated);
  }

  async readEvents(sessionId: string, options?: { limit?: number; cursor?: string }): Promise<SessionEvent[]> {
    const file = join(this.sessionsDir, `${sessionId}.jsonl`);
    if (!existsSync(file)) return [];

    const raw = await readFile(file, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    // cursor is a line offset (stringified int)
    const start = options?.cursor ? Math.max(0, parseInt(options.cursor, 10) || 0) : 0;
    const slice = lines.slice(start);
    const limited = options?.limit ? slice.slice(-options.limit) : slice;

    return limited.map((l) => JSON.parse(l) as SessionEvent);
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    await ensureDir(this.sessionsDir);
    const metaPath = join(this.sessionsDir, `${sessionId}.meta.json`);

    const fallback: SessionMeta = {
      sessionId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      tags: [],
      status: 'active',
    };

    const meta = await readJson<SessionMeta>(metaPath, fallback);

    // If it didn't exist, persist the fallback immediately.
    if (!existsSync(metaPath)) {
      await writeJson(metaPath, meta);
    }

    return meta;
  }

  // ---------------------------------------------------------------------------
  // Memory
  // ---------------------------------------------------------------------------

  async appendFact(fact: MemoryFact): Promise<void> {
    await ensureDir(this.memoryDir);
    const file = join(this.memoryDir, `facts.jsonl`);
    const entry: MemoryFact = {
      ...fact,
      createdAt: fact.createdAt ?? nowIso(),
      updatedAt: fact.updatedAt ?? nowIso(),
    };
    await appendFile(file, JSON.stringify(entry) + '\n');
  }

  async queryMemory(query: string): Promise<MemoryFact[]> {
    const file = join(this.memoryDir, `facts.jsonl`);
    if (!existsSync(file)) return [];
    const raw = await readFile(file, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);

    const q = query.toLowerCase();
    return lines
      .map((l) => JSON.parse(l) as MemoryFact)
      .filter((f) => f.content?.toLowerCase().includes(q) || f.tags?.some(t => t.toLowerCase().includes(q)));
  }

  // ---------------------------------------------------------------------------
  // Registry
  // ---------------------------------------------------------------------------

  async getComponent(id: string): Promise<Component> {
    const all = await this.readComponents();
    const found = all.find(c => c.componentId === id);
    if (!found) throw new Error(`Component not found: ${id}`);
    return found;
  }

  async listComponents(type: ComponentType): Promise<Component[]> {
    const all = await this.readComponents();
    return all.filter(c => c.type === type);
  }

  private async readComponents(): Promise<Component[]> {
    await ensureDir(this.registryDir);
    const path = join(this.registryDir, 'components.json');
    return await readJson<Component[]>(path, []);
  }

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getConfig(): Promise<UserConfig> {
    await ensureDir(this.settingsDir);
    const path = join(this.settingsDir, 'config.json');
    return await readJson<UserConfig>(path, {} as UserConfig);
  }

  async setConfig(config: Partial<UserConfig>): Promise<void> {
    await ensureDir(this.settingsDir);
    const path = join(this.settingsDir, 'config.json');
    const current = await this.getConfig();
    const merged = { ...current, ...config };
    await writeJson(path, merged);
  }
}

export async function listLocalSessions(rootDir: string = defaultRoot()): Promise<string[]> {
  const dir = join(rootDir, 'sessions');
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir);
  return entries
    .filter(f => f.endsWith('.jsonl'))
    .map(f => f.replace(/\.jsonl$/, ''))
    .sort()
    .reverse();
}

export async function clearLocalSession(sessionId: string, rootDir: string = defaultRoot()): Promise<boolean> {
  try {
    const dir = join(rootDir, 'sessions');
    const file = join(dir, `${sessionId}.jsonl`);
    const meta = join(dir, `${sessionId}.meta.json`);
    if (!existsSync(file) && !existsSync(meta)) return false;
    await ensureDir(dir);
    // Truncate events but keep meta.
    await writeFile(file, '');
    return true;
  } catch {
    return false;
  }
}

export async function deleteLocalSession(sessionId: string, rootDir: string = defaultRoot()): Promise<boolean> {
  try {
    const dir = join(rootDir, 'sessions');
    const file = join(dir, `${sessionId}.jsonl`);
    const meta = join(dir, `${sessionId}.meta.json`);

    let any = false;
    if (existsSync(file)) {
      await unlink(file);
      any = true;
    }
    if (existsSync(meta)) {
      await unlink(meta);
      any = true;
    }

    return any;
  } catch {
    return false;
  }
}
