import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@smriti/harness';
import { scoreTask } from './score.js';

function call(tool: string, args: unknown): TraceEvent {
  return {
    runId: 'r',
    step: 0,
    type: 'tool.call',
    at: '2026-01-01T00:00:00.000Z',
    tool,
    version: '1',
    args,
    idempotencyKey: 'k',
  };
}

describe('scoreTask', () => {
  it('passes when status, tool args, and memories match', () => {
    const result = scoreTask({
      status: 'completed',
      trace: [call('memory.create', { content: 'User lives in Pune.', type: 'semantic' })],
      memories: [{ id: '1', content: 'User lives in Pune.', type: 'semantic', tags: [] }],
      expect: {
        status: 'completed',
        toolCalls: [{ name: 'memory.create', argsIncludes: { content: 'Pune' } }],
        memoryCount: 1,
        memories: [{ contentIncludes: 'Pune', type: 'semantic' }],
      },
    });

    expect(result.passed).toBe(true);
  });

  it('fails when a forbidden tool is called', () => {
    const result = scoreTask({
      status: 'completed',
      trace: [call('memory.delete', {})],
      memories: [],
      expect: { status: 'completed', forbiddenTools: ['memory.delete'] },
    });

    expect(result.passed).toBe(false);
    expect(result.failures[0]).toContain('forbidden tool');
  });

  it('matches ordered repeats against absolute positions', () => {
    const trace = [
      call('memory.create', { content: 'first' }),
      call('memory.search', { query: 'x' }),
      call('memory.create', { content: 'second' }),
      call('memory.create', { content: 'third' }),
    ];
    const result = scoreTask({
      status: 'completed',
      trace,
      memories: [],
      expect: {
        status: 'completed',
        toolCalls: [
          { name: 'memory.create', argsIncludes: { content: 'first' } },
          { name: 'memory.create', argsIncludes: { content: 'second' } },
          { name: 'memory.create', argsIncludes: { content: 'third' } },
        ],
      },
    });

    expect(result.failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});
