# Runtime Implementation Plan

## Goal
Enable `summon run @author/name` to fetch ritual from registry and execute.

## Components

### 1. Registry Client (src/registry/client.ts)
- Fetch ritual by @author/name@version
- Download YAML from R2
- Cache locally in ~/.summon/cache/

### 2. Ritual Loader (src/ritual/loader.ts)
- Parse ritual.yaml
- Validate with zod schema
- Resolve skill bindings

### 3. Tool Resolver (src/tools/resolver.ts)
- Map tool names to implementations
- Inject secrets from ~/.summon/.env
- Handle missing tools gracefully

### 4. Runtime Engine (src/runtime/engine.ts)
- Execute ritual with Gap Chat transparency
- Collect traces
- Handle errors

### 5. CLI Integration (src/cli/index.ts)
- Add `summon run @author/name` command
- Support `--ritual` for local files (existing)
- Support `@author/name` for registry (new)

## API Endpoints to Use

```
GET https://summon-registry-api.shape02174.workers.dev/api/v1/rituals/:author/:name
→ Returns ritual metadata + download URL

GET {r2_download_url}
→ Returns ritual YAML
```

## File Structure

```
src/
├── registry/
│   ├── client.ts      # HTTP client for registry API
│   └── cache.ts       # Local caching logic
├── ritual/
│   ├── loader.ts      # Parse and validate YAML
│   └── types.ts       # Ritual type definitions
├── tools/
│   ├── resolver.ts    # Tool resolution
│   └── registry.ts    # Tool registry
├── runtime/
│   ├── engine.ts      # Execution engine
│   └── context.ts     # Execution context
└── cli/
    └── commands/
        └── run.ts     # Run command implementation
```

## Acceptance Criteria

1. `summon run @river/stock-price-checker` works end-to-end
2. Ritual is fetched from registry
3. Tools are resolved and executed
4. Gap chat shows execution transparency
5. Traces are collected (if trace module exists)

## Step 0 Constraints

- No bloat: Implement only what's needed for @author/name resolution
- Use existing CLI infrastructure
- Minimal dependencies
