import { Memory, type MemoryType } from '@smriti/domain';
import type { ListMemoriesQuery, MemoryRepository, PaginatedResult } from '@smriti/domain';
import type { Memory as PrismaMemory, PrismaClient } from '@prisma/client';

function toDomain(record: PrismaMemory): Memory {
  return Memory.reconstitute({
    id: record.id,
    userId: record.userId,
    type: record.type as MemoryType,
    content: record.content,
    category: record.category,
    tags: record.tags,
    importance: record.importance,
    confidence: record.confidence,
    isPinned: record.isPinned,
    isArchived: record.isArchived,
    conversationId: record.conversationId,
    contentHash: record.contentHash,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export class PrismaMemoryRepository implements MemoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(memory: Memory): Promise<void> {
    const props = memory.toProps();
    await this.prisma.memory.create({
      data: {
        id: props.id,
        userId: props.userId,
        type: props.type,
        content: props.content,
        category: props.category,
        tags: props.tags,
        importance: props.importance,
        confidence: props.confidence,
        isPinned: props.isPinned,
        isArchived: props.isArchived,
        conversationId: props.conversationId,
        contentHash: props.contentHash,
        createdAt: props.createdAt,
        updatedAt: props.updatedAt,
      },
    });
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const record = await this.prisma.memory.findFirst({
      where: { id, userId },
    });
    return record ? toDomain(record) : null;
  }

  async findByUser(userId: string, query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    const where: Record<string, unknown> = { userId };

    if (!query.includeArchived) {
      where.isArchived = false;
    }
    if (query.category) {
      where.category = query.category;
    }
    if (query.tags?.length) {
      where.tags = { hasEvery: query.tags };
    }
    if (query.isPinned !== undefined) {
      where.isPinned = query.isPinned;
    }

    const take = query.limit + 1;
    const records = await this.prisma.memory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;

    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  async update(memory: Memory): Promise<void> {
    const props = memory.toProps();
    await this.prisma.memory.update({
      where: { id: props.id },
      data: {
        type: props.type,
        content: props.content,
        category: props.category,
        tags: props.tags,
        importance: props.importance,
        confidence: props.confidence,
        isPinned: props.isPinned,
        isArchived: props.isArchived,
        conversationId: props.conversationId,
        contentHash: props.contentHash,
        updatedAt: props.updatedAt,
      },
    });
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.prisma.memory.deleteMany({
      where: { id, userId },
    });
    return result.count > 0;
  }
}
