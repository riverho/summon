import { existsSync, mkdirSync, appendFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';

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

export interface ScratchpadEntry {
  type: 'init' | 'tool_result' | 'thinking';
  timestamp: string;
  content?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  llmSummary?: string;
}

/**
 * Append-only scratchpad for tracking agent work on a query.
 * Uses JSONL format for resilient appending.
 */
export class Scratchpad {
  private readonly scratchpadDir: string;
  private readonly filepath: string;

  constructor(query: string, baseDir: string = '.braddy/scratchpad') {
    this.scratchpadDir = baseDir;
    if (!existsSync(this.scratchpadDir)) {
      mkdirSync(this.scratchpadDir, { recursive: true });
    }

    const hash = createHash('md5').update(query).digest('hex').slice(0, 12);
    const now = new Date();
    const timestamp = now.toISOString()
      .slice(0, 19)
      .replace('T', '-')
      .replace(/:/g, '');
    this.filepath = join(this.scratchpadDir, `${timestamp}_${hash}.jsonl`);

    this.append({ type: 'init', content: query, timestamp: new Date().toISOString() });
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

  private append(entry: ScratchpadEntry): void {
    appendFileSync(this.filepath, JSON.stringify(entry) + '\n');
  }

  private readEntries(): ScratchpadEntry[] {
    if (!existsSync(this.filepath)) {
      return [];
    }

    return readFileSync(this.filepath, 'utf-8')
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as ScratchpadEntry);
  }
}
