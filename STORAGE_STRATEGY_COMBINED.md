# Storage Strategy — Combined Analysis

**Generated:** 2026-02-04  
**Sources:** Codex analysis + Claude Code analysis

---

## Executive Summary

Both agents converged on the same key insight:

> **Design the abstraction layer now** so you can swap file storage for cloud storage without changing business logic.

---

## Phase 1: Local Storage (Ship First)

### Folder Structure
```
~/.summon_mem/
  v1/                          # Version boundary
    sessions/
      <session_id>/
        meta.json              # Session metadata
        events.jsonl           # Append-only event log
        artifacts/             # Tool outputs, files
    memory/
      profiles.json            # User/entity profiles
      facts.jsonl              # Long-term memory (append-only)
      embeddings.sqlite        # Optional vector store
    registry/
      index.json               # Component lookup
      personas/                # YAML files
      skills/                  # YAML files
    settings/
      config.json              # User preferences
      secrets.json             # API keys (encrypted)
    cache/                     # Disposable
    logs/                      # Debug logs
```

### Format Recommendations
| Data Type | Format | Why |
|-----------|--------|-----|
| Metadata & config | JSON | Human-readable, easy to debug |
| Event logs | JSONL | Append-only, streamable, portable |
| Indexes & queries | SQLite | Query power without a server |
| Secrets | JSON + encryption | Security layer |

### Best Practices
- **Atomic writes** — temp file + rename
- **Append-only logs** — never mutate event history
- **Versioned schema** — `v1/` folder for future migrations
- **Separate raw vs derived** — events are portable, summaries are rebuildable

---

## Phase 2: Cloud Deployment

### Server (Docker/VPS)
| Component | Technology |
|-----------|------------|
| Structured data | **Postgres** |
| Event logs & artifacts | **S3** (or compatible) |
| Embeddings | **pgvector** or dedicated vector DB |
| Cache | **Redis** (optional) |

### Serverless (Lambda/Workers/Vercel)
| Component | Technology |
|-----------|------------|
| Session state | **DynamoDB** or **Neon/PlanetScale** |
| Logs & artifacts | **S3 / R2** |
| Cache | **Upstash Redis** |
| Embeddings | **Pinecone** or managed pgvector |

### Multi-Tenant Considerations
- `tenant_id` in every row and storage key
- Encryption at rest for memory/settings
- Access control at API layer
- Log redaction for sensitive data

---

## Migration Path (Critical)

### 1. StorageAdapter Interface
```typescript
interface StorageAdapter {
  // Sessions
  writeEvent(sessionId: string, event: SessionEvent): Promise<void>;
  readEvents(sessionId: string, options?: ReadOptions): Promise<SessionEvent[]>;
  getSessionMeta(sessionId: string): Promise<SessionMeta>;
  
  // Memory
  appendFact(fact: MemoryFact): Promise<void>;
  queryMemory(query: string): Promise<MemoryFact[]>;
  
  // Registry
  getComponent(id: string): Promise<Component>;
  listComponents(type: ComponentType): Promise<Component[]>;
  
  // Settings
  getConfig(): Promise<UserConfig>;
  setConfig(config: Partial<UserConfig>): Promise<void>;
}
```

### 2. Implementations
```typescript
// Phase 1
class LocalStorageAdapter implements StorageAdapter { ... }

// Phase 2
class PostgresStorageAdapter implements StorageAdapter { ... }
class DynamoStorageAdapter implements StorageAdapter { ... }
```

### 3. Environment-Driven Selection
```typescript
function createStorageAdapter(): StorageAdapter {
  const provider = process.env.SUMMON_STORAGE || 'local';
  
  switch (provider) {
    case 'local': return new LocalStorageAdapter();
    case 'postgres': return new PostgresStorageAdapter();
    case 'dynamodb': return new DynamoStorageAdapter();
    default: throw new Error(`Unknown storage provider: ${provider}`);
  }
}
```

### 4. Migration Tools
```bash
# Export local data to portable format
summon export --format=portable --output=backup.zip

# Import into new storage
summon import --from=backup.zip --provider=postgres

# Verify migration
summon storage verify --compare=local,postgres
```

---

## Implementation Priority

1. **Define StorageAdapter interface** — this unblocks everything
2. **Implement LocalStorageAdapter** — ship Phase 1
3. **Add `v1/` folder structure** — schema versioning
4. **Build export/import tools** — future-proof
5. **Document storage schema** — for cloud migration

---

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Local format | JSON/JSONL + SQLite | Human-readable + queryable |
| Version folder | `v1/` prefix | Clean migration path |
| Events | Append-only JSONL | Portable, rebuildable |
| Abstraction | StorageAdapter interface | Swap providers without code changes |
| Cloud (server) | Postgres + S3 | Battle-tested, scalable |
| Cloud (serverless) | DynamoDB + R2 | Low-latency, pay-per-use |

---

*Synthesized from Codex and Claude Code analyses*
