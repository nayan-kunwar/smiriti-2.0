# ADR-011: Durable and Retry-Safe Chat Turns

**Status**: Accepted; implemented
**Date**: 2026-10-24
**Deciders**: Engineering

## Context

v1 chat persists the user message before the LangGraph run and appends the assistant message afterwards. If the model call, retrieval, or persistence step fails, the request returns an error but the user message stays in history and no assistant message exists. A client retry without an `Idempotency-Key` creates a second user/assistant pair. Even with a key, the interceptor only replays successful responses; a failed request releases the key, so the retry starts over.

The result is partial history that cannot be repaired safely: there is no record of which turn failed, which memories it already wrote, or whether a retry is allowed. Request idempotency alone cannot solve this because it has no durable turn identity and no transaction across the graph's side effects.

Alternatives considered:

1. **Best-effort cleanup on failure** — delete the user message when the graph fails. Simple, but loses the user's input and cannot recover memories that were already written before the failure.
2. **LangGraph checkpointer** — resume the graph from its last node. Powerful, but adds a second persistence model, changes graph semantics, and does not by itself make the HTTP turn replay-safe.
3. **Require `Idempotency-Key` on every chat request** — improves replay, but is a breaking client change and still does not repair a failed turn.
4. **A durable `chat_turns` aggregate with explicit lifecycle operations** — Postgres remains the source of truth, retries are explicit, and the existing idempotency contract can layer on top.

## Decision

Every `POST /v1/chat` creates a durable `chat_turns` row with `status` `in_progress`, `completed`, or `failed`. Messages and memories gain a nullable `turn_id`; `(turn_id, content_hash)` is unique on memories.

The lifecycle is split into atomic operations on the `ChatTurnRepository` port:

1. **Start** — in one transaction, insert the turn and append the user message with `turn_id`. The turn carries the correlation ID, optional idempotency key, a random lock token, a lock expiry, and `attempts = 1`.
2. **Claim for retry** — atomically reclaim a `failed` turn, or an `in_progress` turn whose lock expired, guarded by the attempt cap. A completed turn returns its stored result instead.
3. **Finalize** — in one transaction, write the assistant message and set `completed`, the result snapshot, and `completed_at`, conditional on the lock token and `in_progress` status. A stale worker that lost the lock cannot append a second assistant message.
4. **Fail** — set `failed`, sanitize and store the error code/message, set `failed_at`, and release the lock, conditional on the lock token.

Graph execution receives the `turnId`. History is loaded with the current turn excluded so a retry does not feed the same user message to the model twice. `persist` loads memories already written by the turn (`findByTurnId`) and reuses them by content hash instead of creating duplicates. `createMemory` records the `turnId` on the memory and audit payload.

Failures are surfaced as `500` with `code: "CHAT_TURN_FAILED"`, `turnId`, `conversationId`, and `retryable: true`. Clients can inspect a turn with `GET /v1/chat/turns/:turnId` and retry it with `POST /v1/chat/turns/:turnId/retry`. Reusing the original `Idempotency-Key` with the same payload auto-resumes the failed turn, because the generic interceptor releases the key on failure and the turn repository finds the existing turn by `(user_id, idempotency_key)`. A completed turn with the same key replays its stored snapshot.

Retries are capped by `CHAT_TURN_MAX_ATTEMPTS` (default 5) and guarded by `CHAT_TURN_LOCK_TIMEOUT_MS` (default 300 seconds). Conflicts return `409` with `CHAT_TURN_IN_PROGRESS`, `CHAT_TURN_KEY_REUSE`, or `CHAT_TURN_RETRY_EXHAUSTED` and include `turnId`. A retry writes a `chat.turn.retry` audit event before re-running the graph. Turns are retained for `CHAT_TURN_RETENTION_DAYS` (default 30) and pruned by the `cleanup-chat-turns` scheduler; `ON DELETE SET NULL` keeps messages and memories after the turn row is removed.

Metrics: `smriti_chat_turns_total{status}`, `smriti_chat_turn_duration_seconds{status}`, and `smriti_chat_turn_retries_total{outcome}`.

## Consequences

### Positive

- A chat turn is inspectable and retryable after any failure, without relying on Redis or client-side state.
- Start and finalize are atomic, so a turn cannot have an assistant message without `completed` status or vice versa.
- Lock tokens and the attempt cap prevent duplicate assistant messages from stale workers and concurrent retries.
- Per-turn memory idempotency makes re-running the graph safe: side effects already persisted by the turn are reused, not duplicated.
- The existing `Idempotency-Key` contract gains automatic failed-turn resume without a new header.
- Retention bounds `chat_turns` growth while preserving conversation history and memories.

### Negative

- The graph run itself is still not transactional, and there is no LangGraph checkpointer: a retry re-executes the graph from the persisted user message, so model calls are repeated.
- Memory reuse is scoped to one turn. A memory written by an earlier, completed turn can still be detected as a duplicate (and skipped) rather than merged.
- `chat_turns` adds a row and an extra transaction per chat request; the lock and attempt columns need periodic cleanup.
- A turn stuck in `in_progress` is only recoverable after its lock expires; the lock timeout must exceed the worst-case graph latency.
- The result snapshot duplicates response data that also exists in messages and memories; it is intentionally denormalized for replay.

### Deferred

- SSE streaming and resumable token streams (v1.6).
- LangGraph checkpointer / mid-graph resume.
- v2 memory types and memory merging.
- Automatic background retry of failed turns.
- Admin listing of failed turns.

## Compliance

- Domain port: `packages/domain/src/ports/chat-turn-repository.port.ts`; `turnId` on `Memory` and `ConversationMessageRecord`; `findByTurnId` on `MemoryRepository`; `listMessagesForContext` on `ConversationRepository`.
- Persistence: `PrismaChatTurnRepository`, `InMemoryChatTurnRepository`; migration `20261024180000_chat_turn_durability`.
- Application: `chat`, `retryChatTurn`, and `executeTurn` in `packages/application/src/chat/chat.command.ts`; per-turn memory reuse in `chat.graph.ts`.
- API: `POST /v1/chat`, `POST /v1/chat/turns/:turnId/retry`, `GET /v1/chat/turns/:turnId`; `CHAT_TURN_FAILED` mapping in the global exception filter.
- Worker: `cleanup-chat-turns` scheduler in `apps/worker/src/main.ts`.
- Contract: `docs/api/openapi.json`, verified by `pnpm openapi:check`.
- Tests: `packages/application/src/chat/chat.command.spec.ts` and `apps/api/src/chat/chat.controller.spec.ts` cover atomic start/finalize, failure shape, explicit retry, same-key resume, completed-turn replay, attempt exhaustion, cross-user isolation, and per-turn memory reuse.
