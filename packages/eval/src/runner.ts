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
import type { Message, Model, RunResult, Tool, TraceEvent } from '@smriti/harness';
import { chat } from '@smriti/application';
import { Memory } from '@smriti/domain';
import type { ChatModel } from '@smriti/domain';
import {
  FakeChatModel,
  FakeEmbeddingProvider,
  InMemoryAuditLogRepository,
  InMemoryConversationRepository,
  InMemoryMemoryRepository,
  InMemoryVectorStore,
} from '@smriti/infrastructure';
import { checkGate } from './gate.js';
import type { Baseline, EvalReport, SuiteScore, TaskReport } from './gate.js';
import { scoreChatTask } from './chat-score.js';
import type { ChatMemoryView } from './chat-score.js';
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
  baselinePath?: string;
  modelFactory?: (task: EvalTask) => Model;
  chatModelFactory?: (task: EvalTask) => ChatModel;
  taskFilter?: string;
}

export async function runEval(
  options: RunEvalOptions,
): Promise<{ report: EvalReport; gate: { ok: boolean; failures: string[] } }> {
  const allTasks = await loadTasks(options.tasksDir);
  const tasks = options.taskFilter
    ? allTasks.filter((task) => task.id === options.taskFilter)
    : allTasks;
  if (tasks.length === 0) {
    throw new Error(`no tasks match filter "${options.taskFilter ?? ''}"`);
  }
  const runId = randomUUID();
  const traceDir = path.join(options.reportsDir, runId);
  await mkdir(traceDir, { recursive: true });

  const modelFactory = options.modelFactory ?? ((task) => scriptedModel(task.scriptedModel ?? []));
  const chatModelFactory =
    options.chatModelFactory ??
    ((task) => new FakeChatModel(task.chatScript ?? ['{"intent":"general","memories":[]}']));
  const taskReports = await mapPool(tasks, CONCURRENCY, (task) =>
    runTask(task, runId, traceDir, modelFactory, chatModelFactory),
  );
  const report = buildReport(runId, taskReports);
  await writeFile(path.join(options.reportsDir, `${runId}.json`), JSON.stringify(report, null, 2));

  if (!options.baselinePath) {
    return { report, gate: { ok: true, failures: [] } };
  }
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

async function runTask(
  task: EvalTask,
  reportId: string,
  traceDir: string,
  modelFactory: (task: EvalTask) => Model,
  chatModelFactory: (task: EvalTask) => ChatModel,
): Promise<TaskReport> {
  if (task.kind === 'chat') {
    return runChatTask(task, traceDir, chatModelFactory(task));
  }

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
  const model = modelFactory(task);
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
    promptChars: messageChars(result.messages),
    completionChars: outputChars(result.trace),
  };
}

const CHAT_EVAL_USER_ID = '00000000-0000-4000-8000-000000000001';

async function runChatTask(
  task: EvalTask,
  traceDir: string,
  chatModel: ChatModel,
): Promise<TaskReport> {
  const startedAt = Date.now();
  const memoryRepository = new InMemoryMemoryRepository();
  const conversationRepository = new InMemoryConversationRepository();
  const auditLogRepository = new InMemoryAuditLogRepository();
  const embeddingProvider = new FakeEmbeddingProvider();
  const vectorStore = new InMemoryVectorStore();
  let response = '';
  let memoriesCreated = 0;
  let retrieved: ChatMemoryView[] = [];
  let duplicateCount = 0;
  let conversationMessages = 0;
  let error: string | undefined;

  try {
    for (const fixture of task.fixtures?.memories ?? []) {
      const memory = Memory.create({
        userId: CHAT_EVAL_USER_ID,
        type: fixture.type,
        content: fixture.content,
        tags: fixture.tags,
      });
      await memoryRepository.save(memory);
      const [vector] = await embeddingProvider.embed([memory.content]);
      await vectorStore.upsert([
        {
          id: memory.id,
          vector,
          payload: {
            userId: CHAT_EVAL_USER_ID,
            memoryId: memory.id,
            chunkIndex: 0,
            tags: memory.tags,
            createdAt: memory.createdAt.toISOString(),
          },
        },
      ]);
    }

    const userMessage = [...task.input.messages]
      .reverse()
      .find((message) => message.role === 'user')?.content;
    if (!userMessage) throw new Error('chat task has no user message');

    const result = await chat(
      {
        conversationRepository,
        chatModel,
        memoryRepository,
        auditLogRepository,
        embeddingProvider,
        vectorStore,
        dedupThreshold: 0.92,
        searchTimeoutMs: 1_000,
      },
      {
        userId: CHAT_EVAL_USER_ID,
        correlationId: `chat-eval-${task.id}`,
        message: userMessage,
      },
    );

    response = result.message;
    memoriesCreated = result.memoriesCreated.length;
    duplicateCount = result.duplicateWarnings.length;
    const retrievedMemories = await Promise.all(
      result.memoriesRetrieved.map((id) => memoryRepository.findById(CHAT_EVAL_USER_ID, id)),
    );
    retrieved = retrievedMemories
      .filter((memory): memory is Memory => memory !== null)
      .map((memory) => ({
        id: memory.id,
        content: memory.content,
        type: memory.type,
        tags: memory.tags,
      }));
    conversationMessages = (await conversationRepository.listMessages(result.conversationId))
      .length;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const allMemories = await memoryRepository.findByUser(CHAT_EVAL_USER_ID, {
    limit: 1_000,
    includeArchived: true,
  });
  const memories: ChatMemoryView[] = allMemories.items.map((memory) => ({
    id: memory.id,
    content: memory.content,
    type: memory.type,
    tags: memory.tags,
  }));
  const scored = scoreChatTask({
    status: error ? 'failed' : 'completed',
    response,
    memories,
    memoriesCreated,
    retrieved,
    duplicateCount,
    conversationMessages,
    expect: task.expect,
    error,
  });

  await writeFile(
    path.join(traceDir, `${task.id}.jsonl`),
    `${JSON.stringify({
      type: 'chat.result',
      taskId: task.id,
      response,
      memoriesCreated,
      retrievedContents: retrieved.map((memory) => memory.content),
      duplicateCount,
      conversationMessages,
      error,
    })}\n`,
  );

  return {
    id: task.id,
    suite: task.suite,
    seed: task.seed,
    passed: scored.passed,
    status: error ? 'failed' : 'completed',
    latencyMs: Date.now() - startedAt,
    retryCount: 0,
    failures: scored.failures,
    promptChars: task.input.messages.reduce((sum, message) => sum + message.content.length, 0),
    completionChars: response.length,
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
    usage: {
      promptChars: tasks.reduce((sum, task) => sum + (task.promptChars ?? 0), 0),
      completionChars: tasks.reduce((sum, task) => sum + (task.completionChars ?? 0), 0),
    },
  };
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function messageChars(messages: Message[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

export function outputChars(trace: TraceEvent[]): number {
  return trace
    .filter((event) => event.type === 'model.output')
    .reduce((sum, event) => {
      if (event.type !== 'model.output') return sum;
      return sum + JSON.stringify(event.output).length;
    }, 0);
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
