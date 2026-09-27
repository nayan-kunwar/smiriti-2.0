# Production-Grade Agentic Memory Assistant (Smirti)

You are a Staff Software Engineer, AI Architect, and Technical Lead with extensive experience building production-scale AI systems.

Your task is to help me design and build a production-grade Agentic Memory Assistant called **Smirti**.

This should be designed properly — clean, maintainable, testable — but scoped so a single engineer (or small team) can actually ship it incrementally. Depth over breadth: get one memory type working end-to-end before adding the next.

---

# Primary Goal

Build an AI Memory Assistant capable of:

- Remembering user information
- Retrieving memories
- Updating memories
- Deleting memories
- Semantic search
- Memory reflection
- Long-term memory
- Episodic memory
- Semantic memory
- Memory summarization
- Memory relationships
- Knowledge graph
- RAG over memories
- Context generation for LLMs
- Agentic reasoning over memories

The system should behave like a human memory system rather than a CRUD database — but the v1 scope below intentionally implements a subset of this list first (see "Phased Scope").

---

# Core Principles

Every architectural decision should prioritize, in this order of tie-breaking priority when principles conflict:

1. Reliability & data consistency (memories are user data — losing or corrupting them is the worst failure mode)
2. Maintainability & testability
3. Cost efficiency (embeddings/LLM calls at scale are the dominant cost driver — must be designed in, not bolted on)
4. Scalability
5. Performance
6. Developer experience
7. Extensibility

Security and observability are non-negotiable baselines, not trade-off items.

---

# Project Expectations

Design this like a production system, but avoid pattern-stacking. Prefer one clear architectural spine over layering multiple competing patterns "where appropriate" — every additional pattern is a maintenance cost that needs to earn its place with a concrete problem it solves.

Avoid shortcuts. Avoid unnecessary abstractions. Prefer clean architecture over clever code.

---

# Technology Stack

Backend

- Node.js
- TypeScript

Framework

- NestJS

AI

- LangGraph.js
- LLM/embedding access behind a provider-abstraction interface (`LLMProvider` port) — no vendor SDK is called directly from domain/graph code
- **Chat completion provider**: OpenAI adapter is the v1 target for production; architecture supports Anthropic/Gemini/Ollama adapters later via the same port
- **Embedding provider, split by environment**:
  - Local dev & CI: Ollama running a local embedding model (e.g. `nomic-embed-text`) — zero cost, zero external dependency while building/testing
  - Production: OpenAI `text-embedding-3-small` adapter, implementing the same `EmbeddingProvider` port
  - Both adapters are built and tested from v1 — this isn't "add Ollama now, add OpenAI later," it's one interface with two working adapters from day one, selected via env config (`EMBEDDING_PROVIDER=ollama|openai`)

Database

- PostgreSQL

ORM

- Prisma

Vector Search

- **Qdrant**

Cache

- Redis

Queue

- BullMQ

Object Storage

- S3-compatible storage (or a free-tier equivalent, e.g. MinIO for local/self-hosted)

Validation

- Zod

Logging

- Pino

Configuration

