# Eval harness

Deterministic agent-loop and chat evals (`packages/harness`, `packages/application`, and `packages/eval`) with a CI gate.
`pnpm eval` is the deterministic gate. `pnpm eval:live` is local-only exploration.

Each task carries a seed, and the report records per-task `promptChars` and
`completionChars`. The gate pins **both** the suite pass rate and individual
task results, so one regressed task cannot hide behind a healthy aggregate.

## Layout

- `packages/harness/` — generic agent loop: tool-calling loop with policy caps
  (max steps / timeout / retries), schema-validated tools, per-call idempotency
  keys, retryable vs terminal errors, abort/timeout cancellation, per-step
  checkpoints with resume, bounded context (drops oldest tool results first),
  full JSONL traces.
- `packages/eval/` — suite wiring: `memory.create/search/list` tools over an
  in-memory store, scripted model (canned steps, no LLM), chat runner over the
  production graph, scorers, baseline gate, `replay`/`diff`/`live` CLI commands.
- `eval/tasks/memory/*.json` — 10 seeded agent tasks (remember, recall, dedup,
  injection, invalid args, general chat, timeout, retry, resume).
- `eval/tasks/chat/*.json` — 4 seeded chat tasks (remember, recall, dedup,
  general) with fake ports and scripted `ChatModel` responses.
- `eval/baseline.json` — pinned suite pass rates **and per-task pass/fail**.
  The gate fails CI if any pinned task flips to fail, even when the aggregate
  rate still looks fine.
- `eval/reports/` — gitignored run artifacts (report JSON + per-task traces),
  including seeds and prompt/completion character counts.

## Commands

```bash
pnpm eval                 # deterministic suite + gate (runs in CI)
pnpm eval:live            # same tasks/scorer, real DMR model (local only, never gates)
pnpm eval:live remember-city   # single task, useful for iteration
pnpm eval:replay <trace.jsonl>
pnpm eval:diff <a.jsonl> <b.jsonl>
```

`eval:live` uses `DMR_BASE_URL` (default `http://localhost:12434/engines/v1`)
and `DMR_CHAT_MODEL` (default `docker.io/ai/qwen2.5:3B-Q4_K_M`). Agent tasks use
the harness adapter (plain-text stop or one ` ```tool ` JSON block; tool-role
history is forwarded as `[tool:name]` user messages). Chat tasks use the same
OpenAI-compatible `ChatModel` adapter as the API, so they exercise the real
classification/extraction and response prompts.

## Gate semantics

- A suite pass rate may drop by at most 0.05 from the baseline.
- A task pinned as passing must still exist and pass; a flip to fail fails the
  gate regardless of the aggregate rate.
- A missing pinned task fails the gate.
- Each task runs once per invocation (`n: 1`) with its declared seed. The
  report records the seed and usage counters; it does not claim sampling
  variance coverage.
- `pnpm eval:live` never updates or enforces the baseline.

## Chat tasks

Chat task JSON uses `"kind": "chat"` and a `chatScript` array of model outputs:

1. classification/extraction JSON (`{"intent":"remember","memories":[...]}`),
2. assistant response text.

The runner builds in-memory repositories, fake embeddings, and an in-memory
vector store, loads `fixtures.memories`, and invokes the production `chat()`
command. Chat expectations extend the normal block with:

```json
{
  "responseIncludes": ["Lisbon"],
  "memoriesCreated": 1,
  "conversationMessages": 2,
  "duplicateCount": 0,
  "retrievedContains": ["Paris"]
}
```

`memoryCount`/`memories` still apply to the whole in-memory store.
`eval:live` swaps the scripted classifier/response model for DMR; fixtures and
ports remain deterministic.

## What the deterministic suite does NOT measure

The gate tests the **loop and graph wiring** (retries, cancellation, resume,
validation, idempotency, routing, persistence, dedup, scoring), not LLM judgment
or production retrieval. Known divergences between eval fakes and production
adapters:

| Eval fake                                     | Production                                    | Impact                                          |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| Agent `memory.search` = substring match       | Qdrant vector search (768-dim DMR embeddings) | Green eval says nothing about retrieval quality |
| Chat uses fake embeddings + in-memory vectors | DMR embeddings + provider-scoped Qdrant       | Chat retrieval ranking is not measured          |
| No pin/archive/importance/confidence/category | Full metadata model + Qdrant payload filters  | Filter paths unevaluated                        |
| Scripted model, single run (`n: 1`)           | Real LLM with sampling variance               | No flakiness signal; seeds are task metadata    |

Use `eval:live` to probe model behavior, and treat retrieval-quality
measurement (real Qdrant + labeled queries) as a separate future suite.

## Updating the baseline

1. Run `pnpm eval`.
2. Inspect `eval/reports/<runId>.json` and the failing traces.
3. If a behavior change is intentional, update `eval/baseline.json`
   (suite rates and/or per-task entries) in the same commit as the change,
   with a reason in the commit message.
4. Never lower the baseline to make CI green without a corresponding
   task or code fix.
