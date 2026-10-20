import type { EmbeddingStatus } from './memory-embedding.port.js';

export interface MemoryIndexStateRecord {
  memoryId: string;
  contentHash: string;
  status: EmbeddingStatus;
  error: string | null;
  updatedAt: Date;
}

export interface MemoryIndexStateStore {
  markPending(memoryId: string, contentHash: string): Promise<void>;
  markIndexed(memoryId: string, contentHash: string): Promise<void>;
  markFailed(memoryId: string, contentHash: string, error: string): Promise<void>;
  findByMemoryIds(memoryIds: string[]): Promise<Map<string, MemoryIndexStateRecord>>;
}
