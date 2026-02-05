import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORAGE_BASE = join(homedir(), '.summon_mem', 'sessions');

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
  storagePath?: string;
  maxHistorySize?: number;
}

function ensureDir(path: string): Promise<void> {
  return fs.mkdir(path, { recursive: true }).then(() => undefined);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_]/g, '');
}

export function generateSessionId(): string {
  const now = new Date();
  const date = now.toISOString().split('T')[0];
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
  const random = Math.random().toString(36).substring(2, 10);
  return `${date}_${time}_${random}`;
}

export class ChatHistoryManager {
  private sessionId: string;
  private storagePath: string;
  private history: ChatHistory;
  private maxHistorySize: number;

  constructor(options: ChatHistoryOptions = {}) {
    this.sessionId = options.sessionId || generateSessionId();
    this.storagePath = options.storagePath || STORAGE_BASE;
    this.maxHistorySize = options.maxHistorySize || 100;
    this.history = {
      sessionId: this.sessionId,
      createdAt: new Date().toISOString(),
      lastUsed: new Date().toISOString(),
      messages: [],
    };
  }

  getSessionId(): string {
    return this.sessionId;
  }

  saveUserQuery(query: string): number {
    const id = this.history.messages.length;
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
        timestamp: new Date().toISOString(),
      },
    });
    this.history.lastUsed = new Date().toISOString();
    return id;
  }

  saveAnswer(
    answer: string,
    metadata: { model: string; iterations: number; toolsUsed: string[] }
  ): void {
    const lastMessage = this.history.messages[this.history.messages.length - 1];
    if (lastMessage && lastMessage.role === 'user' && lastMessage.answer === null) {
      lastMessage.answer = answer;
      lastMessage.summary = this.summarizeAnswer(lastMessage.query, answer);
      lastMessage.metadata = {
        ...metadata,
        timestamp: new Date().toISOString(),
      };
      this.history.lastUsed = new Date().toISOString();
    }
  }

  private summarizeAnswer(query: string, answer: string): string {
    const preview = answer.slice(0, 200);
    return `Answer to: ${query.slice(0, 50)}... "${preview}"`;
  }

  getMessages(): ChatMessage[] {
    return [...this.history.messages];
  }

  getLastMessage(): ChatMessage | null {
    return this.history.messages[this.history.messages.length - 1] || null;
  }

  getUserMessages(): string[] {
    return this.history.messages
      .filter((m) => m.role === 'user')
      .map((m) => m.query);
  }

  hasMessages(): boolean {
    return this.history.messages.length > 0;
  }

  clear(): void {
    this.history.messages = [];
    this.history.lastUsed = new Date().toISOString();
  }

  async load(): Promise<boolean> {
    try {
      const filepath = this.getSessionFilePath();
      const data = await fs.readFile(filepath, 'utf-8');
      this.history = JSON.parse(data);
      this.sessionId = this.history.sessionId;
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    await ensureDir(this.storagePath);
    const filepath = this.getSessionFilePath();
    await fs.writeFile(filepath, JSON.stringify(this.history, null, 2));
  }

  private getSessionFilePath(): string {
    const sanitized = sanitizeFilename(this.sessionId);
    return join(this.storagePath, `${sanitized}.json`);
  }

  static async listSessions(storagePath: string = STORAGE_BASE): Promise<string[]> {
    try {
      const files = await fs.readdir(storagePath);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''))
        .sort()
        .reverse();
    } catch {
      return [];
    }
  }

  static async getSession(
    sessionId: string,
    storagePath: string = STORAGE_BASE
  ): Promise<ChatHistory | null> {
    try {
      const filepath = join(storagePath, `${sanitizeFilename(sessionId)}.json`);
      const data = await fs.readFile(filepath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  static async deleteSession(
    sessionId: string,
    storagePath: string = STORAGE_BASE
  ): Promise<boolean> {
    try {
      const filepath = join(storagePath, `${sanitizeFilename(sessionId)}.json`);
      await fs.unlink(filepath);
      return true;
    } catch {
      return false;
    }
  }
}
