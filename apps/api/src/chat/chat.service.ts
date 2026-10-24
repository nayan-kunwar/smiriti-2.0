import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import {
  chat,
  retryChatTurn,
  type ChatCommandResult,
  type ChatCommandDeps,
} from '@smriti/application';
import type {
  ChatModel,
  ChatTurnRecord,
  ChatTurnResultSnapshot,
  ChatTurnStatus,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  EmbeddingProvider,
  JobQueue,
  VectorStore,
} from '@smriti/domain';
import {
  Metrics,
  PrismaAuditLogRepository,
  PrismaChatTurnRepository,
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
import { ChatTurnFailedError, ConflictError, NotFoundError } from '@smriti/shared';
import { APP_CONFIG } from '../config/config.module.js';
import { METRICS } from '../metrics/metrics.constants.js';
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

export interface ChatTurnDto {
  turnId: string;
  conversationId: string;
  status: ChatTurnStatus;
  attempts: number;
  error: { code: string; message: string } | null;
  result: ChatTurnResultSnapshot | null;
  createdAt: string;
  updatedAt: string;
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

function toTurnDto(record: ChatTurnRecord): ChatTurnDto {
  return {
    turnId: record.id,
    conversationId: record.conversationId,
    status: record.status,
    attempts: record.attempts,
    error: record.errorCode
      ? {
          code: record.errorCode,
          message:
            'The chat turn failed. Retry it with POST /v1/chat/turns/{turnId}/retry or inspect the server logs with the correlation ID.',
        }
      : null,
    result: record.resultSnapshot,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

@Injectable()
export class ChatService {
  private readonly conversationRepository: ConversationRepository;
  private readonly chatTurnRepository: PrismaChatTurnRepository;
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
    @Inject(METRICS) private readonly metrics: Metrics,
  ) {
    this.conversationRepository = new PrismaConversationRepository(prisma);
    this.chatTurnRepository = new PrismaChatTurnRepository(prisma);
    this.memoryRepository = new PrismaMemoryRepository(prisma);
    this.auditLogRepository = new PrismaAuditLogRepository(prisma);
    this.indexStateStore = new PrismaMemoryIndexStateStore(prisma);
  }

  private commandDeps(): ChatCommandDeps {
    return {
      conversationRepository: this.conversationRepository,
      chatTurnRepository: this.chatTurnRepository,
      chatModel: this.chatModel,
      memoryRepository: this.memoryRepository,
      auditLogRepository: this.auditLogRepository,
      jobQueue: this.jobQueue,
      indexStateStore: this.indexStateStore,
      embeddingProvider: this.embeddingProvider,
      vectorStore: this.vectorStore,
      dedupThreshold: this.config.DEDUP_SIMILARITY_THRESHOLD,
      searchTimeoutMs: this.config.DEDUP_TIMEOUT_MS,
      turnLockTimeoutMs: this.config.CHAT_TURN_LOCK_TIMEOUT_MS,
      turnMaxAttempts: this.config.CHAT_TURN_MAX_ATTEMPTS,
    };
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

  async send(
    userId: string,
    correlationId: string,
    input: ChatRequestInput,
    idempotencyKey?: string,
  ): Promise<ChatCommandResult> {
    const startedAt = Date.now();
    try {
      const result = await chat(this.commandDeps(), {
        userId,
        correlationId,
        conversationId: input.conversationId,
        message: input.message,
        idempotencyKey,
      });
      this.metrics.observeChatTurn('completed', (Date.now() - startedAt) / 1000);
      return result;
    } catch (err) {
      if (err instanceof ChatTurnFailedError) {
        this.metrics.observeChatTurn('failed', (Date.now() - startedAt) / 1000);
      }
      throw err;
    }
  }

  async retryTurn(
    userId: string,
    turnId: string,
    correlationId: string,
  ): Promise<ChatCommandResult> {
    const startedAt = Date.now();
    try {
      const { result, replayed } = await retryChatTurn(this.commandDeps(), {
        userId,
        turnId,
        correlationId,
      });
      this.metrics.observeChatTurnRetry(replayed ? 'replayed' : 'completed');
      if (!replayed) {
        this.metrics.observeChatTurn('completed', (Date.now() - startedAt) / 1000);
      }
      return result;
    } catch (err) {
      if (err instanceof ChatTurnFailedError) {
        this.metrics.observeChatTurn('failed', (Date.now() - startedAt) / 1000);
        this.metrics.observeChatTurnRetry('failed');
      } else if (err instanceof ConflictError) {
        this.metrics.observeChatTurnRetry('conflict');
      }
      throw err;
    }
  }

  async getTurn(userId: string, turnId: string): Promise<ChatTurnDto> {
    const turn = await this.chatTurnRepository.findById(userId, turnId);
    if (!turn) {
      throw new NotFoundError('Chat turn', turnId);
    }
    return toTurnDto(turn);
  }
}
