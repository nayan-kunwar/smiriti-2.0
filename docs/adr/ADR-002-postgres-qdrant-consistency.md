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

1. Writes the memory and audit-log entry to Postgres as separate statements (no surrounding transaction).
2. Enqueues an idempotent `embed-and-index` or `delete-vectors` BullMQ job.
3. Is eventually reflected in Qdrant by the worker.

A **periodic reconciliation job** (default every 15 minutes) pages through Postgres memories, compares the durable index state and content hash, verifies the expected Qdrant chunk points, and repairs drift. Qdrant points are matched by their `memoryId` payload, not by a point-ID prefix.

`memory_index_states` is the authoritative one-row-per-memory status (`pending` | `indexed` | `failed`). `memory_embeddings` remains the per-chunk audit/record table. A stored state hash that differs from the memory's current hash is treated as `pending`.

**Documented SLA**: target < 30 seconds for a memory to appear in semantic search under normal load. This is not synchronous — API returns `indexingStatus` on memory responses.

### Amendment 2026-10-20: Durable state, force re-enqueue, and reconciler details

The original design only inferred status from `memory_embeddings`, which could be empty or stale and could not distinguish "not yet indexed" from "indexed with old content." The implementation now:

1. Marks `memory_index_states` `pending` before enqueueing and `indexed` only after Qdrant upsert, stale-chunk pruning, and embedding-row replacement succeed.
2. Uses hash-guarded `markIndexed` / `markFailed` writes so a late worker cannot overwrite a newer content version.
3. Marks the state `failed` with the error text after the final BullMQ attempt.
4. Runs `reconcile-vectors` on a BullMQ job scheduler. Each run:
   - pages Postgres with `findAll(cursor, batchSize)`;
   - re-enqueues memories with missing state, hash mismatch, `pending`, or `failed`;
   - verifies `indexed` memories against the exact expected chunk point set and re-enqueues on mismatch;
   - scans all Qdrant points and deletes points whose memory no longer exists, after a fresh `existsByIds` check to avoid racing a concurrent create;
   - caps repairs at `RECONCILE_MAX_ENQUEUE`.
5. Re-enqueues with `force: true`. BullMQ ignores a duplicate `jobId` while a terminal job exists, so the adapter removes `failed`/`completed` jobs before re-adding; `active`, `waiting`, and `delayed` jobs are left alone.
6. After every successful upsert, the embed handler deletes Qdrant points for the memory that are no longer in the expected chunk set. This covers content shrinking and chunk-boundary changes.

Reconciliation load is bounded by `RECONCILE_BATCH_SIZE` (Postgres page size) and `RECONCILE_MAX_ENQUEUE`; the Qdrant scan currently reads all points.

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

- Return `indexingStatus` on list/get/create/update responses from `memory_index_states`; search hits report `indexed` because they are served from Qdrant.
- Delete by the `memoryId` Qdrant payload field (handles chunked memories).
- Persist exhausted `embed-and-index`/`delete-vectors` attempts in Postgres (`job_failures`) for admin listing/replay, while retaining BullMQ failed jobs in Redis; no automatic DLQ consumer in v1.
- Reconcile on a schedule and on demand; force-re-enqueue terminal jobs.

## Compliance

- No code path writes to Qdrant before Postgres commit succeeds.
- Delete cascades: Postgres row → audit log (content hash only) → enqueue vector delete.
- The API claims `pending` before enqueue; only the worker transitions state to `indexed` or `failed` and writes `memory_embeddings` after Qdrant success.
- Reconciler never deletes a point until Postgres confirms the parent memory is absent.
