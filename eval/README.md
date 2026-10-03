# Eval harness

Deterministic agent-loop evals (`packages/harness` + `packages/eval`) with a CI gate.
`pnpm eval` is the deterministic gate. `pnpm eval:live` is local-only exploration.

## Layout

- `packages/harness/` — generic agent loop: tool-calling loop with policy caps
  (max steps / timeout / retries), schema-validated tools, per-call idempotency
  keys, retryable vs terminal errors, abort/timeout cancellation, per-step
  checkpoints with resume, bounded context (drops oldest tool results first),
  full JSONL traces.
- `packages/eval/` — memory suite wiring: `memory.create/search/list` tools over
  an in-memory store, scripted model (canned steps, no LLM), scorer, baseline
  gate, `replay`/`diff`/`live` CLI commands.
- `eval/tasks/memory/*.json` — 10 seeded tasks (remember, recall, dedup,
  injection, invalid args, general chat, timeout, retry, resume).
- `eval/baseline.json` — pinned suite pass rates **and per-task pass/fail**.
  The gate fails CI if any pinned task flips to fail, even when the aggregate
  rate still looks fine.
- `eval/reports/` — gitignored run artifacts (report JSON + per-task traces).

## Commands

```bash
pnpm eval                 # deterministic suite + gate (runs in CI)
pnpm eval:live            # same tasks/scorer, real DMR model (local only, never gates)
pnpm eval:live remember-city   # single task, useful for iteration
pnpm eval:replay <trace.jsonl>
pnpm eval:diff <a.jsonl> <b.jsonl>
```

`eval:live` uses `DMR_BASE_URL` (default `http://localhost:12434/engines/v1`)
and `DMR_CHAT_MODEL` (default `docker.io/ai/qwen2.5:3B-Q4_K_M`). The model is
instructed to answer in plain text (stop) or emit one tool call inside a
` ```tool ` JSON block. Tool-role history is forwarded as
`[tool:name]` user messages — an approximation, not the production prompt.

## What the deterministic suite does NOT measure

The gate tests the **loop** (retries, cancellation, resume, validation,
idempotency, scoring), not LLM judgment or production retrieval. Known
divergences between eval fakes and production adapters:

| Eval fake                                     | Production                                    | Impact                                          |
| --------------------------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `memory.search` = substring match             | Qdrant vector search (768-dim DMR embeddings) | Green eval says nothing about retrieval quality |
| `MemoryStore.create` dedups on content        | API dedups detect-only (ADR-006), no merge    | Dedup behavior differs by design                |
| No pin/archive/importance/confidence/category | Full metadata model + Qdrant payload filters  | Filter paths unevaluated                        |
| Scripted model, single run (`n: 1`)           | Real LLM with sampling variance               | No flakiness signal                             |

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
