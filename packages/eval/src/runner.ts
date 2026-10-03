import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createRegistry,
  memoryCheckpointStore,
  RetryableError,
  runAgent,
  traceToJsonl,
} from '@smriti/harness';
import type { RunResult, Tool } from '@smriti/harness';
import { checkGate } from './gate.js';
import type { Baseline, EvalReport, SuiteScore, TaskReport } from './gate.js';
import { MemoryStore } from './memory-store.js';
import { memoryTools } from './memory-tools.js';
import { scoreTask } from './score.js';
import { scriptedModel } from './scripted-model.js';
import { TaskSchema, taskPolicy } from './task.js';
import type { EvalTask } from './task.js';

const CONCURRENCY = 4;

export interface RunEvalOptions {
  tasksDir: string;
  reportsDir: string;
  baselinePath: string;
}

export async function runEval(
  options: RunEvalOptions,
): Promise<{ report: EvalReport; gate: { ok: boolean; failures: string[] } }> {
  const tasks = await loadTasks(options.tasksDir);
  const runId = randomUUID();
  const traceDir = path.join(options.reportsDir, runId);
  await mkdir(traceDir, { recursive: true });

  const taskReports = await mapPool(tasks, CONCURRENCY, (task) => runTask(task, runId, traceDir));
  const report = buildReport(runId, taskReports);
  await writeFile(path.join(options.reportsDir, `${runId}.json`), JSON.stringify(report, null, 2));

  const baseline = JSON.parse(await readFile(options.baselinePath, 'utf8')) as Baseline;
  const gate = checkGate(report, baseline);
  return { report, gate };
}

export async function loadTasks(tasksDir: string): Promise<EvalTask[]> {
  const entries = await readdir(tasksDir, { recursive: true });
  const files = entries
    .map((entry) => entry.toString())
    .filter((entry) => entry.endsWith('.json'))
    .sort();

  const tasks: EvalTask[] = [];
  for (const file of files) {
    const raw = JSON.parse(await readFile(path.join(tasksDir, file), 'utf8')) as unknown;
    tasks.push(TaskSchema.parse(raw));
  }
  return tasks;
}

async function runTask(task: EvalTask, reportId: string, traceDir: string): Promise<TaskReport> {
  const startedAt = Date.now();
  const store = new MemoryStore(task.fixtures?.memories ?? []);
  let tools = memoryTools(store);
  if (task.hangTool) {
    tools = tools.map((tool) => (tool.name === task.hangTool ? hangTool(tool) : tool));
  }
  for (const failure of task.injectFailures ?? []) {
    tools = tools.map((tool) =>
      tool.name === failure.tool ? failTimes(tool, failure.times) : tool,
    );
  }

  const registry = createRegistry(tools);
  const model = scriptedModel(task.scriptedModel);
  const checkpoint = memoryCheckpointStore();
  const runId = `${reportId}_${task.id}`;
  const agentTask = { runId, messages: task.input.messages };

  let result: RunResult;
  if (task.resumeAfterStep) {
    const first = await runAgent({
      task: agentTask,
      tools: registry,
      model,
      policy: { ...taskPolicy(task), maxSteps: task.resumeAfterStep },
      checkpoint,
    });
    const second = await runAgent({
      task: agentTask,
      tools: registry,
      model,
      policy: taskPolicy(task),
      checkpoint,
    });
    result = { ...second, trace: [...first.trace, ...second.trace] };
  } else {
    result = await runAgent({
      task: agentTask,
      tools: registry,
      model,
      policy: taskPolicy(task),
      checkpoint,
    });
  }

  await writeFile(path.join(traceDir, `${task.id}.jsonl`), traceToJsonl(result.trace));
  const scored = scoreTask({
    status: result.status,
    trace: result.trace,
    memories: store.list(),
    expect: task.expect,
  });

  return {
    id: task.id,
    suite: task.suite,
    seed: task.seed,
    passed: scored.passed,
    status: result.status,
    latencyMs: Date.now() - startedAt,
    retryCount: result.trace.filter((event) => event.type === 'retry').length,
    failures: scored.failures,
  };
}

function buildReport(runId: string, tasks: TaskReport[]): EvalReport {
  const suites: Record<string, SuiteScore> = {};
  for (const task of tasks) {
    const suite = suites[task.suite] ?? { passed: 0, total: 0, passRate: 0, seeds: [] };
    suite.total += 1;
    suite.passed += task.passed ? 1 : 0;
    suite.seeds.push(task.seed);
    suite.passRate = suite.total === 0 ? 0 : suite.passed / suite.total;
    suites[task.suite] = suite;
  }

  const latencies = tasks.map((task) => task.latencyMs);
  const retryCount = tasks.reduce((sum, task) => sum + task.retryCount, 0);
  return {
    runId,
    n: 1,
    note: 'Result is a single run.',
    suites,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    retryCount,
    tasks,
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

function hangTool(tool: Tool): Tool {
  return {
    ...tool,
    execute: (_args, ctx) =>
      new Promise((_resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        if (ctx.signal.aborted) abort();
        else ctx.signal.addEventListener('abort', abort, { once: true });
      }),
  };
}

function failTimes(tool: Tool, times: number): Tool {
  let remaining = times;
  return {
    ...tool,
    execute: async (args, ctx) => {
      if (remaining > 0) {
        remaining -= 1;
        throw new RetryableError('injected failure');
      }
      return tool.execute(args, ctx);
    },
  };
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
