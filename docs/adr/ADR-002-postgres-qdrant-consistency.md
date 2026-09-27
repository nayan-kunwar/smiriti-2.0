# ADR-002: Postgres as Source of Truth with Async Qdrant Sync

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering  

## Context

Memory content and metadata must never be lost or silently corrupted. Vector embeddings are derived data that can be regenerated from Postgres content. Qdrant operations can fail transiently or leave orphaned points after partial failures.

Alternatives considered:

1. **Postgres SoT + async BullMQ sync** — write Postgres first, enqueue embed job.
2. **Dual write (Postgres + Qdrant in same request)** — synchronous consistency.
3. **Qdrant as primary for search, Postgres for metadata** — split brain risk.
4. **Postgres pgvector extension** — single store, simpler consistency, weaker vector features at scale.

## Decision

**PostgreSQL is the sole source of truth.** Every memory write:

1. Commits to Postgres inside a transaction (including audit log).
2. Enqueues an idempotent `embed-and-index` or `delete-vectors` BullMQ job.
3. Is eventually reflected in Qdrant by the worker.

A **periodic reconciliation job** (every 15 minutes) compares Postgres memory IDs against Qdrant point IDs (matching `memoryId` prefix for chunked entries) and repairs drift.

`memory_embeddings` table tracks per-chunk indexing status (`pending` | `indexed` | `failed`).

**Documented SLA**: target < 30 seconds for a memory to appear in semantic search under normal load. This is not synchronous — API returns `indexingStatus` on memory responses.

## Consequences

### Positive

- Memory writes are durable even if Qdrant is down.
- Failed embed jobs can be retried without re-writing Postgres.
- Reconciliation provides a safety net for orphaned or missing vectors.
- Embeddings can be fully regenerated from Postgres (migration path for provider changes).

### Negative

- Brief eventual-consistency window after writes and deletes.
- API consumers must understand `indexingStatus` field.
- Reconciliation adds background load and implementation complexity.

### Mitigations

- Return `indexingStatus` on all memory responses.
- Delete by `memoryId` prefix in Qdrant (handles chunked memories).
- DLQ + alert logging for permanently failed jobs.

## Compliance

- No code path writes to Qdrant before Postgres commit succeeds.
- Delete cascades: Postgres row → enqueue vector delete → audit log (content hash only).
