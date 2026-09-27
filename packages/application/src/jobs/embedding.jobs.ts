import {
  chunkMemoryContent,
  qdrantPointId,
  type EmbeddingProvider,
  type MemoryEmbeddingStore,
  type MemoryRepository,
  type VectorStore,
} from '@smriti/domain';

export interface EmbedAndIndexDeps {
  memoryRepository: MemoryRepository;
  embeddingProvider: EmbeddingProvider;
  vectorStore: VectorStore;
  embeddingStore: MemoryEmbeddingStore;
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

  const chunks = chunkMemoryContent(memory.content);
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
