import type { EmbeddingProvider, MemoryRepository, VectorStore } from '@smriti/domain';
import { toMemoryDto, type MemoryDto } from '../mappers/memory.mapper.js';

export interface SearchMemoriesDeps {
  memoryRepository: MemoryRepository;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
}

export interface SearchMemoriesInput {
  userId: string;
  query: string;
  category?: string;
  tags?: string[];
  includeArchived?: boolean;
  from?: string;
  to?: string;
  limit: number;
}

export interface ScoredMemoryDto extends MemoryDto {
  score: number;
}

export async function searchMemories(
  deps: SearchMemoriesDeps,
  input: SearchMemoriesInput,
): Promise<{ items: ScoredMemoryDto[]; cursor: string | null }> {
  const [queryVector] = await deps.embeddingProvider.embed([input.query]);

  const hits = await deps.vectorStore.search({
    vector: queryVector,
    filter: {
      userId: input.userId,
      category: input.category,
      tags: input.tags,
      from: input.from ? new Date(input.from) : undefined,
      to: input.to ? new Date(input.to) : undefined,
      includeArchived: input.includeArchived,
    },
    limit: Math.min(input.limit * 3, 50),
  });

  // Dedupe chunk hits to parent memory, keep best score.
  const bestByMemory = new Map<string, number>();
  for (const h of hits) {
    const prev = bestByMemory.get(h.memoryId);
    if (prev === undefined || h.score > prev) bestByMemory.set(h.memoryId, h.score);
  }
  const ranked = [...bestByMemory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, input.limit);

  const items: ScoredMemoryDto[] = [];
  for (const [memoryId, score] of ranked) {
    const memory = await deps.memoryRepository.findById(input.userId, memoryId);
    if (!memory) continue;
    if (!input.includeArchived && memory.isArchived) continue;
    if (input.category && memory.category !== input.category) continue;
    if (input.tags?.length && !input.tags.every((t) => memory.tags.includes(t))) continue;
    items.push({ ...toMemoryDto(memory, 'indexed'), score });
  }

  return { items, cursor: null };
}
