import { z } from 'zod';

export const MemoryTypeSchema = z.enum(['long_term', 'semantic']);

export const CreateMemorySchema = z.object({
  type: MemoryTypeSchema,
  content: z.string().min(1).max(100_000),
  category: z.string().max(128).optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  conversationId: z.string().uuid().optional(),
});

export const UpdateMemorySchema = z
  .object({
    type: MemoryTypeSchema.optional(),
    content: z.string().min(1).max(100_000).optional(),
    category: z.string().max(128).nullable().optional(),
    tags: z.array(z.string().max(64)).max(50).optional(),
    importance: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    isPinned: z.boolean().optional(),
    isArchived: z.boolean().optional(),
    conversationId: z.string().uuid().nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export const ListMemoriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  category: z.string().optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => val === true || val === 'true'),
  isPinned: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => (val === undefined ? undefined : val === true || val === 'true')),
});

export const SearchMemoriesSchema = z.object({
  query: z.string().min(1).max(2000),
  category: z.string().optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((val) => (val === undefined ? undefined : Array.isArray(val) ? val : [val])),
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((val) => val === true || val === 'true'),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  cursor: z.string().optional(),
});

export type CreateMemoryInput = z.infer<typeof CreateMemorySchema>;
export type UpdateMemoryInput = z.infer<typeof UpdateMemorySchema>;
export type ListMemoriesQueryInput = z.infer<typeof ListMemoriesQuerySchema>;
export type SearchMemoriesInput = z.infer<typeof SearchMemoriesSchema>;
