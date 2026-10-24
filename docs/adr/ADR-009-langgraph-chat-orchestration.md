# ADR-009: LangGraph Chat Orchestration

**Status**: Accepted
**Date**: 2026-10-20
**Deciders**: Engineering

## Context

v1 needs a chat endpoint that can store facts the user shares, answer questions from previously stored memories, and hold a conversation. The behavior has several branches (remember, recall, general), calls two different model capabilities (chat completion and embeddings), and reuses memory write/search use cases that already have consistency, audit, and indexing rules.

Putting this logic directly in a NestJS controller would duplicate the memory pipeline and make the graph hard to test without HTTP, a database, or a model. A separate agent framework would add a second orchestration stack beside the existing harness and eval gate.

Alternatives considered:

1. **Single prompt with tools in the API controller** — simple, but prompt/tool semantics leak into the transport layer and are hard to test deterministically.
2. **Separate Python/LangGraph service** — clean graph, but adds a second runtime, deployment, and cross-service auth.
3. **LangGraph in `packages/application`** — keeps orchestration framework-free of NestJS/Prisma and reuses application commands/queries.
4. **Hand-written state machine** — viable, but LangGraph gives explicit state channels, conditional edges, and a path to future checkpoints.

## Decision

Use **LangGraph JS** (`@langchain/langgraph` + `@langchain/core`) inside `packages/application/src/chat/`.

### Graph

The graph has six nodes:

| Node           | Behavior                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| `classify`     | One chat-model call returns `{ intent, memories[] }` as JSON; fallback heuristics handle malformed output |
| `validate`     | Trim, exact-dedupe, cap at five, drop invalid/oversized memories                                          |
| `persist`      | Best-effort semantic dedup, then the shared `createMemory` use case                                       |
| `retrieve`     | `searchMemories` with a bounded timeout; empty on failure                                                 |
| `buildContext` | Delimited `<retrieved_memories>` block, capped at 6000 characters                                         |
| `respond`      | Second chat-model call with bounded history and mode-specific context                                     |

Routing:

- `remember` → `validate` → `persist` (or directly to `respond` when nothing is valid) → `respond`
- `recall` → `retrieve` → `buildContext` → `respond`
- `general` → `respond`

### Chat model port

`ChatModel` lives in the domain and exposes `complete(messages, options?)`. Infrastructure provides one OpenAI-compatible adapter used for DMR, Ollama, and OpenAI. DMR and Ollama are local default alternatives; OpenAI is the hosted option. `LLM_PROVIDER` selects the chat adapter independently of `EMBEDDING_PROVIDER`.

### Conversation persistence

`ConversationRepository` is a domain port with Prisma and in-memory adapters. `POST /v1/chat` loads at most 20 history messages, excluding messages written by the current turn. The user message is written atomically with a durable `chat_turns` row before the graph runs, and the assistant message is written atomically with the turn's `completed` status afterwards. Conversation reads are user-scoped.

### Synchronous with durable turns and request idempotency

`POST /v1/chat` is synchronous: it returns the assistant message, `turnId`, and side-effect IDs in the same response. An optional `Idempotency-Key` is handled by the API interceptor around the whole turn, so a retry of a successful request replays the stored response instead of writing another user/assistant pair. The graph itself remains unaware of idempotency, but it receives the `turnId` for per-turn memory reuse.

A failed graph marks the turn `failed` and returns `CHAT_TURN_FAILED` with the turn ID. The user message remains part of the durable turn and is reused by an explicit retry or by repeating the same `Idempotency-Key`. Retries reuse memories already written by the turn and append the assistant message at most once. The graph run itself is not transactional and there is no checkpointer; see [ADR-011](ADR-011-chat-turn-durability.md).

### Duplicate detection

The `persist` node reuses the same semantic dedup rule as REST (`DEDUP_SIMILARITY_THRESHOLD`, default `0.92`) but does not fail the turn: duplicates are skipped and returned in `duplicateWarnings`. Dedup and retrieval are bounded by `DEDUP_TIMEOUT_MS` so a provider outage cannot block the synchronous request indefinitely.

## Consequences

### Positive

- The chat graph is testable with fake ports and no HTTP/NestJS/Prisma.
- Memory writes from chat share REST behavior for audit, hash, durable index state, and BullMQ jobs.
- The API layer remains a thin composition root.
- LangGraph state and conditional edges make branches explicit and extensible.

### Negative

- LangGraph adds runtime weight to the application package and to API test startup.
- The graph makes two sequential model calls per turn; latency includes classification and generation.
- No stream, checkpointing, or tool loop in v1.
- A malformed classification gets a heuristic fallback, which may miss nuanced memory extraction.
- A retry re-runs the graph from the persisted user message, so model calls are not deduplicated.

### Deferred

- Streaming responses.
- LangGraph checkpoints/resume.
- Mid-graph resume; v1.5 recovers at the turn boundary only.
- Conversation title generation, listing, and deletion endpoints.
- Automatic duplicate merging.
