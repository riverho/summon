# Summon Trace Schema v1.0 (Cut-Down)

## Minimal Implementation

```typescript
// src/telemetry/types.ts
interface Trace {
  traceId: string;          // UUID
  ritualId: string;         // @author/name@version
  startTime: string;        // ISO8601
  endTime: string;
  durationMs: number;
  status: 'success' | 'failure' | 'cancelled';
  error?: {
    type: string;
    message: string;
    spanId: string;
  };
  cost: {
    inputTokens: number;
    outputTokens: number;
    estimatedUsd: number;
  };
  spans: Span[];
}

interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;
  type: 'llm' | 'tool' | 'other';
  startTime: string;
  endTime: string;
  durationMs: number;
  status: 'ok' | 'error';
  attributes: Record<string, any>;
  error?: {
    type: string;
    message: string;
  };
}
```

## Storage

```
~/.summon/traces/
├── {traceId}.jsonl       # One trace per file
└── .cleanup               # Last cleanup timestamp
```

## Implementation (src/telemetry/index.ts)

```typescript
import { writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const TRACES_DIR = join(homedir(), '.summon', 'traces');
const MAX_TRACES = 1000;  // Auto-cleanup threshold

export class TraceCollector {
  private trace: Trace;
  private spans: Span[] = [];
  private spanStack: string[] = [];

  constructor(ritualId: string) {
    this.trace = {
      traceId: crypto.randomUUID(),
      ritualId,
      startTime: new Date().toISOString(),
      endTime: '',
      durationMs: 0,
      status: 'success',
      cost: { inputTokens: 0, outputTokens: 0, estimatedUsd: 0 },
      spans: []
    };
    mkdirSync(TRACES_DIR, { recursive: true });
  }

  startSpan(name: string, type: Span['type'], parentId?: string): string {
    const spanId = crypto.randomUUID();
    const span: Span = {
      spanId,
      parentSpanId: parentId || this.spanStack[this.spanStack.length - 1],
      name,
      type,
      startTime: new Date().toISOString(),
      endTime: '',
      durationMs: 0,
      status: 'ok',
      attributes: {}
    };
    this.spans.push(span);
    this.spanStack.push(spanId);
    return spanId;
  }

  endSpan(spanId: string, attributes: Record<string, any> = {}): void {
    const span = this.spans.find(s => s.spanId === spanId);
    if (!span) return;
    
    span.endTime = new Date().toISOString();
    span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime();
    span.attributes = attributes;
    
    // Update cost if LLM span
    if (span.type === 'llm' && attributes.inputTokens) {
      this.trace.cost.inputTokens += attributes.inputTokens;
      this.trace.cost.outputTokens += attributes.outputTokens || 0;
      this.trace.cost.estimatedUsd += this.calculateCost(
        attributes.model || 'unknown',
        attributes.inputTokens,
        attributes.outputTokens || 0
      );
    }
    
    // Pop from stack
    const idx = this.spanStack.indexOf(spanId);
    if (idx > -1) this.spanStack.splice(idx, 1);
  }

  fail(error: { type: string; message: string }, spanId?: string): void {
    this.trace.status = 'failure';
    this.trace.error = {
      type: error.type,
      message: error.message,
      spanId: spanId || this.spanStack[this.spanStack.length - 1] || ''
    };
    
    // Mark current span as error
    const currentSpanId = spanId || this.spanStack[this.spanStack.length - 1];
    if (currentSpanId) {
      const span = this.spans.find(s => s.spanId === currentSpanId);
      if (span) {
        span.status = 'error';
        span.error = { type: error.type, message: error.message };
      }
    }
  }

  end(): Trace {
    this.trace.endTime = new Date().toISOString();
    this.trace.durationMs = new Date(this.trace.endTime).getTime() - new Date(this.trace.startTime).getTime();
    this.trace.spans = this.spans;
    
    this.save();
    this.cleanup();
    
    return this.trace;
  }

  private save(): void {
    const filepath = join(TRACES_DIR, `${this.trace.traceId}.jsonl`);
    writeFileSync(filepath, JSON.stringify(this.trace));
  }

  private cleanup(): void {
    const files = readdirSync(TRACES_DIR)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({
        name: f,
        stat: statSync(join(TRACES_DIR, f))
      }))
      .sort((a, b) => b.stat.mtime.getTime() - a.stat.mtime.getTime());
    
    if (files.length > MAX_TRACES) {
      files.slice(MAX_TRACES).forEach(f => {
        unlinkSync(join(TRACES_DIR, f.name));
      });
    }
  }

  private calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Simple pricing (per 1K tokens)
    const pricing: Record<string, { input: number; output: number }> = {
      'openrouter/glm-5': { input: 0.0005, output: 0.0015 },
      'openrouter/claude-3.5-sonnet': { input: 0.003, output: 0.015 },
      'openrouter/gpt-4o': { input: 0.005, output: 0.015 }
    };
    
    const p = pricing[model] || { input: 0.001, output: 0.002 };
    return (inputTokens / 1000 * p.input) + (outputTokens / 1000 * p.output);
  }
}

// Usage
export function createTrace(ritualId: string): TraceCollector {
  return new TraceCollector(ritualId);
}
```

## Query for Graduation (src/telemetry/stats.ts)

```typescript
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

export function getRitualStats(ritualId: string): {
  executions: number;
  successRate: number;
  avgDurationMs: number;
  avgCostUsd: number;
  errors: number;
} {
  const traces = loadTracesForRitual(ritualId);
  
  if (traces.length === 0) {
    return { executions: 0, successRate: 0, avgDurationMs: 0, avgCostUsd: 0, errors: 0 };
  }
  
  const successful = traces.filter(t => t.status === 'success').length;
  
  return {
    executions: traces.length,
    successRate: successful / traces.length,
    avgDurationMs: traces.reduce((sum, t) => sum + t.durationMs, 0) / traces.length,
    avgCostUsd: traces.reduce((sum, t) => sum + t.cost.estimatedUsd, 0) / traces.length,
    errors: traces.filter(t => t.status === 'failure').length
  };
}

function loadTracesForRitual(ritualId: string): Trace[] {
  const dir = join(homedir(), '.summon', 'traces');
  const files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
  
  return files
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter((t): t is Trace => t !== null && t.ritualId === ritualId);
}
```

## CLI Command

```bash
summon stats @river/stock-checker
# Executions: 12
# Success Rate: 83%
# Avg Duration: 2.4s
# Avg Cost: $0.004
```
