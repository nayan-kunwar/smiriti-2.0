# ADR-010: Request Idempotency for Memory and Chat Writes

**Status**: Accepted; implemented
**Date**: 2026-10-20
**Deciders**: Engineering

## Context

Clients retry after timeouts, network failures, and ambiguous proxy errors. Without request-level idempotency, a retry of `POST /v1/memories` can create a duplicate memory and a retry of `POST /v1/chat` can append a second user/assistant pair and repeat memory extraction. Deterministic BullMQ job IDs protect indexing, but not the HTTP write itself.

The `idempotency_keys` table existed from the initial schema but was unused. v1.1 needs a small, explicit contract without changing clients that do not send a key.

Alternatives considered:

1. **Require an idempotency key on every write** — safer, but a breaking API change.
2. **Derive a key from the payload** — cannot distinguish an intentional repeated memory from a retry.
3. **Use a Redis lock only** — fast, but loses replay bodies and makes correctness depend on cache durability.
4. **Postgres-backed reservations and response snapshots** — durable, owner-scoped, and consistent with the existing source of truth.

## Decision

`POST /v1/memories` and `POST /v1/chat` accept an optional `Idempotency-Key` header (1–255 characters after trimming). Requests without the header keep the existing behavior.

The API applies idempotency in an interceptor around the controller handler, after authentication:

1. Hash the raw key together with the authenticated user ID and route. Only the scoped SHA-256 hash is stored.
2. Build a canonical request hash from method, path, normalized query, and JSON body with sorted object keys.
3. Atomically insert an `in_progress` reservation carrying a unique lock token. If the row exists:
   - same request hash and `completed` → replay the stored status/body with `Idempotency-Replayed: true`;
   - different request hash → `409` with `reason: "IDEMPOTENCY_KEY_REUSE"`;
   - still `in_progress` → `409` with `reason: "IDEMPOTENCY_IN_PROGRESS"` and a retry hint.
4. Run the controller. On success, persist the HTTP status and JSON body before returning (best effort: a persistence failure is logged and the successful response is still returned). Completion is conditional on the reservation's lock token, so a stale handler cannot overwrite a newer takeover.
5. On any handler error, delete the reservation so a corrected retry can reuse the key. Abort is also conditional on the lock token, so a stale handler cannot release a newer takeover.

Expired rows and stale `in_progress` locks can be taken over by a new request. The response cache TTL defaults to 24 hours (`IDEMPOTENCY_TTL_HOURS`), and the in-progress lock defaults to 30 seconds (`IDEMPOTENCY_LOCK_TIMEOUT_MS`). A worker scheduler deletes expired rows every 60 minutes by default (`IDEMPOTENCY_CLEANUP_INTERVAL_MINUTES`).

Only successful responses are cached. A `409` duplicate-memory or validation error releases the key; it is not replayed.

## Consequences

### Positive

- Retries of successful memory and chat writes are safe without new client APIs.
- The contract is explicit and discoverable in the OpenAPI document.
- Postgres remains the source of truth; Redis is not required for correctness.
- Keys are user-scoped and stored as hashes, limiting cross-user collisions and raw-key exposure.
- The cleanup scheduler bounds table growth.

### Negative

- The request still performs multiple database writes (memory/audit/index state, or message/graph/message), so idempotency cannot repair a crash that happens mid-request.
- Chat has no transaction across user message, graph side effects, and assistant message. A failure after partial persistence leaves partial history; a retry without the same key starts a new turn.
- A response snapshot can be stale relative to later changes (for example, a memory edited after creation) — replay reflects the original response by design.
- A slow request longer than the lock timeout can be taken over by a retry, so the lock should exceed the expected worst-case handler latency.
- Keeping only successful responses means clients cannot replay a deterministic validation error.

### Deferred

- Idempotency for update/delete and bulk endpoints.
- Transactional outbox or a turn-level transaction for chat.
- Admin visibility into idempotency records.

## Compliance

- Domain port: `packages/domain/src/ports/idempotency-store.port.ts`.
- Persistence: `PrismaIdempotencyStore` and `InMemoryIdempotencyStore`.
- API: `IdempotencyService` and `IdempotencyInterceptor`, applied only to the two write handlers.
- Migrations: `20261020150000_idempotency_lifecycle` and `20261020153000_idempotency_lock_token`.
- Contract: `docs/api/openapi.json`, verified by `pnpm openapi:check`.
- Tests cover replay, payload mismatch, in-progress conflict, abort-on-error, and key validation.
