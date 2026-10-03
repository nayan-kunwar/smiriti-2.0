import { randomUUID } from 'node:crypto';
import { RetryableError, RunAbortedError, TerminalError } from './errors.js';
import { compactMessages } from './context.js';
import { callSignature, idempotencyKey } from './tools.js';
import type {
  CheckpointState,
  CheckpointStore,
  Message,
  Model,
  ModelOutput,
  Policy,
  RunResult,
  RunStatus,
  Task,
  ToolRegistry,
  TraceEvent,
} from './types.js';

type TraceDraft =
  | { type: 'run.started' }
  | { type: 'model.output'; output: ModelOutput }
  | {
      type: 'tool.call';
      tool: string;
      version: string;
      args: unknown;
      idempotencyKey: string;
    }
  | {
      type: 'tool.result';
      tool: string;
      version: string;
      ok: boolean;
      latencyMs: number;
      result?: unknown;
      error?: string;
    }
  | { type: 'retry'; tool: string; attempt: number; error: string }
  | { type: 'checkpoint' }
  | { type: 'run.finished'; status: RunStatus; latencyMs: number; error?: string };

export interface RunAgentInput {
  task: Task;
  tools: ToolRegistry;
  model: Model;
  policy: Policy;
  checkpoint?: CheckpointStore;
  signal?: AbortSignal;
}

export async function runAgent(input: RunAgentInput): Promise<RunResult> {
  const runId = input.task.runId ?? randomUUID();
  const startedAt = Date.now();
  const trace: TraceEvent[] = [];
  const failedSignatures = new Set<string>();

  const existing = input.checkpoint ? await input.checkpoint.load(runId) : null;
  let messages: Message[] = existing?.messages ?? [...input.task.messages];
  let step = existing?.step ?? 0;

  const userSignal = input.signal;
  const timeoutController = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, input.policy.timeoutMs);

  const signals = [timeoutController.signal, userSignal].filter((signal): signal is AbortSignal =>
    Boolean(signal),
  );
  const signal = AbortSignal.any(signals);

  const abortReason = (): 'aborted' | 'timeout' => {
    if (userSignal?.aborted && !timedOut) return 'aborted';
    return 'timeout';
  };

  const push = (event: TraceDraft) => {
    trace.push({
      ...event,
      runId,
      step,
      at: new Date().toISOString(),
    } as TraceEvent);
  };

  const persist = async (status: CheckpointState['status']) => {
    if (!input.checkpoint) return;
    await input.checkpoint.save({ runId, step, messages, status });
    push({ type: 'checkpoint' });
  };

  const finish = (status: RunStatus, error?: string): RunResult => {
    clearTimeout(timer);
    push({ type: 'run.finished', status, latencyMs: Date.now() - startedAt, error });
    return { runId, status, messages, trace, error };
  };

  push({ type: 'run.started' });

  try {
    // Returns on model stop, max steps, timeout, or abort.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal.aborted) {
        return finish('cancelled', abortReason());
      }
      if (step >= input.policy.maxSteps) {
        return finish('failed', 'max steps exceeded');
      }

      messages = compactMessages(messages, input.policy.maxContextChars);

      let output: ModelOutput;
      try {
        output = await withSignal(input.model.complete(messages), signal, abortReason);
      } catch (error) {
        if (error instanceof RunAbortedError) return finish('cancelled', error.reason);
        return finish('failed', errorMessage(error));
      }

      push({ type: 'model.output', output });

      if (output.type === 'stop') {
        if (output.text) {
          messages = [...messages, { role: 'assistant', content: output.text }];
        }
        await persist('completed');
        return finish('completed');
      }

      const call = output.call;
      const tool = input.tools.get(call.name);
      if (!tool) {
        return finish('failed', `unknown tool ${call.name}`);
      }

      const parsed = tool.schema.safeParse(call.args);
      const key = call.idempotencyKey ?? idempotencyKey(call.name, call.args);
      if (!parsed.success) {
        push({
          type: 'tool.call',
          tool: tool.name,
          version: tool.version,
          args: call.args,
          idempotencyKey: key,
        });
        push({
          type: 'tool.result',
          tool: tool.name,
          version: tool.version,
          ok: false,
          latencyMs: 0,
          error: 'schema validation failed',
        });
        return finish('failed', 'schema validation failed');
      }

      const signature = callSignature(call.name, parsed.data);
      if (failedSignatures.has(signature)) {
        return finish('failed', 'repeated failed call');
      }

      const outcome = await executeTool({
        toolName: tool.name,
        version: tool.version,
        args: parsed.data,
        idempotencyKey: key,
        execute: () => tool.execute(parsed.data, { idempotencyKey: key, signal }),
        policy: input.policy,
        signal,
        abortReason,
        push,
      });

      if (outcome.kind === 'aborted') {
        return finish('cancelled', outcome.reason);
      }
      if (outcome.kind === 'failed') {
        return finish('failed', outcome.error);
      }
      if (outcome.kind === 'recover') {
        failedSignatures.add(signature);
        messages = [
          ...messages,
          { role: 'tool', name: tool.name, content: JSON.stringify({ error: outcome.error }) },
        ];
        step += 1;
        await persist('running');
        continue;
      }

      messages = [
        ...messages,
        { role: 'tool', name: tool.name, content: JSON.stringify(outcome.result) },
      ];
      step += 1;
      await persist('running');
    }
  } finally {
    clearTimeout(timer);
  }
}

