# Smriti

Production-grade agentic memory assistant — v1 API.

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+
- Docker & Docker Compose

### Setup

```bash
cp .env.example .env
pnpm install
pnpm docker:up          # Postgres, Redis, Qdrant, Ollama, MinIO
pnpm db:generate
pnpm db:migrate
pnpm dev                # API on http://localhost:3000
```

### Health Endpoints

- `GET /health` — basic health
- `GET /live` — liveness probe
- `GET /ready` — readiness (checks Postgres, Redis, Qdrant)

### Memory API (Slice 1)

Until auth is implemented (Slice 2), pass `X-User-Id` header with a valid user UUID.

```bash
# Create a test user first (via Prisma or direct SQL), then:
curl -X POST http://localhost:3000/v1/memories \
  -H "Content-Type: application/json" \
  -H "X-User-Id: <user-uuid>" \
  -d '{"type":"long_term","content":"I live in NYC"}'
```

## Project Structure

```
apps/api          NestJS HTTP API
apps/worker       BullMQ worker process
packages/domain   Entities, ports (zero framework deps)
packages/application  Use cases, mappers
packages/shared   Zod schemas, config, errors
infrastructure/   Prisma adapters, in-memory test fakes
prisma/           Database schema and migrations
docs/             Architecture docs and ADRs
docker/           Docker Compose and Dockerfiles
```

## Scripts

| Command           | Description          |
| ----------------- | -------------------- |
| `pnpm build`      | Build all packages   |
| `pnpm test`       | Run unit tests       |
| `pnpm lint`       | ESLint               |
| `pnpm typecheck`  | TypeScript check     |
| `pnpm dev:worker` | Start worker process |

## Documentation

- [v1 Architecture](docs/architecture/v1-architecture.md)
- [ADRs](docs/adr/)
