# Smriti

Agentic memory assistant with a hexagonal memory pipeline: Postgres as the source of truth, asynchronous Qdrant indexing, BullMQ workers, and configurable embedding/chat providers.

**Status:** v1 is implemented: memory CRUD, auth, per-principal rate limiting, auth/API-key audit events, semantic search, async indexing, reconciliation, durable terminal job failures with admin replay, REST/chat dedup, request idempotency for memory/chat writes, Prometheus metrics, and the synchronous LangGraph `/v1/chat` slice.

## What works

- Email/password registration and login, refresh-token rotation, API keys, per-principal rate limiting, and admin user/audit-log endpoints.
- Durable terminal job-failure records for `embed-and-index` and `delete-vectors`, with admin listing, audited replay, and metrics.
- Memory CRUD for `long_term` and `semantic` memories with tags, categories, pin/archive, and cursor pagination.
- Semantic search over Qdrant with metadata filters.
- Asynchronous chunking → embedding → Qdrant indexing, with durable `pending` / `indexed` / `failed` status.
- Per-provider Qdrant collections and fail-fast dimension checks.
- Stale-chunk pruning and scheduled reconciliation for missed jobs, stale indexes, and orphan vectors.
- LangGraph chat that classifies intent, extracts and stores memories, retrieves context, and persists both sides of a conversation.
- Detect-only dedup for REST creates (`409`) and chat turns (skip persist + warning), with `?force=true` override.
- Optional `Idempotency-Key` replay for `POST /v1/memories` and `POST /v1/chat`.
- Prometheus metrics for API latency/status and worker job throughput/failures.
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
pnpm dev:worker   # BullMQ worker + schedulers; metrics on :9464
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

Chat skips persisting an extracted memory when a similar memory already exists and returns `duplicateWarnings` instead.

## Idempotent writes

Send an optional `Idempotency-Key` header on memory creation or a chat turn. Repeating the same key with the same payload returns the original response instead of writing again:

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: chat-turn-123" \
  -d '{"message":"Remember that I live in Lisbon"}'
```

- Same key + same request: original status/body, plus `Idempotency-Replayed: true`.
- Same key + different payload: `409` with `reason: "IDEMPOTENCY_KEY_REUSE"`.
- Same key while the first request is still running: `409` with `reason: "IDEMPOTENCY_IN_PROGRESS"`.
- Only successful responses are stored; failed requests release the key.
- Keys expire after `IDEMPOTENCY_TTL_HOURS` (default 24 hours); the worker deletes expired rows every `IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES` (default 60).
- The in-progress reservation uses `IDEMPOTENCY_LOCK_TIMEOUT_MS` (default 30 seconds).
- Chat still has no transaction across user message, graph, and assistant message; a crash after partial persistence can leave partial history.

```bash
IDEMPOTENCY_TTL_HOURS=24
IDEMPOTENCY_LOCK_TIMEOUT_MS=30000
IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES=60
```

API keys can be issued with `POST /v1/api-keys` and used as `Authorization: Bearer smriti_...` or `X-API-Key`. See the [architecture document](docs/architecture/v1-architecture.md) for the full contract.

## Rate limits and audit events

Rate limits are scoped by authenticated principal and route:

- JWT requests share a `user:<id>` bucket.
- Each API key has its own `api-key:<id>` bucket.
- Public routes fall back to the client IP. Protected routes authenticate before throttling.

The default limit is `RATE_LIMIT_MAX` requests per `RATE_LIMIT_TTL` seconds. `POST /v1/chat` and `POST /v1/memories/search` also enforce the named `expensive` limit (`RATE_LIMIT_EXPENSIVE_MAX` per `RATE_LIMIT_EXPENSIVE_TTL` seconds). A blocked request returns `429` with `reason: "RATE_LIMIT_EXCEEDED"`, `retryAfterSeconds`, and `Retry-After` (or `Retry-After-expensive`). Successful responses include `X-RateLimit-*` headers; expensive routes also include the `-expensive` suffix.

```bash
RATE_LIMIT_TTL=60
RATE_LIMIT_MAX=100
RATE_LIMIT_EXPENSIVE_TTL=60
RATE_LIMIT_EXPENSIVE_MAX=20
```

Auth and API-key lifecycle events are written to `audit_logs`: `auth.register`, `auth.login`, `auth.login_failed`, `auth.refresh`, `auth.logout`, `api_key.create`, and `api_key.revoke`. Payload snapshots never contain passwords, refresh tokens, or API-key plaintext. Audit writes are best-effort; failures are logged with the correlation ID. Failed logins for unknown emails cannot be attributed to a user and are not written to `audit_logs`.

## Indexing and reconciliation

- `memory_index_states` is authoritative for `indexingStatus`; `memory_embeddings` stores per-chunk records.
- Jobs use `jobId = {memoryId}_{contentHash}`. A stale job skips when the memory hash changed.
- After every successful re-index, Qdrant points outside the expected chunk set are deleted.
- The worker registers a BullMQ job scheduler (`reconcile-vectors`) every 15 minutes by default. It repairs missing/stale/failed indexes and deletes orphan Qdrant points.
- When `embed-and-index` or `delete-vectors` exhausts its attempts, the worker persists a durable `job_failures` row and increments `smriti_job_terminal_failures_total`.

Relevant settings:

```bash
RECONCILE_ENABLED=true
RECONCILE_INTERVAL_MINUTES=15
RECONCILE_BATCH_SIZE=100
RECONCILE_MAX_ENQUEUE=500

