import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { generateSessionId } from './chat-history.js';
import { PATHS } from '../config/paths.js';

/**
 * Record of a tool call for external consumers
 */
export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: string;
}

/**
 * Full context data for final answer generation
 */
export interface ToolContext {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
}

/**
 * Session entry type for tracking agent work on a query.
 */
export interface SessionEntry {
  type: 'init' | 'tool_result' | 'thinking';
  timestamp: string;
  content?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  llmSummary?: string;
}

/**
 * Append-only session tracker for tracking agent work on a query.
 * Uses JSONL format for resilient appending.
 */
export class Session {
  private readonly sessionDir: string;
  private readonly filepath: string;
  private readonly sessionId: string;

  constructor(query: string, options?: { sessionId?: string; baseDir?: string }) {
    const baseDir = options?.baseDir || PATHS.runs;
    this.sessionDir = baseDir;
    if (!existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true });
    }

    // Use provided sessionId or generate one matching ChatHistoryManager format
    this.sessionId = options?.sessionId || generateSessionId();
    const hash = createHash('md5').update(query).digest('hex').slice(0, 12);
    this.filepath = join(this.sessionDir, `${this.sessionId}_${hash}.jsonl`);

    this.append({ type: 'init', content: query, timestamp: new Date().toISOString() });
  }

  /**
   * Get the session ID (matches ChatHistoryManager session ID)
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Add a complete tool result with full data and LLM summary.
   */
  addToolResult(
    toolName: string,
    args: Record<string, unknown>,
    result: string,
    llmSummary: string
  ): void {
    this.append({
      type: 'tool_result',
      timestamp: new Date().toISOString(),
      toolName,
      args,
      result: this.parseResultSafely(result),
      llmSummary,
    });
  }

  private parseResultSafely(result: string): unknown {
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  }

  addThinking(thought: string): void {
    this.append({ type: 'thinking', content: thought, timestamp: new Date().toISOString() });
  }

  getToolSummaries(): string[] {
    return this.readEntries()
      .filter(e => e.type === 'tool_result' && e.llmSummary)
      .map(e => e.llmSummary!);
  }

  getToolCallRecords(): ToolCallRecord[] {
    return this.readEntries()
      .filter(e => e.type === 'tool_result' && e.toolName)
      .map(e => ({
        tool: e.toolName!,
        args: e.args!,
        result: this.stringifyResult(e.result),
      }));
  }

  getFullContexts(): ToolContext[] {
    return this.readEntries()
      .filter(e => e.type === 'tool_result' && e.toolName && e.result)
      .map(e => ({
        toolName: e.toolName!,
        args: e.args!,
        result: this.stringifyResult(e.result),
      }));
  }

  private stringifyResult(result: unknown): string {
    if (typeof result === 'string') {
      return result;
    }
    return JSON.stringify(result);
  }

  hasToolResults(): boolean {
    return this.readEntries().some(e => e.type === 'tool_result');
  }

  private append(entry: SessionEntry): void {
    appendFileSync(this.filepath, JSON.stringify(entry) + '\n');
  }

  private readEntries(): SessionEntry[] {
    if (!existsSync(this.filepath)) {
      return [];
    }

    return readFileSync(this.filepath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as SessionEntry);
  }
}
