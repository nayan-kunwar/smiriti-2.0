# ADR-006: Duplicate Detection — Detect and Warn in v1, Merge in v2

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering

## Context

Users and agents may attempt to store duplicate or near-duplicate memories ("I live in NYC" stored twice). Full duplicate merging requires conflict resolution UI, content fusion strategies, and audit complexity. v1 must ship a working memory system without this scope.

Alternatives considered:

1. **No dedup** — simple but pollutes memory store and degrades retrieval.
2. **Detect-only (skip or warn)** — flag duplicates, don't merge.
3. **Auto-merge on high similarity** — risky without user consent.
4. **Full merge with conflict resolution** — correct long-term, too large for v1.

## Decision

**v1 duplicate handling is detect-only:**

1. On memory create (REST or LangGraph `duplicateDetection` node), compute embedding of new content.
2. Search existing user memories above similarity threshold (e.g. cosine > 0.92).
3. If duplicate found:
   - **REST**: return `409 Conflict` with `{ existingMemoryId, similarity }` unless `?force=true` query param (admin/debug).
   - **LangGraph**: skip persist, include warning in response ("I already know you live in NYC").
4. No automatic merge, no content fusion, no duplicate row deletion in v1.

Threshold and behavior are configurable via env (`DEDUP_SIMILARITY_THRESHOLD`, default `0.92`).

## Consequences

### Positive

- Prevents obvious duplicate pollution without merge complexity.
- Clear v2 scope: merge UI, conflict resolution, consolidated importance scores.
- Golden-dataset eval can measure dedup accuracy independently.

### Negative

- Near-duplicates with different wording may slip through below threshold.
- Users see warnings rather than seamless deduplication.
- `force=true` escape hatch could be misused — restrict to admin or remove in prod if abused.

### v2 scope (deferred)

- Merge command: combine content, preserve history, update single memory.
- Conflict detection for contradictory facts ("I live in NYC" vs "I live in LA").
- User-facing duplicate review queue.

## Compliance

- `duplicateDetection` LangGraph node uses `VectorStore.search` scoped to `user_id`.
- REST create endpoint checks dedup before Postgres write (after Slice 3 embedding pipeline).
- Audit log records `memory.create.skipped_duplicate` when duplicate detected.
