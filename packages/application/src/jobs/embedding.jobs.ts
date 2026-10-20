import {
  chunkMemoryContent,
  qdrantPointId,
  type EmbeddingProvider,
  type MemoryEmbeddingStore,
  type MemoryIndexStateStore,
  type MemoryRepository,
  type VectorStore,
} from '@smriti/domain';

export interface EmbedAndIndexDeps {
  memoryRepository: MemoryRepository;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  embeddingStore: MemoryEmbeddingStore;
  indexStateStore?: MemoryIndexStateStore;
  embeddingProviderName: string;
}

export interface EmbedAndIndexPayload {
  memoryId: string;
  userId: string;
  contentHash: string;
  correlationId: string;
}

export async function handleEmbedAndIndex(
  deps: EmbedAndIndexDeps,
  payload: EmbedAndIndexPayload,
): Promise<void> {
  const memory = await deps.memoryRepository.findById(payload.userId, payload.memoryId);
  if (!memory) return;
  // Idempotency: skip if content changed since enqueue.
  if (memory.contentHash !== payload.contentHash) return;

  await deps.indexStateStore?.markPending(memory.id, memory.contentHash);

  const chunks = chunkMemoryContent(memory.content, deps.embeddingProvider.maxInputTokens);
  const vectors = await deps.embeddingProvider.embed(chunks.map((c) => c.text));

  await deps.vectorStore.upsert(
    chunks.map((c, i) => ({
      id: qdrantPointId(memory.id, c.index),
      vector: vectors[i],
      payload: {
        userId: memory.userId,
        memoryId: memory.id,
        chunkIndex: c.index,
        category: memory.category,
        tags: memory.tags,
        createdAt: memory.createdAt.toISOString(),
      },
    })),
  );

  // Content can shrink (or chunk boundaries move); drop points left over
  // from the previous version so search cannot return stale chunks.
  const expectedPointIds = new Set(chunks.map((c) => qdrantPointId(memory.id, c.index)));
  const existingPoints = await deps.vectorStore.listPointsByMemoryId(memory.id);
  await deps.vectorStore.deletePoints(
    existingPoints.filter((p) => !expectedPointIds.has(p.id)).map((p) => p.id),
  );

  await deps.embeddingStore.replaceForMemory(
    chunks.map((c, i) => ({
      memoryId: memory.id,
      chunkIndex: c.index,
      tokenCount: c.tokenCount,
      provider: deps.embeddingProviderName,
      model: deps.embeddingProvider.model,
      dimension: vectors[i].length,
      qdrantPointId: qdrantPointId(memory.id, c.index),
      status: 'indexed' as const,
    })),
  );

  await deps.indexStateStore?.markIndexed(memory.id, memory.contentHash);
}

export interface DeleteVectorsDeps {
  vectorStore: VectorStore;
  embeddingStore: MemoryEmbeddingStore;
}

export async function handleDeleteVectors(
  deps: DeleteVectorsDeps,
  payload: { memoryId: string },
): Promise<void> {
  await deps.vectorStore.deleteByMemoryId(payload.memoryId);
  await deps.embeddingStore.deleteForMemory(payload.memoryId);
}
