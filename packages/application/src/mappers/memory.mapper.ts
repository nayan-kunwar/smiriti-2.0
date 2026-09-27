import type { Memory, IndexingStatus } from '@smriti/domain';

export interface MemoryDto {
  id: string;
  userId: string;
  type: string;
  content: string;
  category: string | null;
  tags: string[];
  importance: number;
  confidence: number;
  isPinned: boolean;
  isArchived: boolean;
  conversationId: string | null;
  indexingStatus: IndexingStatus;
  createdAt: string;
  updatedAt: string;
}

export function toMemoryDto(memory: Memory, indexingStatus: IndexingStatus = 'not_applicable'): MemoryDto {
  return {
    id: memory.id,
    userId: memory.userId,
    type: memory.type,
    content: memory.content,
    category: memory.category,
    tags: memory.tags,
    importance: memory.importance,
    confidence: memory.confidence,
    isPinned: memory.isPinned,
    isArchived: memory.isArchived,
    conversationId: memory.conversationId,
    indexingStatus,
    createdAt: memory.createdAt.toISOString(),
    updatedAt: memory.updatedAt.toISOString(),
  };
}