interface ExecuteInput {
  toolName: string;
  version: string;
  args: unknown;
  idempotencyKey: string;
  execute: () => Promise<unknown>;
  policy: Policy;
  signal: AbortSignal;
  abortReason: () => 'aborted' | 'timeout';
  push: (event: TraceDraft) => void;
}

type ExecuteOutcome =
  | { kind: 'ok'; result: unknown }
  | { kind: 'failed'; error: string }
  | { kind: 'recover'; error: string }
  | { kind: 'aborted'; reason: 'aborted' | 'timeout' };

async function executeTool(input: ExecuteInput): Promise<ExecuteOutcome> {
  let attempt = 0;
  input.push({
    type: 'tool.call',
    tool: input.toolName,
    version: input.version,
    args: input.args,
    idempotencyKey: input.idempotencyKey,
  });

  for (;;) {
    const startedAt = Date.now();
    try {
      const result = await withSignal(input.execute(), input.signal, input.abortReason);
      input.push({
        type: 'tool.result',
        tool: input.toolName,
        version: input.version,
        ok: true,
        latencyMs: Date.now() - startedAt,
        result,
      });
      return { kind: 'ok', result };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof RunAbortedError) {
        input.push({
          type: 'tool.result',
          tool: input.toolName,
          version: input.version,
          ok: false,
          latencyMs,
          error: error.reason,
        });
        return { kind: 'aborted', reason: error.reason };
      }

      const message = errorMessage(error);
      input.push({
        type: 'tool.result',
        tool: input.toolName,
        version: input.version,
        ok: false,
        latencyMs,
        error: message,
      });

      if (error instanceof RetryableError && attempt < input.policy.maxRetries) {
        attempt += 1;
        input.push({ type: 'retry', tool: input.toolName, attempt, error: message });
        continue;
      }
      if (error instanceof RetryableError) {
        return { kind: 'failed', error: 'retries exhausted' };
      }
      if (error instanceof TerminalError) {
        return { kind: 'failed', error: message };
      }
      return { kind: 'recover', error: message };
    }
  }
}

function withSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  reason: () => 'aborted' | 'timeout',
): Promise<T> {
  if (signal.aborted) return Promise.reject(new RunAbortedError(reason()));

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new RunAbortedError(reason()));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) reject(new RunAbortedError(reason()));
        else reject(error);
      },
    );
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}
