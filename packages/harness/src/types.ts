import type { z } from 'zod';

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  role: Role;
  content: string;
  name?: string;
}

export interface Task {
  runId?: string;
  messages: Message[];
}

export interface ToolCall {
  name: string;
  args: unknown;
  idempotencyKey?: string;
}

export type ModelOutput = { type: 'stop'; text?: string } | { type: 'tool'; call: ToolCall };

export interface Model {
  complete(messages: Message[]): Promise<ModelOutput>;
}

export interface ToolContext {
  idempotencyKey: string;
  signal: AbortSignal;
}

export interface Tool {
  name: string;
  version: string;
  schema: z.ZodType;
  execute(args: unknown, ctx: ToolContext): Promise<unknown>;
}

export interface ToolRegistry {
  get(name: string): Tool | undefined;
}

export interface Policy {
  maxSteps: number;
  timeoutMs: number;
  maxRetries: number;
  maxContextChars: number;
}

export const defaultPolicy: Policy = {
  maxSteps: 8,
  timeoutMs: 30_000,
  maxRetries: 2,
  maxContextChars: 8_000,
};

export function resolvePolicy(override?: Partial<Policy>): Policy {
  return { ...defaultPolicy, ...override };
}

export type RunStatus = 'completed' | 'cancelled' | 'failed';

export interface CheckpointState {
  runId: string;
  step: number;
  messages: Message[];
  status: RunStatus | 'running';
}

export interface CheckpointStore {
  load(runId: string): Promise<CheckpointState | null>;
  save(state: CheckpointState): Promise<void>;
}

export interface RunResult {
  runId: string;
  status: RunStatus;
  messages: Message[];
  trace: TraceEvent[];
  error?: string;
}

export type TraceEvent =
  | { runId: string; step: number; type: 'run.started'; at: string }
  | {
      runId: string;
      step: number;
      type: 'model.output';
      at: string;
      output: ModelOutput;
    }
  | {
      runId: string;
      step: number;
      type: 'tool.call';
      at: string;
      tool: string;
      version: string;
      args: unknown;
      idempotencyKey: string;
    }
  | {
      runId: string;
      step: number;
      type: 'tool.result';
      at: string;
      tool: string;
      version: string;
      ok: boolean;
      latencyMs: number;
      result?: unknown;
      error?: string;
    }
  | {
      runId: string;
      step: number;
      type: 'retry';
      at: string;
      tool: string;
      attempt: number;
      error: string;
    }
  | { runId: string; step: number; type: 'checkpoint'; at: string }
  | {
      runId: string;
      step: number;
      type: 'run.finished';
      at: string;
      status: RunStatus;
      latencyMs: number;
      error?: string;
    };
