import { describe, expect, it } from 'vitest';
import { checkGate } from './gate.js';
import type { EvalReport } from './gate.js';

function report(passRate: number): EvalReport {
  return {
    runId: 'r',
    n: 1,
    note: 'Result is a single run.',
    suites: { memory: { passed: 1, total: 1, passRate, seeds: [1] } },
    latencyMs: { p50: 1, p95: 1 },
    retryCount: 0,
    tasks: [],
  };
}

describe('checkGate', () => {
  const baseline = { suites: { memory: { passRate: 1 } } };

  it('fails when pass rate drops by more than 0.05', () => {
    const gate = checkGate(report(0.94), baseline);
    expect(gate.ok).toBe(false);
    expect(gate.failures[0]).toContain('memory');
  });

  it('allows a drop of 0.05', () => {
    expect(checkGate(report(0.95), baseline).ok).toBe(true);
  });
});
