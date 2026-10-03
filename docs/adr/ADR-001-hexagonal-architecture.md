# ADR-001: Hexagonal Architecture as the Sole Structural Spine

**Status**: Accepted  
**Date**: 2026-08-01  
**Deciders**: Engineering

## Context

Smriti integrates multiple external systems (Postgres, Qdrant, Redis, BullMQ, OpenAI, Ollama) and an agentic LangGraph workflow. We need a structure that keeps domain logic testable, swappable, and understandable by a small team without pattern overload.

Alternatives considered:

1. **Hexagonal (Ports & Adapters)** — domain at center, infrastructure at edges.
2. **Layered MVC (NestJS default)** — controllers → services → repositories, framework-coupled.
3. **Hexagonal + CQRS** — separate read/write models with event bus.
4. **Modular monolith with feature folders** — colocate by feature, thinner boundaries.

## Decision

Adopt **hexagonal architecture as the single structural spine**. No CQRS in v1. Repository pattern is used only as the persistence port implementation, not as a separate architectural layer.

Layer layout:

- `packages/domain` — entities, value objects, port interfaces (zero framework imports)
- `packages/application` — use cases, DTO mappers, LangGraph graph
- `infrastructure/` — Prisma, Qdrant, Redis, provider adapters
- `apps/api` and `apps/worker` — NestJS wiring and HTTP/queue entry points only

## Consequences

### Positive

- Domain and application layers are independently unit-testable with fake ports.
- Swapping embedding provider or vector store requires adapter changes only.
- LangGraph nodes call application services, preventing boundary blur.
- One clear dependency direction reduces onboarding friction.

### Negative

- More packages and boilerplate than a flat NestJS app.
- Developers must resist putting business logic in controllers or Prisma adapters.
- Cross-cutting concerns (logging, correlation IDs) need explicit middleware wiring.

### Neutral

- CQRS can be revisited if read-side complexity (graph traversal, hybrid search) outgrows the write model — document as future ADR if triggered.

## Compliance

- Domain package `package.json` has no `@nestjs/*`, `@prisma/client`, or vendor SDK dependencies.
- All external I/O goes through named ports in `packages/domain/src/ports/`.
