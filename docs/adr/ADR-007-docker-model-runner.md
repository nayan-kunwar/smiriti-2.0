# ADR-007: Docker Model Runner as the Default Local Model Runtime

**Status**: Accepted
**Date**: 2026-10-20
**Deciders**: Engineering

## Context

Smriti needs a local embedding provider for development, live end-to-end checks, and local-only model exploration. The original local option was Ollama (ADR-004), which requires a separate container/runtime and model management. Docker Model Runner (DMR) is available with Docker Desktop, runs OCI-packaged models, and exposes an OpenAI-compatible API. The team already runs Docker for Postgres, Redis, and Qdrant, so DMR removes one local dependency.

DMR also has constraints that affect the memory pipeline:

- It is host-native by default; containers cannot reach `localhost:12434`.
- `nomic-embed-text-v1.5` is served with a 512-token physical batch.
- Model tags are OCI references, so pins look different from Ollama/OpenAI model names.

## Decision

Use **Docker Model Runner as the default local provider for both embeddings and chat**, while keeping Ollama and OpenAI as supported adapters.

### Configuration

| Setting              | Local default                               |
| -------------------- | ------------------------------------------- |
| `EMBEDDING_PROVIDER` | `dmr`                                       |
| `DMR_BASE_URL`       | `http://localhost:12434/engines/v1`         |
| `DMR_EMBED_MODEL`    | `docker.io/ai/nomic-embed-text-v1.5:latest` |
| `DMR_CHAT_MODEL`     | `docker.io/ai/qwen2.5:3B-Q4_K_M`            |
| `QDRANT_COLLECTION`  | `smriti_dev_dmr_768`                        |
| Embedding dimension  | `768`                                       |

When API/worker run inside Docker Compose, override:

```bash
DMR_BASE_URL=http://model-runner.docker.internal/engines/v1
```

### Model and collection rules

- DMR embeddings are **768-dimensional**; the Qdrant collection must be created for 768 dimensions.
- DMR uses its own collection (`smriti_dev_dmr_768`). Do not reuse an Ollama or OpenAI collection.
- Vectors are never copied between providers. Switching providers requires re-embedding from Postgres content.
- The worker fails startup when the existing collection dimension differs from the provider dimension; the API logs the error and continues.

### Chunking

DMR's `nomic-embed-text-v1.5` has a 512-token physical batch. The DMR adapter advertises `maxInputTokens = 400` to leave room for the character-based token estimate. The worker and reconciler both use that limit, so chunk boundaries stay consistent. See ADR-003.

### Eval

`pnpm eval:live` targets DMR chat with `DMR_CHAT_MODEL`. It is local-only and never gates CI. The deterministic `pnpm eval` gate uses a scripted model and does not require DMR.

## Consequences

### Positive

- One fewer local runtime for developers already using Docker Desktop.
- OCI model references make local model versions explicit and reproducible.
- DMR exposes the same OpenAI-compatible surface as the other adapters, so the port stays small.
- Embedding and chat use the same local runtime and OpenAI-compatible surface.

### Negative

- DMR availability and model pulls are environment prerequisites.
- Host-versus-container base URLs are easy to misconfigure.
- The 512-token physical batch forces smaller chunks than Ollama/OpenAI, so chunk counts and retrieval behavior differ by provider.
- DMR is not the production hosting recommendation; OpenAI remains the supported hosted option.

### Mitigations

- Document both base URLs in `.env.example` and the README.
- Pin models in configuration and record provider/model/dimension per embedding row.
- Keep `maxInputTokens` on the provider port rather than hard-coding DMR limits in the worker.
- Fail fast in the worker on collection dimension mismatch; surface the API warning in logs.

## Compliance

- `EMBEDDING_PROVIDER=dmr` selects the OpenAI-compatible adapter with `maxInputTokens = 400` and dimension `768`.
- `.env.example` pins the DMR embedding/chat models and `smriti_dev_dmr_768`.
- Qdrant collections are provider-specific and dimension-checked at worker boot; the API logs a warning and continues.
- `LLM_PROVIDER=dmr` selects the OpenAI-compatible chat adapter with `DMR_CHAT_MODEL`.
