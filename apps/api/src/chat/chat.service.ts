import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { chat, type ChatCommandResult } from '@smriti/application';
import type {
  ChatModel,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  EmbeddingProvider,
  JobQueue,
  VectorStore,
} from '@smriti/domain';
import {
  PrismaAuditLogRepository,
  PrismaConversationRepository,
  PrismaMemoryIndexStateStore,
  PrismaMemoryRepository,
} from '@smriti/infrastructure';
import type {
  AppConfig,
  ChatRequestInput,
  CreateConversationInput,
  ListConversationMessagesQueryInput,
} from '@smriti/shared';
import { NotFoundError } from '@smriti/shared';
import { APP_CONFIG } from '../config/config.module.js';
import { EMBEDDING_PROVIDER, JOB_QUEUE, VECTOR_STORE } from '../memory/memory.tokens.js';
import { PRISMA_CLIENT } from '../prisma/prisma.module.js';
import { CHAT_MODEL } from './chat.tokens.js';

export interface ConversationDto {
  id: string;
  title: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageDto {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: string;
}

function toConversationDto(record: ConversationRecord): ConversationDto {
  return {
    id: record.id,
    title: record.title,
    metadata: record.metadata,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

function toMessageDto(record: ConversationMessageRecord): ConversationMessageDto {
  return {
    id: record.id,
    conversationId: record.conversationId,
    role: record.role,
    content: record.content,
    createdAt: record.createdAt.toISOString(),
  };
}

@Injectable()
export class ChatService {
  private readonly conversationRepository: ConversationRepository;
  private readonly memoryRepository: PrismaMemoryRepository;
  private readonly auditLogRepository: PrismaAuditLogRepository;
  private readonly indexStateStore: PrismaMemoryIndexStateStore;

  constructor(
    @Inject(PRISMA_CLIENT) prisma: PrismaClient,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddingProvider: EmbeddingProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    @Inject(JOB_QUEUE) private readonly jobQueue: JobQueue,
    @Inject(CHAT_MODEL) private readonly chatModel: ChatModel,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.conversationRepository = new PrismaConversationRepository(prisma);
    this.memoryRepository = new PrismaMemoryRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
    this.indexStateStore = new PrismaMemoryIndexStateStore(prisma);
  }

  async createConversation(
    userId: string,
    input: CreateConversationInput,
  ): Promise<ConversationDto> {
    const conversation = await this.conversationRepository.createConversation(
      userId,
      input.title ?? null,
    );
    return toConversationDto(conversation);
  }

  async listMessages(
    userId: string,
    conversationId: string,
    query: ListConversationMessagesQueryInput,
  ): Promise<{ conversationId: string; items: ConversationMessageDto[] }> {
    const conversation = await this.conversationRepository.findConversation(userId, conversationId);
    if (!conversation) {
      throw new NotFoundError('Conversation', conversationId);
    }
    const messages = await this.conversationRepository.listMessages(conversationId, query.limit);
    return { conversationId, items: messages.map(toMessageDto) };
  }

  send(userId: string, correlationId: string, input: ChatRequestInput): Promise<ChatCommandResult> {
    return chat(
      {
        conversationRepository: this.conversationRepository,
        chatModel: this.chatModel,
        memoryRepository: this.memoryRepository,
        auditLogRepository: this.auditLogRepository,
        jobQueue: this.jobQueue,
        indexStateStore: this.indexStateStore,
        embeddingProvider: this.embeddingProvider,
        vectorStore: this.vectorStore,
        dedupThreshold: this.config.DEDUP_SIMILARITY_THRESHOLD,
        searchTimeoutMs: this.config.DEDUP_TIMEOUT_MS,
      },
      {
        userId,
        correlationId,
        conversationId: input.conversationId,
        message: input.message,
      },
    );
  }
}
