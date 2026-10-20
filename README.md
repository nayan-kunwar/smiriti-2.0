# Smriti

Agentic memory assistant with a hexagonal memory pipeline: Postgres as the source of truth, asynchronous Qdrant indexing, BullMQ workers, and configurable embedding/chat providers.

**Status:** v1 is implemented: memory CRUD, auth, semantic search, async indexing, reconciliation, REST/chat dedup, and the synchronous LangGraph `/v1/chat` slice.

## What works

- Email/password registration and login, refresh-token rotation, API keys, and admin user/audit-log endpoints.
- Memory CRUD for `long_term` and `semantic` memories with tags, categories, pin/archive, and cursor pagination.
- Semantic search over Qdrant with metadata filters.
- Asynchronous chunking → embedding → Qdrant indexing, with durable `pending` / `indexed` / `failed` status.
- Per-provider Qdrant collections and fail-fast dimension checks.
- Stale-chunk pruning and scheduled reconciliation for missed jobs, stale indexes, and orphan vectors.
- LangGraph chat that classifies intent, extracts and stores memories, retrieves context, and persists both sides of a conversation.
- Detect-only dedup for REST creates (`409`) and chat turns (skip persist + warning), with `?force=true` override.
- Deterministic agent-loop and chat eval gate plus a local-only live model runner.

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker Desktop / Docker Engine with Compose
- A model runtime for the default configuration: **Docker Model Runner** is the local default. Ollama and OpenAI are also supported.

## Quick start

```bash
cp .env.example .env
pnpm install
pnpm docker:up          # Postgres, Redis, Qdrant, Ollama, MinIO
pnpm db:generate
pnpm db:migrate
```

Pull the pinned Docker Model Runner models (or change the provider settings in `.env`):

```bash
docker model pull docker.io/ai/nomic-embed-text-v1.5:latest
docker model pull docker.io/ai/qwen2.5:3B-Q4_K_M
```

The API and worker read environment variables directly. Load `.env` into your shell before starting them, for example in bash:

```bash
set -a; source .env; set +a
```

Then run the API and worker in separate terminals:

```bash
pnpm dev          # API on http://localhost:3000
pnpm dev:worker   # BullMQ worker + reconcile scheduler
```

Docker Compose loads `.env` automatically for the `full` profile:

```bash
docker compose -f docker/docker-compose.yml --profile full up -d
```

For containers, Docker Model Runner is reachable at `http://model-runner.docker.internal/engines/v1`; set `DMR_BASE_URL` accordingly.

### Switching providers

```bash
# Ollama (768 dims)
EMBEDDING_PROVIDER=ollama
QDRANT_COLLECTION=smriti_dev_ollama_768

# OpenAI (1536 dims)
EMBEDDING_PROVIDER=openai
LLM_PROVIDER=openai
OPENAI_API_KEY=...
QDRANT_COLLECTION=smriti_prod_openai_1536
```

Chat uses `LLM_PROVIDER` independently of embeddings. For example, keep local DMR embeddings while pointing chat at Ollama:

```bash
EMBEDDING_PROVIDER=dmr
LLM_PROVIDER=ollama
OLLAMA_CHAT_MODEL=llama3.2
```

Never reuse a Qdrant collection across providers or dimensions. Changing providers requires re-indexing memories from Postgres content.

## API

Health:

- `GET /health` — basic health
- `GET /live` — liveness
- `GET /ready` — readiness (Postgres, Redis, Qdrant)

Register and authenticate:

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"password123"}'
```

Use the returned access token for memory requests:

```bash
TOKEN="<access-token>"

# Create (returns indexingStatus: "pending")
curl -X POST http://localhost:3000/v1/memories \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"type":"long_term","content":"I live in NYC","tags":["location"]}'

# Poll until indexingStatus becomes "indexed"
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/v1/memories/<memory-id>

