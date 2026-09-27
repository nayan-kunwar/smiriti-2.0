# ADR-005: Phased Memory Types — Long-Term and Semantic Only in v1

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering  

## Context

The product vision includes six memory types (long-term, semantic, episodic, working, procedural, knowledge graph). Building all simultaneously would delay shipping, increase schema complexity, and make testing/eval intractable for a small team.

Alternatives considered:

1. **All types in v1** — comprehensive but unshippable.
2. **Single generic "memory" type** — simpler schema but loses semantic distinction.
3. **Long-term + semantic in v1, others phased** — shared infra with `type` discriminator.
4. **Semantic only in v1** — too narrow for "remember facts about user" use cases.

## Decision

**v1 implements two memory types** sharing the same storage and indexing infrastructure:

| Type | Purpose | v1 |
| ---- | ------- | -- |
| `long_term` | Stable user facts, preferences, biographical info | ✓ |
| `semantic` | Conceptual knowledge, learned associations | ✓ |
| `episodic` | Time-bound events and experiences | v2 |
| `working` | Short-term session context | v2 |
| `procedural` | How-to knowledge, workflows | v3 |
| `knowledge_graph` | Cross-memory relationships | v3 |

Both v1 types use the same `memories` table with a `type` enum field. Retrieval, embedding, and CRUD pipelines are identical — type is metadata for filtering and agent behavior, not a separate storage engine.

## Consequences

### Positive

- One schema, one embed pipeline, one search path — maximal reuse.
- Agent can distinguish fact types in prompts without separate services.
- v2 types can be added as enum extensions + policy ADRs without architectural rewrite.

### Negative

- `long_term` vs `semantic` distinction may be fuzzy for users — agent extraction must classify reasonably.
- No episodic time-indexing or working-memory TTL in v1.

### Future triggers for new ADRs

- v2 episodic: add `occurred_at`, retention policies, separate eval suite.
- v3 knowledge graph: new `memory_relationships` table, graph traversal port.

## Compliance

- Prisma `MemoryType` enum: `long_term | semantic` only in v1 migrations.
- API Zod schemas validate `type` against the same enum.
- LangGraph extraction node assigns type during `memoryExtraction`.
