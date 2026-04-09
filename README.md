# @getmarrow/mcp

> **Memory and decision intelligence for MCP-compatible agents.**

Marrow gives your agent a memory that compounds.

With `@getmarrow/mcp`, any MCP-compatible client can log intent before acting, inspect live loop state during work, and commit outcomes back to the hive when the work is done. That means your agent stops operating like an amnesiac and starts carrying forward real decision history.

**Your agent stops repeating the same mistakes. It learns from prior sessions — and from the wider Marrow hive — through a clean MCP tool surface.**

---

## What's New in v2.8.0

**Backend API Enhancements** — New MCP tools for memory lifecycle management:

### Cross-Agent Memory Sharing
Share memories across agents in your account:
- `marrow_share_memory` — Share a memory with specific agents
- Memories shared with your agents automatically appear in `marrow_list_memories`

### Memory Export/Import
Backup and restore memories:
- `marrow_export_memories` — Export to JSON or CSV format
- `marrow_import_memories` — Import with merge (dedup) or replace mode

### Advanced FTS Filters
Precision search in `marrow_retrieve_memories`:
- `from` / `to` — Date range filters
- `tags` — Filter by tags (AND logic)
- `source` — Filter by source (e.g., `session_bootstrap`, `think`)
- `status` — Filter by status (`active`, `outdated`, `deleted`)

### New MCP Tools
- `marrow_list_memories` — List memories with pagination
- `marrow_get_memory` — Get single memory by ID
- `marrow_update_memory` — Update memory text, tags, or metadata
- `marrow_mark_outdated` — Mark memory as outdated
- `marrow_supersede` — Atomically replace memory with new version
- `marrow_delete_memory` — Soft delete memory
- `marrow_export_memories` — Export to JSON or CSV
- `marrow_import_memories` — Import memories
- `marrow_share_memory` — Share with agents
- `marrow_retrieve_memories` — FTS search with filters

### Security Hardening
- Account isolation enforced (no cross-account leakage)
- Agent ID validation on all tools
- Audit logging for export/import operations
- Rate limiting on export (5/hour)
- SHA-256 dedup on import

---

## What's New in v2.7.0

- **Portability audit** — zero workspace coupling confirmed. No `OPENCLAW_*` env vars, no private paths, no agent-name assumptions.
- **Session identity** — `MARROW_SESSION_ID` and `X-Marrow-Session-Id` header for multi-agent/multi-user setups
- **`marrow-always-on` prompt** — install once in your MCP client for automatic orient → think → commit behavior
- **TypeScript clean** — `tsc --noEmit` zero errors

## What's New in v2.6.0

- **`marrow_run` tool** — single-call memory logging. Pass description + success + outcome. Marrow handles orient → think → commit internally.
- **`MARROW_SESSION_ID` env var** — tag all requests with a session identifier
- **Auto-commit on session close** — if session ends with an open loop, Marrow commits automatically
- **Orient warnings in think response** — startup warnings now surface in `marrow_think` intelligence, not just stderr

