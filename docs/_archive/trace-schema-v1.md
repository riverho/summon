# Summon Trace Schema v1.0

## Overview
Structured execution logging for the Summon runtime. OTEL-compatible where applicable, but simplified for local-first architecture.

## Schema Definition

```typescript
interface SummonTrace {
  // Trace identity
  traceId: string;          // UUID v4
  sessionId: string;        // Gap chat session ID
  ritualId: string;         // @author/name@version
  ritualVersion: string;    // Specific version executed
  
  // Timing
  startTime: ISO8601;
  endTime: ISO8601;
  durationMs: number;
  
  // Execution context
  runtime: {
    version: string;        // Summon CLI version
    environment: 'local' | 'cloud';
    os: string;
    nodeVersion: string;
  };
  
  // User context
  user: {
    did?: string;           // Decentralized ID if authenticated
    anonymous: boolean;
  };
  
  // Spans (execution steps)
  spans: Span[];
  
  // Outcome
  status: 'success' | 'failure' | 'cancelled';
  error?: {
    type: string;
    message: string;
    stack?: string;
    spanId: string;         // Which span failed
  };
  
  // Costs
  cost: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedUsd: number;   // Based on model pricing
  };
  
  // Metadata
  metadata: {
    model: string;          // e.g., "openrouter/glm-5"
    temperature: number;
    toolsUsed: string[];
    custom?: Record<string, any>;
  };
}

interface Span {
  spanId: string;
  parentSpanId?: string;
  name: string;             // e.g., "llm.call", "tool.alpha_vantage"
  
  startTime: ISO8601;
  endTime: ISO8601;
  durationMs: number;
  
  // Span type
  type: 'llm' | 'tool' | 'user' | 'system' | 'reasoning';
  
  // Type-specific attributes
  attributes: SpanAttributes;
  
  // Events within span
  events: SpanEvent[];
  
  status: 'ok' | 'error';
  error?: {
    type: string;
    message: string;
  };
}

type SpanAttributes = 
  | LLMSpanAttributes
  | ToolSpanAttributes
  | UserSpanAttributes
  | SystemSpanAttributes;

interface LLMSpanAttributes {
  model: string;
  prompt: string;
  completion: string;
  temperature: number;
  maxTokens?: number;
  inputTokens: number;
  outputTokens: number;
  reasoning?: string;       // Chain-of-thought if available
}

interface ToolSpanAttributes {
  toolName: string;
  toolVersion?: string;
  input: any;
  output?: any;
  error?: string;
  latencyMs: number;
  retryCount: number;
}

interface UserSpanAttributes {
  message: string;
  role: 'user' | 'assistant';
  attachments?: string[];
}

interface SystemSpanAttributes {
  operation: string;
  details: Record<string, any>;
}

interface SpanEvent {
  timestamp: ISO8601;
  name: string;
  attributes: Record<string, any>;
}
```

## Storage

### Local File Format (JSONL)
```
~/.summon/traces/
├── 2026/
│   ├── 02/
│   │   ├── 19/
│   │   │   ├── trace-abc123.jsonl
│   │   │   └── trace-def456.jsonl
```

Each file contains one trace per line:
```jsonl
{"traceId":"...","startTime":"...",...}
{"traceId":"...","startTime":"...",...}
```

### D1 Remote Sync (optional)
- Batch upload to `execution_logs` table
- Async to not block execution
- Configurable retention (default: 90 days)

## Usage Example

```typescript
import { TraceCollector } from '@summon/telemetry';

const trace = new TraceCollector({
  ritualId: '@river/stock-checker@v1.0.0',
  sessionId: 'gap-chat-001',
  user: { anonymous: false, did: 'did:github:river' }
});

trace.start();

const llmSpan = trace.startSpan('llm.call', 'llm', {
  model: 'openrouter/glm-5',
  temperature: 0.7
});

// ... LLM call ...

llmSpan.end({
  prompt: 'What is the price of AAPL?',
  completion: 'AAPL is $182.50',
  inputTokens: 15,
  outputTokens: 8
});

trace.end({ status: 'success' });
trace.save(); // Writes to ~/.summon/traces/...
```

## OTEL Compatibility

This schema maps to OpenTelemetry:
- `traceId` → `trace_id`
- `spanId` → `span_id`
- `spans` → individual span records
- `attributes` → span attributes
- `events` → span events

Export to OTEL collector supported via:
```bash
summon telemetry export --format=otlp
```

## Versioning

- **v1.0** (Current): Initial schema
- Future versions will be backward compatible (additive only)
