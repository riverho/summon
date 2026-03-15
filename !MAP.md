# !MAP.md — summon

## Purpose
CLI framework to compose and summon AI agents using portable YAML rituals. Think "Docker for AI agents" but with YAML instead of Dockerfiles.

## Architecture Boundaries
- Local CLI runtime (no cloud sessions)
- Ritual-based agent definitions (YAML)
- MCP support (stdio + HTTP/SSE + Resources/Prompts)
- Multi-agent orchestration (parallel, sequential, hierarchical)

## Non-Goals
- Cloud session persistence
- Cross-device resume
- Built-in attention layer

## Operational Snapshot
- **Version:** 0.3.0
- **Last Sync:** 2026-03-13T10:28:05.428316+00:00
- **Description:** Wrap-up sync via service_router
- **Status:** Operational

## Entity Registry
<!-- ENTITY_REGISTRY_START -->
{
  "entities": [
    {
      "id": "E-SUMMON-CLI-01",
      "type": "CLI",
      "file_path": "src/cli/index.ts",
      "description": "Main CLI entrypoint"
    },
    {
      "id": "E-SUMMON-ORCH-01",
      "type": "Orchestrator",
      "file_path": "src/orchestration/orchestrator.ts",
      "description": "Multi-agent orchestration engine (parallel/sequential/hierarchical)"
    },
    {
      "id": "E-SUMMON-RUNTIME-01",
      "type": "Runtime",
      "file_path": "src/runtime/",
      "description": "Agent execution runtime"
    },
    {
      "id": "E-SUMMON-REGISTRY-01",
      "type": "Registry",
      "file_path": "src/registry/",
      "description": "Ritual resolver and registry client"
    },
    {
      "id": "E-SUMMON-TRAINER-01",
      "type": "Trainer",
      "file_path": "src/trainer/",
      "description": "Decision point system for agent training"
    }
  ]
}
<!-- ENTITY_REGISTRY_END -->