JOB_ATTEMPTS=3
JOB_BACKOFF_DELAY_MS=1000
JOB_REMOVE_ON_COMPLETE=100
JOB_REMOVE_ON_FAIL=500
```

## Job failures and recovery

Admins can inspect and replay durable terminal failures:

```bash
# Open failures, optionally filtered by job name
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/v1/admin/job-failures?status=open&jobName=embed-and-index"

# Replay one failure with its original job ID and payload
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/v1/admin/job-failures/<failure-id>/retry"
```

- Only `embed-and-index` and `delete-vectors` are replayable. Scheduler-only jobs (`reconcile-vectors`, idempotency cleanup, failure cleanup) are not.
- A replay returns `202 Accepted`, re-enqueues the original BullMQ job ID, and marks the failure `retried`.
- Each replay writes a `job.retry` audit event with the admin user and request correlation ID.
- A second replay returns `409` with `reason: "JOB_FAILURE_ALREADY_RETRIED"`.
- Failed job records are retained for `JOB_FAILURE_RETENTION_DAYS` (default 30) and pruned by the worker every `JOB_FAILURE_CLEANUP_INTERVAL_MINUTES` (default 60). Redis keeps `JOB_REMOVE_ON_FAIL` failed jobs (default 500).
- Replaying a job whose memory was deleted is harmless: `embed-and-index` exits when the memory is gone, and `delete-vectors` is idempotent.

```bash
JOB_FAILURE_RETENTION_DAYS=30
JOB_FAILURE_CLEANUP_INTERVAL_MINUTES=60
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

## Observability

The API exposes Prometheus metrics at `GET /metrics` (no auth, intended for internal scraping):

```bash
curl http://localhost:3000/metrics
```

The worker exposes its own registry on `WORKER_METRICS_PORT` (default `9464`):

```bash
curl http://localhost:9464/metrics
```

Metrics use bounded labels only. HTTP routes use the Express route template (`/v1/memories/:id`), never the raw URL; unmatched requests use `route="unmatched"`. Custom metrics:

- `smriti_http_requests_total{method,route,status}`
- `smriti_http_request_duration_seconds{method,route,status}`
- `smriti_bullmq_jobs_total{queue,job,status}`
- `smriti_bullmq_job_duration_seconds{queue,job,status}`
- `smriti_job_terminal_failures_total{queue,job}`
- `smriti_job_manual_retries_total{queue,job}`

The default process/Node.js metrics are prefixed with `smriti_`. Metrics endpoints should be reachable only from the monitoring network; they have no application-level auth. The Prometheus scrape itself is excluded from the HTTP metrics.

```yaml
scrape_configs:
  - job_name: smriti-api
    static_configs:
      - targets: ['api:3000']
  - job_name: smriti-worker
    static_configs:
      - targets: ['worker:9464']
```

```bash
WORKER_METRICS_PORT=9464
```

## Scripts

| Command                 | Description                                  |
| ----------------------- | -------------------------------------------- |
| `pnpm build`            | Build all packages                           |
| `pnpm dev`              | Start API in watch mode                      |
| `pnpm dev:worker`       | Start worker in watch mode                   |
| `pnpm test`             | Unit + API e2e tests                         |
| `pnpm lint`             | ESLint                                       |
| `pnpm typecheck`        | TypeScript check                             |
| `pnpm eval`             | Deterministic agent-loop + chat eval + gate  |
| `pnpm eval:live`        | Live DMR eval (local only, does not gate CI) |
| `pnpm openapi:generate` | Regenerate `docs/api/openapi.json`           |
| `pnpm openapi:check`    | Fail if the checked-in contract is stale     |
| `pnpm db:migrate`       | Apply Prisma migrations                      |
| `pnpm docker:up`        | Start local infrastructure                   |

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
docs/                 Architecture docs, ADRs, and OpenAPI contract
scripts/              OpenAPI generation and drift checks
docker/               Docker Compose and Dockerfiles
eval/                 Tasks, baseline, reports
```

## Documentation

- [v1 Architecture](docs/architecture/v1-architecture.md)
- [OpenAPI contract](docs/api/openapi.json)
- [ADR index](docs/adr/)
- [Eval harness](eval/README.md)

Deferred: automatic duplicate merging and object storage.