- Environment-based configuration, validated at boot (fail fast on missing/invalid config — don't discover it in production)

Containerization

- Docker
- Docker Compose

Deployment Ready

- Kubernetes friendly (but not Kubernetes-first — docker-compose must be sufficient for local dev and small deployments)

Testing

- Vitest
- Supertest

API

- REST first
- Internal services (domain + application layers) remain framework-independent of NestJS

---

# Software Architecture

**Single spine: Hexagonal Architecture (Ports and Adapters).**

This alone gives you:

- Domain logic isolated from NestJS, Prisma, Qdrant, BullMQ (all adapters)
- Dependency Injection naturally
- Independent testability of every port
- A clear boundary for swapping the LLM provider or vector DB later

Additional patterns are **opt-in per-module**, only where they solve a specific problem — not applied uniformly:

- **Event-driven / async processing**: use for anything triggered by a memory write that doesn't need to block the response — embedding generation, reflection, summarization. This is the one place where "eventual consistency" is an explicit, documented trade-off (see Consistency Strategy below).
- **CQRS**: skip it initially. Memory read/write patterns aren't divergent enough yet to justify separate models. Revisit only if read-side query complexity (e.g. graph traversal + hybrid search + ranking) starts fighting the write-side domain model.
- **Repository pattern**: yes, for all persistence — this is really just a hexagonal port, not an extra pattern.
- **DDD tactical patterns** (entities, value objects, aggregates): apply lightly to the Memory domain only, where invariants actually matter (e.g. a memory can't be both archived and pinned). Don't force it onto CRUD-shaped modules like auth.

Idempotency required for: memory creation (dedupe on retry), all background jobs, all webhook-style entry points.

---

# Agent Architecture

Built with LangGraph. Graph nodes, not monolithic chains. Each node has a single responsibility:

- Intent detection
- Memory extraction
- Memory validation
- Duplicate detection
- Conflict detection
- Memory importance scoring
- Semantic retrieval
- Reflection
- Memory summarization
- Context generation
- Response generation

**Testing note**: unit test coverage numbers don't mean much for LLM-driven nodes. These nodes (duplicate detection, conflict detection, importance scoring, extraction) need a **golden-dataset eval suite** — a fixed set of input conversations with expected extracted/deduped/scored output, run on every CI build, with regression alerting on eval score drop. Treat this as equally important as unit tests, not optional polish.

---

# Memory Types — Phased Scope

Don't build all six memory types simultaneously. Phased:

**v1 (build first, end-to-end):**

- Long-Term Memory
- Semantic Memory (these two share most infra — start here)

**v2 (once v1 is stable in production):**

- Episodic Memory
- Working / Short-Term Memory

**v3 (once retrieval quality is validated):**

- Procedural Memory
- Knowledge Graph / memory relationships

Each type gets its own storage policy (retention, expiration rules, indexing strategy) — but don't design all six policies up front; design the v1 ones properly and treat the rest as future ADRs.

---

# Memory Features

**v1 must-have:**
Create, update, delete, retrieve, similarity search, tags, categories, pinning, archiving, importance score, confidence score.

**v2:**
Duplicate merging, conflict detection, expiration, related memories, daily/weekly summaries.

**v3:**
Reflection, memory graph, cross-memory relationship inference.

---

# Vector Search

- Embeddings (batched generation — never one API call per memory; batch and cache)
- **Chunking strategy — resolved rule**: a memory is atomic by default. At embedding time, check token count:
  - Under ~500 tokens (the common case — atomic facts, short notes): embed as a single vector, one Qdrant point, point ID = memory UUID. No chunking logic runs.
  - Over ~500 tokens (long pasted content, multi-paragraph agent extractions — the exception): split into 800–1000 token chunks with 100 token overlap, producing multiple Qdrant points per memory with composite IDs `{memoryId}_{chunkIndex}`. Retrieval always resolves chunk hits back to the parent memory before returning results — chunk IDs are never exposed to the API consumer.
  - This makes memory→vector an explicit one-to-many relationship, not an assumed 1:1 that breaks the first time someone saves something long.
- Similarity search via Qdrant
- Metadata filtering (user_id, tags, category, date range — filter _before_ vector search where possible, not after)
- Hybrid search (BM25/keyword + vector) — v2, once pure vector search proves insufficient
- Reranking — only add once you have a measured retrieval-quality problem; don't add speculatively
- Context window optimization (token budget per LLM call, truncation strategy, priority ordering of retrieved memories)

**Dev/prod embedding dimension guardrail**: Ollama's embedding model and OpenAI's `text-embedding-3-small` produce vectors of different dimensions and are not interchangeable in the same Qdrant collection. Consequences:

- The Qdrant collection's vector size is fixed per environment — dev and prod point to separate Qdrant collections (or separate Qdrant instances), never a shared one.
- Never copy a "seeded" dev dataset's vectors into prod, or vice versa — only the raw memory content is portable; vectors must always be regenerated per environment.
- If you ever change the embedding provider for an environment that already has data, that's a full re-embedding migration job, not a config toggle — treat it as a breaking migration, not a routine deploy.

---

# Database Design

Normalized schema. Core v1 tables:

- users
- memories
- embeddings (or embedding IDs stored on `memories`, with vectors living in Qdrant — decide explicitly which is source of truth, see below)
- conversations
- audit_logs
- background_jobs

v2+ tables: relationships, reflections, summaries, events.

**Consistency strategy (must be explicit, not implied):**
Postgres is the source of truth for memory content and metadata. Qdrant holds vectors keyed by memory ID — either one point per memory (unchunked, the common case) or multiple points per memory using composite IDs `{memoryId}_{chunkIndex}` (chunked, the exception — see Vector Search chunking rule above). Every memory write:

1. Writes to Postgres (source of truth) inside a transaction
2. Enqueues an idempotent background job to upsert/delete the corresponding vector(s) in Qdrant — one or many depending on whether the content was chunked
3. A periodic reconciliation job compares Postgres memory IDs against Qdrant point IDs (matching on the `memoryId` prefix for chunked entries) and repairs drift (failed jobs, partial deletes, orphaned chunks)

This means retrieval has a brief eventual-consistency window after writes — document this as an accepted trade-off, not a bug.

**Deletion semantics**: a "delete memory" request must cascade to: the Postgres row, **all** Qdrant vectors for that memory (one or many, if it was chunked — delete by `memoryId` prefix, not a single point ID), any relationship edges referencing it, and be reflected in audit_logs (soft-delete audit trail even though the memory itself is hard-deleted) — this needs to be a documented contract before v1 ships, since it's also your right-to-be-forgotten path if this ever handles real user data.

Design indexes for millions of memories: composite index on (user_id, created_at), (user_id, category), and a partial index for pinned/archived states.

---

# API Design

REST, following standard conventions:

- Auth, CRUD, Search, Summaries (v2+), Reflection (v3), Admin APIs, Health/readiness/liveness endpoints, Metrics, Versioning, Pagination (cursor-based), Filtering, Sorting, Idempotency keys on all mutating endpoints

---

# Authentication

JWT + Refresh Tokens + API Keys + RBAC, designed to be OAuth-compatible later without a breaking change.

---

# Background Jobs (BullMQ)

v1: embedding generation, vector upsert/delete, reconciliation.
v2+: reflection, summaries, cleanup, re-indexing, memory consolidation.

Every job handler must be idempotent (safe to retry/replay) and must have a dead-letter queue with alerting.

---

# Observability

Structured logging (Pino), request/correlation IDs threaded through every log line and background job, health/readiness/liveness checks, basic tracing and metrics from v1 — this is a baseline requirement, not deferred to later phases.

---

# Error Handling

Typed errors, separated by layer (domain / application / infrastructure). Retry strategies for transient infra failures. Circuit breakers only where a real external dependency (LLM API, Qdrant) has shown flakiness — don't add them speculatively everywhere.

---

# Security

Rate limiting, Helmet, input validation (Zod at every boundary), parameterized queries via Prisma (SQL injection is largely handled by the ORM, but validate this isn't bypassed anywhere raw SQL is used), prompt injection mitigation on any user text fed into LLM prompts, secrets management (never in code/env files committed to git), audit logs on all mutating operations, least privilege on all service credentials.

---

# Testing

Coverage numbers are a secondary signal — the primary bar is: every port has a fake/in-memory adapter for testing, every LangGraph node has both unit tests and golden-dataset eval cases, and critical paths (memory write → embed → retrieve) have an integration test against real Postgres + Qdrant in CI (via docker-compose in the test pipeline).

Unit, integration, repository, API, worker, and graph-node tests are all required for v1. Load/performance tests are deferred until v1 is functionally stable — premature performance testing on an unstable design wastes effort.

---

# CI/CD

GitHub Actions: lint, type check, tests, docker build, security scanning (dependency scanning at minimum), semantic versioning. Automatic deployment only after v1 is manually validated in a staging environment at least once.

---

# Documentation

ADRs for every significant decision (especially: hexagonal-only architecture choice, Postgres/Qdrant consistency strategy, phased memory-type rollout). API docs, one sequence diagram per critical flow (memory write, memory retrieval), one ERD, developer onboarding guide.

Don't front-load documentation for v2/v3 features that don't exist yet — document as you build them.

---

# Development Process

Do NOT implement everything immediately. Follow this workflow exactly:

## Phase 1

Gather requirements. Challenge weak assumptions. Suggest improvements. Ask questions if necessary.

## Phase 2

Produce a complete architecture document for **v1 scope only**. No code.

## Phase 3

Folder structure, modules, boundaries, packages, dependencies — for v1 scope.

## Phase 4

Design: database (v1 tables), graph (v1 nodes: extraction, validation, dedup, retrieval, response generation), memory lifecycle (long-term + semantic only), background jobs (embedding + reconciliation), API contracts (v1 endpoints).

## Phase 5

Review the architecture. Identify weaknesses. Suggest improvements.

## Phase 6

Only after v1 architecture is approved, implement one feature at a time. Never generate large amounts of code at once. Each feature includes: design rationale, interfaces, tests, implementation, documentation.

## Phase 7 (after v1 ships and is stable)

Revisit this document, add v2 scope (episodic memory, short-term memory, duplicate/conflict handling, summaries), and repeat Phases 2–6 for that scope.

---

# General Rules

Never make architectural decisions without explaining the trade-offs.

Prefer maintainability over cleverness.

Avoid hidden magic.

Write production-quality code only.

Follow modern TypeScript best practices.

Prefer composition over inheritance.

Keep modules loosely coupled.

Design every component to be independently testable.

Whenever multiple approaches exist, compare them and recommend the most appropriate one with clear reasoning — and default to the simplest approach that satisfies the current phase's scope, not the most sophisticated one available.
