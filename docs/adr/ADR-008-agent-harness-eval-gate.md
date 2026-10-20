# ADR-008: Agent Harness and Deterministic Eval Gate

**Status**: Accepted
**Date**: 2026-10-20
**Deciders**: Engineering

## Context

Smriti's agent behavior spans tool selection, argument validation, retries, cancellation, context limits, checkpoints, and memory side effects. Testing only prompts against a live model is slow, nondeterministic, and unsuitable as a CI gate. A live-model run is still useful for local exploration.

We need:

- a reusable agent loop with hard policy caps;
- deterministic tests for loop mechanics and memory tool behavior;
- a gate that catches regressions in individual tasks, not just a shifted aggregate;
- visibility into token/character usage and seeds;
- a local-only path for real-model checks.

## Decision

### Harness

`packages/harness` provides a generic agent loop with:

- schema-validated tools and structured tool results;
- policy caps for max steps, timeout, retries, and context size;
- per-call idempotency keys;
- retryable versus terminal error classification;
- abort/timeout cancellation;
- per-step checkpoints and resume;
- bounded context that drops the oldest tool results first;
- full JSONL traces.

### Deterministic eval

`packages/eval` wires the harness to memory tools over an in-memory store and a scripted model (canned steps, no LLM call):

- `memory.create`, `memory.search`, and `memory.list` tools;
- ten seeded agent tasks covering remember, recall, dedup, prompt injection, invalid arguments, general chat, timeout, retry, and resume;
- four seeded chat tasks running the production LangGraph command with fake ports and a scripted `ChatModel` (remember, recall, dedup, general);
- separate agent and chat scorers plus one shared baseline gate;
- `replay`, `diff`, and `live` CLI commands.

`pnpm eval` runs the deterministic suite and gate. `pnpm eval:live` uses DMR chat (`DMR_CHAT_MODEL`) and is local-only; it never gates CI.

### Gate policy

- `eval/baseline.json` pins both suite pass rates and per-task pass/fail.
- The suite tolerance is 0.05, but any task pinned as passing that flips to failing (or disappears) fails the gate even if the aggregate rate is unchanged.
- Updating the baseline requires an intentional behavior change and a reason in the commit message.
- The baseline is never lowered just to make CI green.
- Each task carries a seed in task JSON and the report records it. The runner executes one run per task (`n: 1`) and reports `promptChars` and `completionChars` for usage tracking.

### Limits

The deterministic gate measures the **loop**, not model judgment or production retrieval:

- agent tasks use substring search, not Qdrant vector search;
- chat tasks use in-memory vector search with deterministic fake embeddings, not DMR/Qdrant;
- the in-memory store does not reproduce every production filter/metadata path;
- scripted models have no sampling variance;
- one run per task provides no flakiness signal.

Retrieval-quality measurement with real Qdrant and labeled queries remains a separate future suite. Live DMR runs are for exploration, not regression gating.

## Consequences

### Positive

- CI can test retries, cancellation, resume, validation, idempotency, and scoring without a model.
- Per-task pins catch regressions that aggregate pass rates hide.
- Traces are replayable and diffable.
- The chat suite exercises the production graph, not a parallel eval-only implementation.
- Character counters and seeds make local live runs comparable.

### Negative

- The deterministic suite can pass while real retrieval quality regresses.
- Maintaining scripted tasks and per-task pins adds upkeep.
- Live-model behavior is not covered by CI.

### Mitigations

- Keep `eval:live` and document its non-gating status.
- Add a separate retrieval-quality suite when Qdrant-backed evaluation is in scope.
- Require intentional baseline updates with reasons.

## Compliance

- `pnpm eval` must exit zero on the pinned baseline.
- `pnpm eval:live` must not be part of CI.
- Every task has a stable `id`, `suite`, and `seed`.
- Baseline changes accompany code/task changes in the same commit.
