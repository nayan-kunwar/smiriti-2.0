# API contract

`openapi.json` is the machine-readable OpenAPI 3.0 contract for the v1 API.

Generate it from the shared Zod request schemas and the checked-in path definitions:

```bash
pnpm openapi:generate
```

CI runs `pnpm openapi:check` and fails if the checked-in contract is stale.

The contract covers auth, API keys, memories, search, chat/conversations, admin, health, and Prometheus metrics endpoints. The Idempotency-Key header is documented on `POST /v1/memories` and `POST /v1/chat`.
