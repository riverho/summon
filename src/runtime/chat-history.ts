import { createStorageAdapter } from '../storage/index.js';
import type { StorageAdapter, SessionEvent } from '../storage/types.js';
import { listLocalSessions, deleteLocalSession, clearLocalSession } from '../storage/local.js';

// NOTE: ChatHistoryManager is the UX-friendly session layer used by the CLI.
// It is now implemented *on top of* the StorageAdapter (local JSONL events),
// so we have a single persistence path.

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  query: string;
  answer: string | null;
  summary: string | null;
  metadata: {
    model: string;
    iterations: number;
    toolsUsed: string[];
    timestamp: string;
  };
}

export interface ChatHistory {
  sessionId: string;
  createdAt: string;
  lastUsed: string;
  messages: ChatMessage[];
}

export interface ChatHistoryOptions {
  sessionId?: string;
  maxHistorySize?: number;
  storage?: StorageAdapter;
}

export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 10);
  return `${date}_${time}_${random}`;
}

function summarizeAnswer(query: string, answer: string): string {
  const preview = answer.slice(0, 200);
  return `Answer to: ${query.slice(0, 50)}... "${preview}"`;
}

type UserPayload = { query: string };

type AssistantPayload = {
  answer: string;
  summary: string;
  metadata: { model: string; iterations: number; toolsUsed: string[] };
};

function isUserEvent(ev: SessionEvent): ev is SessionEvent & { type: 'user'; payload: UserPayload } {
  return ev.type === 'user' && typeof ev.payload === 'object' && ev.payload !== null && 'query' in (ev.payload as any);
}

function isAssistantEvent(
  ev: SessionEvent
): ev is SessionEvent & { type: 'assistant'; payload: AssistantPayload } {
  return ev.type === 'assistant' && typeof ev.payload === 'object' && ev.payload !== null && 'answer' in (ev.payload as any);
}

export class ChatHistoryManager {
  private sessionId: string;
  private history: ChatHistory;
  private maxHistorySize: number;
  private storage: StorageAdapter;

  constructor(options: ChatHistoryOptions = {}) {
    this.sessionId = options.sessionId || generateSessionId();
    this.maxHistorySize = options.maxHistorySize || 100;
    this.storage = options.storage ?? createStorageAdapter();

    const now = new Date().toISOString();
    this.history = {
      sessionId: this.sessionId,
      createdAt: now,
      lastUsed: now,
      messages: [],
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessages(): ChatMessage[] {
    return [...this.history.messages];
  }

  getLastMessage(): ChatMessage | null {
    return this.history.messages[this.history.messages.length - 1] || null;
  }

  getUserMessages(): string[] {
    return this.history.messages.filter(m => m.role === 'user').map(m => m.query);
  }

  hasMessages(): boolean {
    return this.history.messages.length > 0;
  }

  /**
   * Record the user's query as a session event.
   */
  saveUserQuery(query: string): number {
    const id = this.history.messages.length;
    const timestamp = new Date().toISOString();

    this.history.messages.push({
      id,
      role: 'user',
      query,
      answer: null,
      summary: null,
      metadata: {
        model: '',
        iterations: 0,
        toolsUsed: [],
        timestamp,
      },
    });
    this.history.lastUsed = timestamp;

    // Best-effort persist immediately.
    void this.storage.writeEvent(this.sessionId, {
      timestamp,
      type: 'user',
      payload: { query },
    });

    return id;
  }

  /**
   * Record the assistant's answer as a session event.
   */
  saveAnswer(answer: string, metadata: { model: string; iterations: number; toolsUsed: string[] }): void {
    const last = this.history.messages[this.history.messages.length - 1];
    if (!last || last.role !== 'user' || last.answer !== null) return;

    const timestamp = new Date().toISOString();
    last.answer = answer;
    last.summary = summarizeAnswer(last.query, answer);
    last.metadata = {
      ...metadata,
      timestamp,
    };
    this.history.lastUsed = timestamp;

    void this.storage.writeEvent(this.sessionId, {
      timestamp,
      type: 'assistant',
      payload: {
        answer,
        summary: last.summary,
        metadata,
      },
    });
  }

  clear(): void {
    this.history.messages = [];
    this.history.lastUsed = new Date().toISOString();
  }

  /**
   * Load from storage events and rebuild the in-memory history.
   */
  async load(): Promise<boolean> {
    try {
      const meta = await this.storage.getSessionMeta(this.sessionId);
      const events = await this.storage.readEvents(this.sessionId);

      const messages: ChatMessage[] = [];
      let msgId = 0;
      let pendingUser: { query: string; timestamp: string } | null = null;

      for (const ev of events) {
        if (isUserEvent(ev)) {
          pendingUser = { query: (ev.payload as any).query, timestamp: ev.timestamp };
          continue;
        }

        if (isAssistantEvent(ev) && pendingUser) {
          const payload = ev.payload as any as AssistantPayload;
          messages.push({
            id: msgId,
            role: 'user',
            query: pendingUser.query,
            answer: payload.answer,
            summary: payload.summary,
            metadata: {
              model: payload.metadata?.model ?? '',
              iterations: payload.metadata?.iterations ?? 0,
              toolsUsed: payload.metadata?.toolsUsed ?? [],
              timestamp: ev.timestamp,
            },
          });
          msgId += 1;
          pendingUser = null;
        }
      }

      // If there's a dangling user query without an answer, keep it.
      if (pendingUser) {
        messages.push({
          id: msgId,
          role: 'user',
          query: pendingUser.query,
          answer: null,
          summary: null,
          metadata: { model: '', iterations: 0, toolsUsed: [], timestamp: pendingUser.timestamp },
        });
      }

      // Enforce max history size
      const trimmed = messages.slice(-this.maxHistorySize);

      this.history = {
        sessionId: this.sessionId,
        createdAt: meta.createdAt,
        lastUsed: meta.updatedAt,
        messages: trimmed,
      };

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Save is now effectively a no-op because events are persisted incrementally.
   * Kept for backward compatibility.
   */
  async save(): Promise<void> {
    // no-op
  }

  // ---------------------------------------------------------------------------
  // Static helpers (used by CLI)
  // ---------------------------------------------------------------------------

  static async listSessions(): Promise<string[]> {
    return listLocalSessions();
  }

  static async getSession(sessionId: string): Promise<ChatHistory | null> {
    const manager = new ChatHistoryManager({ sessionId });
    const ok = await manager.load();
    return ok ? (manager.history as ChatHistory) : null;
  }

  static async deleteSession(sessionId: string): Promise<boolean> {
    return deleteLocalSession(sessionId);
  }

  static async clearSession(sessionId: string): Promise<boolean> {
    return clearLocalSession(sessionId);
  }
}
