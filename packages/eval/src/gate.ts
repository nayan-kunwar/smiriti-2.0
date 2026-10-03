export interface SuiteScore {
  passed: number;
  total: number;
  passRate: number;
  seeds: number[];
}

export interface TaskReport {
  id: string;
  suite: string;
  seed: number;
  passed: boolean;
  status: string;
  latencyMs: number;
  retryCount: number;
  failures: string[];
}

export interface EvalReport {
  runId: string;
  n: number;
  note: string;
  suites: Record<string, SuiteScore>;
  latencyMs: { p50: number; p95: number };
  retryCount: number;
  tasks: TaskReport[];
}

export interface Baseline {
  suites: Record<string, { passRate: number }>;
}

export function checkGate(
  report: EvalReport,
  baseline: Baseline,
): { ok: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const [name, expected] of Object.entries(baseline.suites)) {
    const actual = report.suites[name];
    if (!actual) {
      failures.push(`missing suite ${name}`);
      continue;
    }
    const drop = expected.passRate - actual.passRate;
    if (drop - 0.05 > 1e-9) {
      failures.push(
        `${name} pass rate ${actual.passRate} dropped more than 0.05 from ${expected.passRate}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
