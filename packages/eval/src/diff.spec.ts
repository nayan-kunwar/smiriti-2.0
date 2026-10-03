import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@smriti/harness';
import { diffTraces } from './diff.js';

function call(step: number, tool: string, args: unknown): TraceEvent {
  return {
    runId: 'r',
    step,
    type: 'tool.call',
    at: '2026-01-01T00:00:00.000Z',
    tool,
    version: '1',
    args,
    idempotencyKey: 'k',
  };
}

describe('diffTraces', () => {
  it('returns the first step whose tool or arguments differ', () => {
    const left = [
      call(0, 'memory.create', { content: 'Pune' }),
      call(1, 'memory.search', { query: 'Pune' }),
    ];
    const right = [call(0, 'memory.create', { content: 'Pune' }), call(1, 'memory.list', {})];

    expect(diffTraces(left, right)).toContain('step 1');
  });

  it('returns null when tool calls match', () => {
    const events = [call(0, 'memory.search', { query: 'Pune' })];
    expect(diffTraces(events, events)).toBeNull();
  });
});