# Semantic search
curl -X POST http://localhost:3000/v1/memories/search \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query":"where does the user live?","limit":5}'
```

Creating a near-duplicate returns `409 Conflict` with `existingMemoryId` and `similarity`. Use `POST /v1/memories?force=true` to bypass the check.

Chat is synchronous. Omit `conversationId` to create a conversation, or pass one returned by an earlier turn:

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"message":"Remember that I live in Lisbon"}'

# conversationId from the response
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/v1/conversations/<conversation-id>/messages
```

Chat skips persisting an extracted memory when a similar memory already exists and returns `duplicateWarnings` instead. Chat idempotency keys are deferred in v1.

API keys can be issued with `POST /v1/api-keys` and used as `Authorization: Bearer smriti_...` or `X-API-Key`. See the [architecture document](docs/architecture/v1-architecture.md) for the full contract.

## Indexing and reconciliation

- `memory_index_states` is authoritative for `indexingStatus`; `memory_embeddings` stores per-chunk records.
- Jobs use `jobId = {memoryId}_{contentHash}`. A stale job skips when the memory hash changed.
- After every successful re-index, Qdrant points outside the expected chunk set are deleted.
- The worker registers a BullMQ job scheduler (`reconcile-vectors`) every 15 minutes by default. It repairs missing/stale/failed indexes and deletes orphan Qdrant points.

Relevant settings:

```bash
RECONCILE_ENABLED=true
RECONCILE_INTERVAL_MINUTES=15
RECONCILE_BATCH_SIZE=100
RECONCILE_MAX_ENQUEUE=500
```

## Chat and duplicate detection

`LLM_PROVIDER` selects the chat adapter (`dmr`, `ollama`, or `openai`). The graph classifies the message as `remember`, `recall`, or `general`, then extracts/validates memories, persists them through the same `createMemory` use case as REST, retrieves context, and generates a response. The user and assistant messages are persisted to `conversation_messages`.

Dedup is detect-only:

- REST create returns `409 Conflict` with `{ existingMemoryId, similarity }`; `?force=true` bypasses it.
- Chat search-checks each extracted memory. Above the threshold, it skips the write and reports `duplicateWarnings`.
- The check is best-effort: if embeddings/Qdrant time out or fail, the memory is still written.

```bash
DEDUP_SIMILARITY_THRESHOLD=0.92
DEDUP_TIMEOUT_MS=2000
```

## Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `pnpm build`      | Build all packages                           |
| `pnpm dev`        | Start API in watch mode                      |
| `pnpm dev:worker` | Start worker in watch mode                   |
| `pnpm test`       | Unit + API e2e tests                         |
| `pnpm lint`       | ESLint                                       |
| `pnpm typecheck`  | TypeScript check                             |
| `pnpm eval`       | Deterministic agent-loop + chat eval + gate  |
| `pnpm eval:live`  | Live DMR eval (local only, does not gate CI) |
| `pnpm db:migrate` | Apply Prisma migrations                      |
| `pnpm docker:up`  | Start local infrastructure                   |

`pnpm test` includes API e2e tests that require Postgres, Redis, and Qdrant; those tests are skipped when the database is unavailable.

## Project structure

```text
apps/api              NestJS HTTP API
apps/worker           BullMQ worker, embed/delete/reconcile handlers, scheduler
packages/domain       Entities, value objects, ports (zero framework deps)
packages/application  Commands, queries, job handlers, indexing, LangGraph chat
packages/shared       Zod schemas, config, errors
packages/harness      Generic agent loop with policy caps and traces
packages/eval         Deterministic eval suite + gate
infrastructure/       Prisma, Qdrant, BullMQ, embedding adapters, fakes
prisma/               Database schema and migrations
docs/                 Architecture docs and ADRs
docker/               Docker Compose and Dockerfiles
eval/                 Tasks, baseline, reports
```

## Documentation

- [v1 Architecture](docs/architecture/v1-architecture.md)
- [ADR index](docs/adr/)
- [Eval harness](eval/README.md)

Deferred: `/metrics`, request-level (including chat) idempotency keys, automatic duplicate merging, and object storage.
