import { collectDefaultMetrics, Counter, Histogram, Registry } from 'prom-client';

const HTTP_LABELS = ['method', 'route', 'status'] as const;
const JOB_LABELS = ['queue', 'job', 'status'] as const;
const JOB_FAILURE_LABELS = ['queue', 'job'] as const;
const CHAT_TURN_LABELS = ['status'] as const;
const CHAT_TURN_RETRY_LABELS = ['outcome'] as const;

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export interface MetricsOptions {
  /** Defaults to false under NODE_ENV=test/Vitest to avoid prom-client's event-loop timer. */
  defaultMetrics?: boolean;
}

/**
 * Prometheus registry shared by one process. API and worker each create their
 * own instance; tests can create isolated instances without global state.
 */
export class Metrics {
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<(typeof HTTP_LABELS)[number]>;
  private readonly httpDuration: Histogram<(typeof HTTP_LABELS)[number]>;
  private readonly jobs: Counter<(typeof JOB_LABELS)[number]>;
  private readonly jobDuration: Histogram<(typeof JOB_LABELS)[number]>;
  private readonly terminalJobFailures: Counter<(typeof JOB_FAILURE_LABELS)[number]>;
  private readonly manualJobRetries: Counter<(typeof JOB_FAILURE_LABELS)[number]>;
  private readonly chatTurns: Counter<(typeof CHAT_TURN_LABELS)[number]>;
  private readonly chatTurnDuration: Histogram<(typeof CHAT_TURN_LABELS)[number]>;
  private readonly chatTurnRetries: Counter<(typeof CHAT_TURN_RETRY_LABELS)[number]>;

  constructor(options: MetricsOptions = {}) {
    this.registry.setDefaultLabels({ service: 'smriti' });
    const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
    if (options.defaultMetrics ?? !isTest) {
      collectDefaultMetrics({ register: this.registry, prefix: 'smriti_' });
    }

    this.httpRequests = new Counter({
      name: 'smriti_http_requests_total',
      help: 'Total HTTP requests handled by the API.',
      labelNames: HTTP_LABELS,
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'smriti_http_request_duration_seconds',
      help: 'HTTP request duration in seconds.',
      labelNames: HTTP_LABELS,
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
    this.jobs = new Counter({
      name: 'smriti_bullmq_jobs_total',
      help: 'Total BullMQ jobs processed by the worker.',
      labelNames: JOB_LABELS,
      registers: [this.registry],
    });
    this.jobDuration = new Histogram({
      name: 'smriti_bullmq_job_duration_seconds',
      help: 'BullMQ job processing duration in seconds.',
      labelNames: JOB_LABELS,
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
    this.terminalJobFailures = new Counter({
      name: 'smriti_job_terminal_failures_total',
      help: 'BullMQ jobs that exhausted their attempts and were persisted as durable failures.',
      labelNames: JOB_FAILURE_LABELS,
      registers: [this.registry],
    });
    this.manualJobRetries = new Counter({
      name: 'smriti_job_manual_retries_total',
      help: 'Durable job failures manually replayed by an admin.',
      labelNames: JOB_FAILURE_LABELS,
      registers: [this.registry],
    });
    this.chatTurns = new Counter({
      name: 'smriti_chat_turns_total',
      help: 'Chat turns that reached a terminal state.',
      labelNames: CHAT_TURN_LABELS,
      registers: [this.registry],
    });
    this.chatTurnDuration = new Histogram({
      name: 'smriti_chat_turn_duration_seconds',
      help: 'Chat turn execution duration in seconds.',
      labelNames: CHAT_TURN_LABELS,
      buckets: LATENCY_BUCKETS,
      registers: [this.registry],
    });
    this.chatTurnRetries = new Counter({
      name: 'smriti_chat_turn_retries_total',
      help: 'Manual chat turn retries by outcome.',
      labelNames: CHAT_TURN_RETRY_LABELS,
      registers: [this.registry],
    });
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  observeHttp(method: string, route: string, status: number, durationSeconds: number): void {
    const labels = {
      method: method.toUpperCase(),
      route,
      status: String(status),
    };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  observeJob(
    queue: string,
    job: string,
    status: 'completed' | 'failed',
    durationSeconds: number,
  ): void {
    const labels = { queue, job, status };
    this.jobs.inc(labels);
    this.jobDuration.observe(labels, durationSeconds);
  }

  observeTerminalJobFailure(queue: string, job: string): void {
    this.terminalJobFailures.inc({ queue, job });
  }

  observeManualJobRetry(queue: string, job: string): void {
    this.manualJobRetries.inc({ queue, job });
  }

  observeChatTurn(status: 'completed' | 'failed', durationSeconds: number): void {
    const labels = { status };
    this.chatTurns.inc(labels);
    this.chatTurnDuration.observe(labels, durationSeconds);
  }

  observeChatTurnRetry(outcome: 'completed' | 'failed' | 'replayed' | 'conflict'): void {
    this.chatTurnRetries.inc({ outcome });
  }

  reset(): void {
    this.registry.resetMetrics();
  }
}
