# ADR-003: Token-Based Chunking with Composite Qdrant Point IDs

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering

## Context

Most memories are short atomic facts (< 500 tokens). Occasionally users paste long content or the agent extracts multi-paragraph memories. Embedding entire documents in a single vector degrades retrieval quality for specific facts within the text.

Alternatives considered:

1. **Always single vector per memory** — simple but poor retrieval for long content.
2. **Always chunk** — unnecessary complexity for short facts.
3. **Token-threshold hybrid** — atomic under threshold, chunked above.
4. **Sentence-level chunking** — more granular but harder to tune and more Qdrant points.

## Decision

Apply **token-count-based chunking at embedding time** (not at memory creation):

| Condition             | Behavior                                                |
| --------------------- | ------------------------------------------------------- |
| Content ≤ ~500 tokens | Single vector, one Qdrant point, point ID = `memoryId`  |
| Content > ~500 tokens | Split into 800–1000 token chunks with 100 token overlap |

**Qdrant point IDs**:

- Atomic: `{memoryId}` (UUID string)
- Chunked: `{memoryId}_{chunkIndex}` (e.g. `abc123_0`, `abc123_1`)

**Retrieval rule**: Search returns chunk hits internally; API layer deduplicates to parent memory, ranking by best chunk score. Chunk IDs are never exposed to API consumers.

**Qdrant payload** (all points): `user_id`, `memory_id`, `tags`, `category`, `is_archived`, `chunk_index`.

## Consequences

### Positive

- Short memories stay simple (one point, one embed call).
- Long content retrieves specific relevant sections.
- Explicit one-to-many memory→vector relationship in `memory_embeddings` table.

### Negative

- Chunked memories cost more embedding API calls and Qdrant storage.
- Delete must match all points by `memoryId` prefix.
- Reconciliation must account for variable point counts per memory.

### Implementation notes

- Token counting uses the same tokenizer family as the embedding model where possible; fallback to `gpt-tokenizer` or character heuristic with safety margin.
- `memory_embeddings` row per chunk tracks `chunk_index`, `token_count`, `qdrant_point_id`, `status`.

## Compliance

- Worker `embed-and-index` job implements this rule exclusively — not duplicated in API layer.
- `delete-vectors` job deletes by `memoryId` prefix filter in Qdrant.
