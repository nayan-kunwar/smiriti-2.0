import { describe, expect, it } from 'vitest';
import { MemoryStore } from './memory-store.js';
import { memoryTools } from './memory-tools.js';

describe('memory tools', () => {
  it('creates once when the same content is retried', async () => {
    const store = new MemoryStore();
    const create = memoryTools(store).find((tool) => tool.name === 'memory.create');
    const args = { content: 'User lives in Pune.', type: 'semantic' as const };
    const ctx = { idempotencyKey: 'same', signal: new AbortController().signal };

    const first = await create?.execute(args, ctx);
    const second = await create?.execute(args, ctx);

    expect(store.list()).toHaveLength(1);
    expect(first).toMatchObject({ created: true });
    expect(second).toMatchObject({ created: false });
  });
});
