# ADR-003: Token-Based Chunking with Valid Qdrant Point IDs

**Status**: Accepted
**Date**: 2026-08-01
**Amended**: 2026-10-20
**Deciders**: Engineering

## Context

Most memories are short atomic facts (< 500 tokens). Occasionally users paste long content or the agent extracts multi-paragraph memories. Embedding entire documents in a single vector degrades retrieval quality for specific facts within the text.

Alternatives considered:

1. **Always single vector per memory** — simple but poor retrieval for long content.
2. **Always chunk** — unnecessary complexity for short facts.
3. **Token-threshold hybrid** — atomic under threshold, chunked above.
4. **Sentence-level chunking** — more granular but harder to tune and more Qdrant points.

A later implementation finding changed two details in the original decision:

- Qdrant point IDs must be unsigned integers or UUIDs. Suffixing `_{chunkIndex}` to a memory UUID is rejected by Qdrant.
- Providers have different input limits. DMR runs `nomic-embed-text-v1.5` with a 512-token physical batch, so the original fixed 800–1000-token chunk target fails at embedding time.

## Decision

Apply **token-count-based chunking at embedding time** (not at memory creation). The `EmbeddingProvider` port exposes `maxInputTokens` so chunking always respects the selected provider:

| Condition                                             | Behavior                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| Content ≤ `min(500, maxInputTokens)` estimated tokens | Single vector, one Qdrant point                                |
| Content above the atomic threshold                    | Chunks of `min(900, maxInputTokens)` tokens, 100-token overlap |

Provider limits:

| Provider | Model                    | `maxInputTokens` | Notes                                              |
| -------- | ------------------------ | ---------------- | -------------------------------------------------- |
| `dmr`    | `nomic-embed-text-v1.5`  | 400              | Safety margin under DMR's 512-token physical batch |
| `ollama` | `nomic-embed-text`       | 8192             | Effective chunk cap remains 900                    |
| `openai` | `text-embedding-3-small` | 8191             | Effective chunk cap remains 900                    |

Token counts are estimated with a 4-characters-per-token heuristic, so provider limits include a safety margin.

**Qdrant point IDs**:

- Atomic and first chunk: `{memoryId}` (UUID string).
- Later chunks: deterministic UUIDv5 of `"{memoryId}:{chunkIndex}"` using a fixed namespace.
- Never `{memoryId}_{chunkIndex}`; Qdrant rejects it.

Chunk 0 keeps the raw memory UUID for backwards compatibility with existing atomic points. New chunk points are deterministic, so job retries and reconciliation produce the same IDs.

**Qdrant payload** (all points): `userId`, `memoryId`, `chunkIndex`, `category`, `tags`, `createdAt`.

**Retrieval rule**: Search returns chunk hits internally; the application deduplicates to the parent memory, ranking by best chunk score. Chunk IDs are never exposed to API consumers.

**Delete and repair**:

- Delete and reconciliation select points by the `memoryId` payload field, not by point-ID prefix.
- After a successful upsert, the embed handler compares the existing point set for the memory with the expected chunk IDs and deletes stale points. This handles content shrinking and moved chunk boundaries.

## Consequences

### Positive

- Short memories stay simple (one point, one embed call).
- Long content retrieves specific relevant sections.
- Explicit one-to-many memory→vector relationship in `memory_embeddings`.
- Chunk IDs are valid Qdrant IDs and deterministic across retries.
- Provider-specific input limits keep DMR, Ollama, and OpenAI on the same pipeline.

### Negative

- Chunked memories cost more embedding calls and Qdrant storage.
- Delete must scroll all points by `memoryId` payload.
- Reconciliation must account for variable point counts and exact chunk sets.
- Changing `maxInputTokens` changes chunk boundaries and triggers re-indexing.

### Implementation notes

- `memory_embeddings` has one row per chunk with `chunk_index`, `token_count`, `qdrant_point_id`, `status`, `provider`, `model`, and `dimension`.
- `memory_index_states` tracks the parent memory's durable status and content hash.
- The reconciler computes the same expected chunk set using the active provider's `maxInputTokens`.

## Compliance

- Worker `embed-and-index` implements chunking; the API layer never chunks.
- `delete-vectors` deletes by `memoryId` payload filter.
- `qdrantPointId(memoryId, chunkIndex)` is the only point-ID constructor.
- Stale chunk points are pruned after every successful re-index.
