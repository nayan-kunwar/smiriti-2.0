import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fileCheckpointStore, memoryCheckpointStore } from './checkpoint.js';
import { RetryableError, TerminalError } from './errors.js';
import { runAgent } from './loop.js';
import { createRegistry, defineTool } from './tools.js';
import { resolvePolicy } from './types.js';
import type { Message, Model, ModelOutput, Tool } from './types.js';

const echoSchema = z.object({ text: z.string().min(1) });

function scripted(steps: ModelOutput[]): Model {
  let index = 0;
  return {
    async complete() {
      const step = steps[index];
      index += 1;
      return step ?? { type: 'stop' };
    },
  };
}

function echoTool(execute?: Tool['execute']): Tool {
  return defineTool({
    name: 'echo',
    version: '1',
    schema: echoSchema,
    execute: execute ?? (async (args) => ({ heard: args.text })),
  });
}

describe('runAgent', () => {
  it('stops when the model stops', async () => {
    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'hi' }] },
      tools: createRegistry([]),
      model: scripted([{ type: 'stop', text: 'hello' }]),
      policy: resolvePolicy(),
    });

    expect(result.status).toBe('completed');
    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'hello' });
    expect(result.trace.some((event) => event.type === 'run.finished')).toBe(true);
  });

  it('fails when max steps is hit', async () => {
    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([echoTool()]),
      model: scripted([{ type: 'tool', call: { name: 'echo', args: { text: 'a' } } }]),
      policy: resolvePolicy({ maxSteps: 1 }),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('max steps exceeded');
  });

  it('cancels when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([]),
      model: scripted([{ type: 'stop' }]),
      policy: resolvePolicy(),
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('aborted');
  });

  it('cancels when a tool hangs past the timeout', async () => {
    const hanging = echoTool(
      (_args, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true },
          );
        }),
    );

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([hanging]),
      model: scripted([{ type: 'tool', call: { name: 'echo', args: { text: 'wait' } } }]),
      policy: resolvePolicy({ timeoutMs: 30 }),
    });

    expect(result.status).toBe('cancelled');
    expect(result.error).toBe('timeout');
    expect(result.trace.some((event) => event.type === 'tool.call')).toBe(true);
  });

  it('retries a retryable error with the same idempotency key', async () => {
    const keys: string[] = [];
    const tool = echoTool(async (args, ctx) => {
      keys.push(ctx.idempotencyKey);
      if (keys.length === 1) throw new RetryableError('temporary');
      return { heard: args.text };
    });

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([tool]),
      model: scripted([
        { type: 'tool', call: { name: 'echo', args: { text: 'once' } } },
        { type: 'stop' },
      ]),
      policy: resolvePolicy(),
    });

    expect(result.status).toBe('completed');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(result.trace.filter((event) => event.type === 'retry')).toHaveLength(1);
  });

  it('stops on schema failure without retrying', async () => {
    let calls = 0;
    const tool = echoTool(async (args) => {
      calls += 1;
      return { heard: args.text };
    });

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([tool]),
      model: scripted([{ type: 'tool', call: { name: 'echo', args: { text: '' } } }]),
      policy: resolvePolicy(),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('schema validation failed');
    expect(calls).toBe(0);
    expect(result.trace.some((event) => event.type === 'retry')).toBe(false);
  });

  it('stops on a terminal tool error', async () => {
    const tool = echoTool(async () => {
      throw new TerminalError('nope');
    });

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([tool]),
      model: scripted([{ type: 'tool', call: { name: 'echo', args: { text: 'x' } } }]),
      policy: resolvePolicy(),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('nope');
  });

  it('stops when the model repeats a failed call', async () => {
    let calls = 0;
    const tool = echoTool(async () => {
      calls += 1;
      throw new Error('boom');
    });
    const call = { type: 'tool' as const, call: { name: 'echo', args: { text: 'x' } } };

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([tool]),
      model: scripted([call, call]),
      policy: resolvePolicy(),
    });

    expect(result.status).toBe('failed');
    expect(result.error).toBe('repeated failed call');
    expect(calls).toBe(1);
  });

  it('compacts tool results before the next model call', async () => {
    const seen: Message[][] = [];
    const model: Model = {
      async complete(messages) {
        seen.push(messages);
        if (seen.length === 1) {
          return { type: 'tool', call: { name: 'echo', args: { text: 'hi' } } };
        }
        return { type: 'stop' };
      },
    };
    const tool = echoTool(async () => ({ blob: 'z'.repeat(400) }));

    const result = await runAgent({
      task: { messages: [{ role: 'user', content: 'go' }] },
      tools: createRegistry([tool]),
      model,
      policy: resolvePolicy({ maxContextChars: 80 }),
    });

    expect(result.status).toBe('completed');
    expect(seen[1]?.some((message) => message.content.startsWith('Dropped '))).toBe(true);
    expect(seen[1]?.some((message) => message.content.includes('zzzz'))).toBe(false);
  });

  it('resumes from a checkpoint', async () => {
    const checkpoint = memoryCheckpointStore();
    const steps: ModelOutput[] = [
      { type: 'tool', call: { name: 'echo', args: { text: 'one' } } },
      { type: 'stop', text: 'done' },
    ];
    const model = scripted(steps);
    const tools = createRegistry([echoTool()]);
    const task = { runId: 'run-1', messages: [{ role: 'user', content: 'go' }] };

    const first = await runAgent({
      task,
      tools,
      model,
      policy: resolvePolicy({ maxSteps: 1 }),
      checkpoint,
    });
    const second = await runAgent({
      task,
      tools,
      model,
      policy: resolvePolicy({ maxSteps: 4 }),
      checkpoint,
    });

    expect(first.status).toBe('failed');
    expect(second.status).toBe('completed');
    expect(second.messages.some((message) => message.content.includes('one'))).toBe(true);
    expect(second.messages.at(-1)?.content).toBe('done');
  });

  it('writes a file checkpoint', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'smriti-ckpt-'));
    const checkpoint = fileCheckpointStore(dir);
    await runAgent({
      task: { runId: 'file-run', messages: [{ role: 'user', content: 'hi' }] },
      tools: createRegistry([]),
      model: scripted([{ type: 'stop', text: 'ok' }]),
      policy: resolvePolicy(),
      checkpoint,
    });

    const saved = await checkpoint.load('file-run');
    expect(saved?.status).toBe('completed');
    const raw = await readFile(path.join(dir, 'file-run.json'), 'utf8');
    expect(raw).toContain('file-run');
  });
});
