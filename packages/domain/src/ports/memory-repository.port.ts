import type { Memory } from '../entities/memory.entity.js';

export interface ListMemoriesQuery {
  cursor?: string;
  limit: number;
  category?: string;
  tags?: string[];
  includeArchived?: boolean;
  isPinned?: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MemoryRepository {
  save(memory: Memory): Promise<void>;
  findById(userId: string, id: string): Promise<Memory | null>;
  findByUser(userId: string, query: ListMemoriesQuery): Promise<PaginatedResult<Memory>>;
  update(memory: Memory): Promise<void>;
  delete(userId: string, id: string): Promise<boolean>;
}
