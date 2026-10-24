import type {
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  ConversationRole,
} from '@smriti/domain';
import type {
  Conversation as PrismaConversation,
  ConversationMessage as PrismaConversationMessage,
  PrismaClient,
} from '@prisma/client';

function toConversation(record: PrismaConversation): ConversationRecord {
  return {
    id: record.id,
    userId: record.userId,
    title: record.title,
    metadata: (record.metadata ?? {}) as Record<string, unknown>,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function toMessage(record: PrismaConversationMessage): ConversationMessageRecord {
  return {
    id: record.id,
    conversationId: record.conversationId,
    turnId: record.turnId,
    role: record.role as ConversationRole,
    content: record.content,
    createdAt: record.createdAt,
  };
}

export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createConversation(userId: string, title: string | null): Promise<ConversationRecord> {
    const record = await this.prisma.conversation.create({
      data: { userId, title },
    });
    return toConversation(record);
  }

  async findConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const record = await this.prisma.conversation.findFirst({
      where: { id, userId },
    });
    return record ? toConversation(record) : null;
  }

  async appendMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
    turnId?: string,
  ): Promise<ConversationMessageRecord> {
    const [message] = await this.prisma.$transaction([
      this.prisma.conversationMessage.create({
        data: { conversationId, role, content, turnId: turnId ?? null },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return toMessage(message);
  }

  async listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]> {
    const records = await this.prisma.conversationMessage.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(limit ? { take: limit } : {}),
    });
    return records.map(toMessage).reverse();
  }

  async listMessagesForContext(
    conversationId: string,
    excludeTurnId: string | null,
    limit?: number,
  ): Promise<ConversationMessageRecord[]> {
    const records = await this.prisma.conversationMessage.findMany({
      where: {
        conversationId,
        ...(excludeTurnId ? { OR: [{ turnId: null }, { turnId: { not: excludeTurnId } }] } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(limit ? { take: limit } : {}),
    });
    return records.map(toMessage).reverse();
  }
}
