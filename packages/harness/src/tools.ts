import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { Tool, ToolContext, ToolRegistry } from './types.js';

export function defineTool<T>(tool: {
  name: string;
  version: string;
  schema: z.ZodType<T>;
  execute(args: T, ctx: ToolContext): Promise<unknown>;
}): Tool {
  return {
    name: tool.name,
    version: tool.version,
    schema: tool.schema,
    execute: (args, ctx) => tool.execute(args as T, ctx),
  };
}

export function createRegistry(tools: Tool[]): ToolRegistry {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return {
    get(name: string) {
      return byName.get(name);
    },
  };
}

export function idempotencyKey(name: string, args: unknown): string {
  const digest = createHash('sha256')
    .update(`${name}:${stableStringify(args)}`)
    .digest('hex');
  return digest.slice(0, 16);
}

export function callSignature(name: string, args: unknown): string {
  return `${name}:${stableStringify(args)}`;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
