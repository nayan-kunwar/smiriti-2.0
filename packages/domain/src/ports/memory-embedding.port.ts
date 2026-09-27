export type EmbeddingStatus = 'pending' | 'indexed' | 'failed';

export interface MemoryEmbeddingRecord {
  memoryId: string;
  chunkIndex: number;
  tokenCount: number;
  provider: string;
  model: string;
  dimension: number;
  qdrantPointId: string;
  status: EmbeddingStatus;
}

export interface MemoryEmbeddingStore {
  replaceForMemory(record: MemoryEmbeddingRecord[]): Promise<void>;
  markStatus(memoryId: string, status: EmbeddingStatus): Promise<void>;
  deleteForMemory(memoryId: string): Promise<void>;
}
