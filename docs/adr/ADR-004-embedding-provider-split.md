# ADR-004: Embedding Provider Split — Configurable Ollama, OpenAI, and Docker Model Runner

**Status**: Accepted
**Date**: 2026-08-01
**Amended**: 2026-10-20
**Deciders**: Engineering

## Context

Embedding generation is the dominant recurring cost at scale. Developers need zero-cost local iteration. Production needs reliable, high-quality embeddings. Ollama, Docker Model Runner (DMR), and OpenAI produce vectors of **different dimensions** and are not interchangeable.

Alternatives considered:

1. **OpenAI only** — simple but costly for dev/CI.
2. **Ollama only** — free but adds a separate local runtime and quality gap in production.
3. **DMR only** — reproducible local models, but no hosted production path.
4. **Single interface, env-selected adapters** — one port, multiple implementations.
5. **Normalize dimensions via projection layer** — adds complexity and quality loss.

## Decision

Implement the **`EmbeddingProvider` port** with three OpenAI-compatible adapters selected by `EMBEDDING_PROVIDER`:

| Environment       | Provider | Model                                       | Dimension | Qdrant collection         |
| ----------------- | -------- | ------------------------------------------- | --------- | ------------------------- |
| Local default     | `dmr`    | `docker.io/ai/nomic-embed-text-v1.5:latest` | 768       | `smriti_dev_dmr_768`      |
| Local alternative | `ollama` | `nomic-embed-text`                          | 768       | `smriti_dev_ollama_768`   |
| Production option | `openai` | `text-embedding-3-small`                    | 1536      | `smriti_prod_openai_1536` |

Selection is validated at boot. If either `EMBEDDING_PROVIDER=openai` or `LLM_PROVIDER=openai`, `OPENAI_API_KEY` is required.

**Hard rules**:

- One Qdrant collection per provider/dimension/environment. Never share a collection between providers, and never copy vectors between collections.
- Raw memory content is portable; vectors must be regenerated for each provider.
- The vector store checks the collection's configured size at boot and throws if it differs from `provider.dimension`. The worker fails startup; the API logs the error and starts anyway so a transient Qdrant outage does not block the HTTP process.
- Changing the embedding provider for an environment with existing data requires a full re-embedding/re-index migration.
- The provider's `maxInputTokens` caps chunk size (see ADR-003).

DMR is documented separately in [ADR-007](ADR-007-docker-model-runner.md), including its host/container base URLs and pinned models.

## Consequences

### Positive

- Zero paid API calls in local development and local live evals.
- DMR provides reproducible, OCI-pinned local models without requiring Ollama.
- Production can switch to OpenAI without domain changes.
- Per-provider collections make accidental vector mixing a configuration error, not silent corruption.
- The port abstraction allows future providers without domain changes.

### Negative

- Retrieval quality and chunk boundaries differ by provider.
- Developers cannot copy Qdrant snapshots between environments.
- DMR/Ollama must be running locally; CI needs either DMR, Ollama, or fakes.
- A provider change requires a full re-index.

### Mitigations

- Name collections with provider and dimension (`smriti_dev_dmr_768`).
- Record `provider`, `model`, and `dimension` per embedding row.
- Fail fast in the worker on collection dimension mismatch; the API logs the error and starts anyway.
- Keep retrieval-quality evals separate from the deterministic agent-loop gate.

## Compliance

- `EmbeddingProvider` exposes `embed(texts[])`, `model`, `dimension`, and `maxInputTokens`.
- Qdrant collection `vector_size` comes from `provider.dimension`; the worker throws at boot on mismatch, while the API logs the error and starts anyway.
- No direct provider SDK calls outside `infrastructure/`.
- `.env.example` pins DMR models and the matching collection name.
