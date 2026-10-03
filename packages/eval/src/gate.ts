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
  promptChars?: number;
  completionChars?: number;
}

export interface EvalReport {
  runId: string;
  n: number;
  note: string;
  suites: Record<string, SuiteScore>;
  latencyMs: { p50: number; p95: number };
  retryCount: number;
  tasks: TaskReport[];
  usage?: { promptChars: number; completionChars: number };
}

export interface Baseline {
  suites: Record<string, { passRate: number }>;
  tasks?: Record<string, { passed: boolean }>;
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
  const byId = new Map(report.tasks.map((task) => [task.id, task]));
  for (const [id, expected] of Object.entries(baseline.tasks ?? {})) {
    const actual = byId.get(id);
    if (!actual) {
      failures.push(`missing task ${id} (pinned in baseline)`);
      continue;
    }
    if (expected.passed && !actual.passed) {
      failures.push(
        `task ${id} previously passed, now fails: ${actual.failures.join('; ') || actual.status}`,
      );
    }
  }
  return { ok: failures.length === 0, failures };
}
