import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonl } from '@smriti/harness';
import { diffTraces } from './diff.js';
import { DEFAULT_DMR_BASE_URL, DEFAULT_DMR_CHAT_MODEL, dmrModel } from './dmr-model.js';
import { runEval } from './runner.js';
import { replayTrace } from './replay.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'replay') {
    const file = args[0];
    if (!file) throw new Error('usage: eval:replay <trace.jsonl>');
    const results = await replayTrace(file);
    process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
    return;
  }

  if (command === 'diff') {
    const [left, right] = args;
    if (!left || !right) throw new Error('usage: eval:diff <a.jsonl> <b.jsonl>');
    const message = diffTraces(
      parseJsonl(await readFile(left, 'utf8')),
      parseJsonl(await readFile(right, 'utf8')),
    );
    if (message) {
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write('traces match\n');
    return;
  }

  if (command === 'live') {
    // Local-only: same tasks and scorer, real DMR model instead of the scripted
    // model. Informational — never gates CI (see eval/README.md).
    const [taskFilter] = args;
    const baseUrl = process.env.DMR_BASE_URL ?? DEFAULT_DMR_BASE_URL;
    const model = process.env.DMR_CHAT_MODEL ?? DEFAULT_DMR_CHAT_MODEL;
    process.stdout.write(`live model ${model} at ${baseUrl}\n`);
    const { report } = await runEval({
      tasksDir: path.join(repoRoot, 'eval', 'tasks'),
      reportsDir: path.join(repoRoot, 'eval', 'reports'),
      modelFactory: () => dmrModel({ baseUrl, model }),
      ...(taskFilter ? { taskFilter } : {}),
    });
    printReport(report, path.join(repoRoot, 'eval', 'reports'));
    for (const task of report.tasks) {
      const status = task.passed ? 'pass' : 'FAIL';
      process.stdout.write(
        `  ${status} ${task.id} status=${task.status} retries=${task.retryCount} failures=${task.failures.join('; ')}\n`,
      );
    }
    return;
  }

  if (command) {
    throw new Error(`unknown command ${command}`);
  }

  const { report, gate } = await runEval({
    tasksDir: path.join(repoRoot, 'eval', 'tasks'),
    reportsDir: path.join(repoRoot, 'eval', 'reports'),
    baselinePath: path.join(repoRoot, 'eval', 'baseline.json'),
  });

  printReport(report, path.join(repoRoot, 'eval', 'reports'));

  if (!gate.ok) {
    for (const failure of gate.failures) process.stderr.write(`${failure}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('gate ok\n');
}

function printReport(report: import('./gate.js').EvalReport, reportsDir: string): void {
  for (const [name, suite] of Object.entries(report.suites)) {
    process.stdout.write(
      `${name} pass rate ${suite.passRate} (${suite.passed}/${suite.total}) n=${report.n} seeds=${suite.seeds.join(',')}\n`,
    );
  }
  process.stdout.write(
    `latency p50=${report.latencyMs.p50} p95=${report.latencyMs.p95} retries=${report.retryCount}\n`,
  );
  if (report.usage) {
    process.stdout.write(
      `chars prompt=${report.usage.promptChars} completion=${report.usage.completionChars}\n`,
    );
  }
  process.stdout.write(`${report.note}\n`);
  process.stdout.write(`report ${path.join(reportsDir, `${report.runId}.json`)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'eval failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
