# ADR-006: Duplicate Detection — Detect and Warn in v1, Merge in v2

**Status**: Accepted; implemented
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

1. On memory create (REST) or in the chat graph's `persist` node, search existing user memories with the new content embedding.
2. Treat a top match at or above the similarity threshold (default `0.92`) as a duplicate.
3. If duplicate found:
   - **REST**: return `409 Conflict` with `{ existingMemoryId, similarity }` unless the authenticated owner passes `?force=true` (not admin-restricted in v1).
   - **Chat**: skip persistence for that extracted memory and return a `duplicateWarnings` entry; the assistant is prompted to mention the existing memory.
4. No automatic merge, no content fusion, no duplicate row deletion in v1.

Threshold and timeout are configurable via env (`DEDUP_SIMILARITY_THRESHOLD`, default `0.92`; `DEDUP_TIMEOUT_MS`, default `2000`). Dedup is best-effort: if embedding, Qdrant, or the timeout fails, the write proceeds and async indexing remains the recovery path.

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

- REST create calls an optional `duplicateDetector` before the Postgres write; `?force=true` bypasses it.
- The chat `persist` node runs the same search per extracted memory and skips duplicates.
- Both paths use Qdrant results hydrated through the user-scoped `MemoryRepository`.
- No audit event is written for a rejected duplicate in v1; the request is logged with its correlation ID.
