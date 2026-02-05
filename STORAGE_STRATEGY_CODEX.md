# Storage Strategy (Summon AI)

This document outlines a phased storage strategy for Summon AI: local-first (Phase 1), cloud deployment (Phase 2), and a migration path that keeps the transition smooth.

## PHASE 1 (Local) - Best Practices

### Goals
- Simple, durable local storage
- Easy to inspect and debug
- Schema evolution without breaking users
- Keep clear boundaries between user data and framework metadata

### Recommended folder structure
Keep data in a single root (currently `~/.summon_mem/`). Use a versioned layout to allow evolution:

```
~/.summon_mem/
  v1/
    sessions/
      <session_id>/
        meta.json
        events.jsonl
        artifacts/
    memory/
      profiles.json
      facts.jsonl
      embeddings.sqlite
    registry/
      index.json
      personas/
      skills/
    settings/
      config.json
      secrets.json
    logs/
      summon.log
    cache/
      llm/
      tools/
```

Notes:
- `v1/` gives you a stable schema boundary. Future versions can introduce `v2/` without breaking existing installations.
- `sessions/` is append-only event data; keep it immutable where possible.
- `memory/` holds long-term context; `facts.jsonl` is append-only; `embeddings.sqlite` is optional if embeddings are used.
- `registry/` holds installed components and indexes for lookup.
- `settings/` for user-facing configuration; separate `secrets.json` to support optional encryption.
- `cache/` is explicitly disposable.

### Formats: JSON, SQLite, flat files

**Recommended mix:**
- **JSON** for stable, small metadata and configs
- **JSONL** for append-only logs, session events, tool calls
- **SQLite** for queryable data (e.g., embeddings, search index, usage stats)

**Why this mix works:**
- JSON/JSONL stays easy to inspect and diff
- SQLite adds structure and query power without requiring a separate server
- Clear separation between immutable history (JSONL) and indexable state (SQLite)

#### Suggested local schemas
1. **Session history**
   - `meta.json`:
     - `session_id`, `created_at`, `updated_at`, `model`, `tags`, `status`
   - `events.jsonl` (append-only):
     - `timestamp`, `type` (`user`, `assistant`, `tool_start`, `tool_end`, `system`), `payload`

2. **Component registry**
   - `registry/index.json`:
     - `component_id`, `type`, `version`, `path`, `hash`, `source`

3. **User settings/config**
   - `settings/config.json`:
     - `default_model`, `tool_prefs`, `telemetry`, `storage_version`

4. **Memory/context between sessions**
   - `memory/facts.jsonl`: append-only memory records
   - `memory/profiles.json`: normalized user/entity profiles
   - `memory/embeddings.sqlite`: vector store if needed

### Local best practices
- **Atomic writes** for JSON using temp file + rename
- **Append-only** for logs and events
- **Explicit versioning** per data file and folder
- **Separation of concerns**: events are immutable, summaries are derived
- **Data minimization**: avoid storing secrets in session logs

---

## PHASE 2 (Cloud) - Deployment Considerations

Phase 2 introduces multiple hosting models with different constraints. The storage model should abstract over persistence so the runtime stays consistent.

### Server deployment (Docker, VPS)
**Recommended stack:**
- Postgres for structured data (sessions, registry, settings)
- S3-compatible object storage for large artifacts and event logs
- Redis optional for caching

**Mapping from local:**
- `sessions/events.jsonl` -> S3 objects (per session or chunked)
- `sessions/meta.json` -> Postgres `sessions` table
- `memory/embeddings.sqlite` -> pgvector or an external vector DB
- `registry/` -> Postgres tables
- `settings/` -> Postgres `users` + `settings` tables

### Serverless (Lambda, Cloudflare Workers, Vercel)
**Constraints:**
- Stateless execution
- Short-lived file system
- Limited local disk

**Persistence options:**
- **S3 / R2** for logs and artifacts
- **DynamoDB / PlanetScale / Neon** for metadata and session state
- **Upstash Redis** for cache and short-term memory

**Recommended approach:**
- Store session events in object storage (chunked JSONL)
- Store summaries in DB to avoid replaying full logs
- Use dedicated vector DB or managed pgvector for embeddings

### Multi-tenant considerations
- Strong tenant isolation: use `tenant_id` in every row and storage key
- Encryption at rest for memory data and settings
- Access control at API layer, not just storage
- Log redaction or opt-out for sensitive data

### Data persistence options (summary)
- **S3/R2**: session logs, artifacts, snapshots
- **Postgres**: user profiles, settings, component registry, session metadata
- **DynamoDB**: fast session metadata or for serverless
- **Redis**: caching, in-flight sessions, rate limiting
- **Vector DB**: long-term memory embeddings

---

## MIGRATION PATH - Designing Phase 1 for Phase 2

### 1. Stable storage interface
Introduce a storage abstraction layer now so Phase 1 storage can be swapped:
- `StorageAdapter` interface: `writeEvent`, `readEvents`, `getSessionMeta`, `putMemory`, etc.
- Implement `LocalStorageAdapter` in Phase 1, `CloudStorageAdapter` later

### 2. Versioned schema and data export
- Persist `storage_version` in `settings/config.json`
- Provide `summon export --format=portable` to export JSON/JSONL bundles
- Use `summon import` to rehydrate into cloud storage

### 3. Split raw events from derived state
- Keep raw events append-only (portable)
- Derived summaries can be rebuilt (non-portable)
- This reduces migration complexity

### 4. Deterministic IDs and hashing
- Use deterministic IDs (`session_id`, `component_id`) for portability
- Hash component files so registry can be rebuilt or verified

### 5. Path-agnostic storage keys
- Avoid absolute file paths in stored metadata
- Use component IDs and logical paths

### 6. Compatibility layer for local to cloud
- Provide a migration tool that:
  - Reads local `v1/` structure
  - Writes to cloud DB + object storage
  - Preserves session history and memory

---

## Summary Recommendations

Phase 1:
- Adopt `~/.summon_mem/v1/` layout
- Use JSON/JSONL + SQLite hybrid
- Encapsulate storage behind an adapter interface

Phase 2:
- Use Postgres + S3 for server deployments
- Use DynamoDB/Neon + S3/R2 for serverless
- Add tenant isolation and encryption

Migration:
- Keep append-only event logs
- Use versioned schema and stable IDs
- Build export/import tools early
