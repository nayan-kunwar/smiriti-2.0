# ADR-004: Embedding Provider Split — Ollama Dev, OpenAI Prod

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering  

## Context

Embedding generation is the dominant recurring cost at scale. Developers need zero-cost local iteration. Production needs reliable, high-quality embeddings. Ollama (`nomic-embed-text`) and OpenAI (`text-embedding-3-small`) produce vectors of **different dimensions** and are not interchangeable.

Alternatives considered:

1. **OpenAI only** — simple but costly for dev/CI.
2. **Ollama only** — free but quality gap in production.
3. **Single interface, env-selected adapter** — one port, two implementations.
4. **Normalize dimensions via projection layer** — adds complexity, quality loss.

## Decision

Implement **`EmbeddingProvider` port** with two adapters from v1:

| Environment | Provider | Model | Collection |
| ----------- | -------- | ----- | ---------- |
| Local / CI | Ollama | `nomic-embed-text` | `smriti_dev` (or per-developer) |
| Production | OpenAI | `text-embedding-3-small` | `smriti_prod` |

Selection via `EMBEDDING_PROVIDER=ollama|openai` validated at boot. **Fail fast** if provider is `openai` but `OPENAI_API_KEY` is missing.

**Hard rules**:

- Separate Qdrant collections per environment — never share vectors between dev and prod.
- Raw memory content is portable; vectors must be regenerated per environment.
- Changing embedding provider in an environment with existing data requires a full re-embedding migration job.

## Consequences

### Positive

- Zero paid API calls in local dev and CI.
- Production uses battle-tested OpenAI embeddings.
- Port abstraction allows future Anthropic/Cohere adapters without domain changes.

### Negative

- Retrieval quality may differ between dev and prod — eval suite should run on both where feasible.
- Developers cannot copy Qdrant snapshots between environments.
- CI must run Ollama in docker-compose.

### Mitigations

- Document known retrieval differences in onboarding guide.
- Golden eval CI gate uses Ollama; optional prod-like OpenAI compose override for manual testing.
- `memory_embeddings` records `provider`, `model`, `dimension` per chunk for auditability.

## Compliance

- `EmbeddingProvider` interface: `embed(texts[])`, `model`, `dimension`.
- Qdrant collection `vector_size` set from `provider.dimension` at collection creation.
- No direct OpenAI/Ollama SDK calls outside `infrastructure/` adapters.
