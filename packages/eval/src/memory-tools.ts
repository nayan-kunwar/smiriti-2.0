import { z } from 'zod';
import { defineTool } from '@smriti/harness';
import type { Tool } from '@smriti/harness';
import type { MemoryStore } from './memory-store.js';

const CreateSchema = z.object({
  content: z.string().min(1),
  type: z.enum(['long_term', 'semantic']),
  tags: z.array(z.string()).optional(),
});

const SearchSchema = z.object({
  query: z.string().min(1),
});

const ListSchema = z.object({}).strict();

export function memoryTools(store: MemoryStore): Tool[] {
  return [
    defineTool({
      name: 'memory.create',
      version: '1',
      schema: CreateSchema,
      execute: async (args, ctx) => store.create(args, args.content || ctx.idempotencyKey),
    }),
    defineTool({
      name: 'memory.search',
      version: '1',
      schema: SearchSchema,
      execute: async (args) => ({ memories: store.search(args.query) }),
    }),
    defineTool({
      name: 'memory.list',
      version: '1',
      schema: ListSchema,
      execute: async () => ({ memories: store.list() }),
    }),
  ];
}
