import type { RunStatus, TraceEvent } from '@smriti/harness';
import type { Expectation } from './task.js';
import type { StoredMemory } from './memory-store.js';

export interface ScoreInput {
  status: RunStatus;
  trace: TraceEvent[];
  memories: StoredMemory[];
  expect: Expectation;
}

export interface ScoreResult {
  passed: boolean;
  failures: string[];
}

export function scoreTask(input: ScoreInput): ScoreResult {
  const failures: string[] = [];
  if (input.status !== input.expect.status) {
    failures.push(`status ${input.status} != ${input.expect.status}`);
  }

  const calls = input.trace.filter((event) => event.type === 'tool.call');

  if (input.expect.toolCalls) {
    if (input.expect.toolCalls.length === 0 && calls.length !== 0) {
      failures.push(`expected no tool calls, saw ${calls.map((call) => call.tool).join(', ')}`);
    }
    let cursor = 0;
    for (const expected of input.expect.toolCalls) {
      const foundAt = calls.slice(cursor).findIndex((call) => {
        return call.tool === expected.name && argsInclude(call.args, expected.argsIncludes);
      });
      if (foundAt === -1) {
        failures.push(`missing tool call ${expected.name}`);
      } else {
        cursor += foundAt + 1;
      }
    }
  }

  for (const forbidden of input.expect.forbiddenTools ?? []) {
    if (calls.some((call) => call.tool === forbidden)) {
      failures.push(`forbidden tool ${forbidden} was called`);
    }
  }

  if (
    input.expect.memoryCount !== undefined &&
    input.memories.length !== input.expect.memoryCount
  ) {
    failures.push(`memory count ${input.memories.length} != ${input.expect.memoryCount}`);
  }

  for (const expected of input.expect.memories ?? []) {
    const matched = input.memories.some((memory) => {
      const contentOk =
        expected.contentIncludes === undefined || memory.content.includes(expected.contentIncludes);
      const typeOk = expected.type === undefined || memory.type === expected.type;
      return contentOk && typeOk;
    });
    if (!matched) {
      failures.push(`missing memory ${expected.contentIncludes ?? expected.type ?? 'match'}`);
    }
  }

  return { passed: failures.length === 0, failures };
}

function argsInclude(args: unknown, expected: Record<string, string> | undefined): boolean {
  if (!expected) return true;
  if (!args || typeof args !== 'object') return false;
  const record = args as Record<string, unknown>;
  return Object.entries(expected).every(([key, value]) => {
    const actual = record[key];
    if (typeof actual === 'string') return actual === value || actual.includes(value);
    const serialized = JSON.stringify(actual);
    return serialized === value || (serialized?.includes(value) ?? false);
  });
}
