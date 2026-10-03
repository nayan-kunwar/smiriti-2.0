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

function reportWithTasks(
  tasks: Array<{ id: string; passed: boolean; failures?: string[] }>,
): EvalReport {
  const base = report(tasks.every((t) => t.passed) ? 1 : 0);
  return {
    ...base,
    suites: {
      memory: {
        passed: tasks.filter((t) => t.passed).length,
        total: tasks.length,
        passRate: tasks.length ? tasks.filter((t) => t.passed).length / tasks.length : 0,
        seeds: [1],
      },
    },
    tasks: tasks.map((t) => ({
      id: t.id,
      suite: 'memory',
      seed: 1,
      passed: t.passed,
      status: t.passed ? 'completed' : 'failed',
      latencyMs: 1,
      retryCount: 0,
      failures: t.failures ?? [],
    })),
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

  it('fails when a baseline-pinned task flips to fail', () => {
    const pinned = {
      suites: { memory: { passRate: 1 } },
      tasks: { 'remember-city': { passed: true } },
    };
    const gate = checkGate(
      reportWithTasks([
        { id: 'remember-city', passed: false, failures: ['missing tool call memory.create'] },
      ]),
      pinned,
    );
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.includes('remember-city'))).toBe(true);
  });

  it('passes when a pinned task still passes and rate holds', () => {
    const pinned = {
      suites: { memory: { passRate: 1 } },
      tasks: { 'remember-city': { passed: true } },
    };
    const gate = checkGate(reportWithTasks([{ id: 'remember-city', passed: true }]), pinned);
    expect(gate.ok).toBe(true);
  });

  it('fails when a baseline-pinned task is missing from the report', () => {
    const pinned = {
      suites: { memory: { passRate: 1 } },
      tasks: { 'remember-city': { passed: true } },
    };
    const gate = checkGate(reportWithTasks([]), pinned);
    expect(gate.ok).toBe(false);
    expect(gate.failures.some((f) => f.includes('remember-city'))).toBe(true);
  });
});
