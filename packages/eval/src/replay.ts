import { readFile } from 'node:fs/promises';
import { createRegistry, parseJsonl } from '@smriti/harness';
import type { TraceEvent } from '@smriti/harness';
import { MemoryStore } from './memory-store.js';
import { memoryTools } from './memory-tools.js';

export async function replayTrace(file: string): Promise<unknown[]> {
  const text = await readFile(file, 'utf8');
  return replayEvents(parseJsonl(text));
}

export async function replayEvents(events: TraceEvent[]): Promise<unknown[]> {
  const store = new MemoryStore();
  const registry = createRegistry(memoryTools(store));
  const results: unknown[] = [];

  for (const event of events) {
    if (event.type !== 'tool.call') continue;
    const tool = registry.get(event.tool);
    if (!tool) {
      throw new Error(`unknown tool ${event.tool}`);
    }
    const parsed = tool.schema.safeParse(event.args);
    if (!parsed.success) {
      throw new Error(`schema validation failed for ${event.tool}`);
    }
    const result = await tool.execute(parsed.data, {
      idempotencyKey: event.idempotencyKey,
      signal: new AbortController().signal,
    });
    results.push({ tool: event.tool, result });
  }

  return results;
}
