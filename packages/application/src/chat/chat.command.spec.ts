import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  Memory,
  type AuditLogEntry,
  type AuditLogRepository,
  type ChatMessage,
  type ChatModel,
  type ConversationMessageRecord,
  type ConversationRecord,
  type ConversationRepository,
  type ConversationRole,
  type EmbeddingProvider,
  type ListMemoriesQuery,
  type MemoryRepository,
  type PaginatedResult,
  type VectorPoint,
  type VectorPointRef,
  type VectorScanPage,
  type VectorSearchParams,
  type VectorSearchResult,
  type VectorStore,
} from '@smriti/domain';
import { chat } from './chat.command.js';

class InMemoryMemoryRepository implements MemoryRepository {
  private readonly store = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.store.get(id);
    return memory && memory.userId === userId ? Memory.reconstitute(memory.toProps()) : null;
  }

  async findByUser(userId: string, _query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    return {
      items: [...this.store.values()].filter((memory) => memory.userId === userId),
      nextCursor: null,
    };
  }

  async findAll(cursor: string | undefined, limit: number): Promise<PaginatedResult<Memory>> {
    const items = [...this.store.values()];
    const start = cursor ? items.findIndex((memory) => memory.id === cursor) + 1 : 0;
    return { items: items.slice(start, start + limit), nextCursor: null };
  }

  async existsByIds(ids: string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.store.has(id)));
  }

  async update(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return false;
    return this.store.delete(id);
  }
}

class InMemoryConversationRepository implements ConversationRepository {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, ConversationMessageRecord[]>();

  async createConversation(userId: string, title: string | null): Promise<ConversationRecord> {
    const now = new Date();
    const record: ConversationRecord = {
      id: randomUUID(),
      userId,
      title,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.conversations.set(record.id, record);
    this.messages.set(record.id, []);
    return record;
  }

  async findConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const record = this.conversations.get(id);
    return record && record.userId === userId ? record : null;
  }

  async appendMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessageRecord> {
    const record: ConversationMessageRecord = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: new Date(),
    };
    this.messages.get(conversationId)!.push(record);
    return record;
  }

  async listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]> {
    const messages = this.messages.get(conversationId) ?? [];
    return limit ? messages.slice(-limit) : [...messages];
  }
}

class FakeAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];
  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push(entry);
  }
  async findAll() {
    return { items: [], nextCursor: null };
  }
}

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly model = 'fake-embed';
  readonly dimension = 3;
  readonly maxInputTokens = 1000;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

class FakeVectorStore implements VectorStore {
  results: VectorSearchResult[] = [];

  async upsert(_points: VectorPoint[]): Promise<void> {}
  async deleteByMemoryId(_memoryId: string): Promise<void> {}
  async deletePoints(_ids: string[]): Promise<void> {}
  async listPointsByMemoryId(_memoryId: string): Promise<VectorPointRef[]> {
    return [];
  }
  async scanPoints(): Promise<VectorScanPage> {
    return { points: [], nextCursor: null };
  }
  async search(_params: VectorSearchParams): Promise<VectorSearchResult[]> {
    return this.results;
  }
  async ensureCollection(): Promise<void> {}
}

class FakeChatModel implements ChatModel {
  readonly model = 'fake-chat';
  readonly calls: ChatMessage[][] = [];
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    this.calls.push(messages);
    const response = this.responses.shift();
    if (response === undefined) throw new Error('no scripted chat response');
    return response;
  }
}

function deps(
  chatModel: ChatModel,
  memoryRepository: MemoryRepository,
  vectorStore: VectorStore,
  conversationRepository: ConversationRepository,
) {
  return {
    conversationRepository,
    chatModel,
    memoryRepository,
    auditLogRepository: new FakeAuditLogRepository(),
    embeddingProvider: new FakeEmbeddingProvider(),
    vectorStore,
    dedupThreshold: 0.92,
  };
}

describe('chat command', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const correlationId = 'corr-chat';

  it('stores extracted memories and persists both conversation messages', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const conversationRepository = new InMemoryConversationRepository();
    const vectorStore = new FakeVectorStore();
    const model = new FakeChatModel([
      '{"intent":"remember","memories":[{"content":"I live in NYC","type":"long_term","confidence":0.9}]}',
      'Got it — I will remember that you live in NYC.',
    ]);

    const result = await chat(deps(model, memoryRepository, vectorStore, conversationRepository), {
      userId,
      correlationId,
      message: 'Remember that I live in NYC',
    });

    expect(result.memoriesCreated).toHaveLength(1);
    expect(result.duplicateWarnings).toEqual([]);
    expect(result.message).toContain('NYC');
    expect(await memoryRepository.findByUser(userId, {} as ListMemoriesQuery)).toMatchObject({
      items: [{ content: 'I live in NYC' }],
    });
    const messages = await conversationRepository.listMessages(result.conversationId);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(model.calls[1][0].content).toContain('I live in NYC');
  });

  it('skips persisting a duplicate and reports the existing memory', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I live in NYC',
    });
    await memoryRepository.save(existing);

    const conversationRepository = new InMemoryConversationRepository();
    const vectorStore = new FakeVectorStore();
    vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.98 }];
    const model = new FakeChatModel([
      '{"intent":"remember","memories":[{"content":"I live in NYC","type":"long_term","confidence":0.9}]}',
      'I already knew that you live in NYC.',
    ]);

    const result = await chat(deps(model, memoryRepository, vectorStore, conversationRepository), {
      userId,
      correlationId,
      message: 'Remember that I live in NYC',
    });

    expect(result.memoriesCreated).toEqual([]);
    expect(result.duplicateWarnings).toEqual([{ existingMemoryId: existing.id, similarity: 0.98 }]);
    const listed = await memoryRepository.findByUser(userId, {} as ListMemoriesQuery);
    expect(listed.items).toHaveLength(1);
  });

  it('retrieves memories for recall and returns their ids', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I live in Paris',
    });
    await memoryRepository.save(existing);

    const conversationRepository = new InMemoryConversationRepository();
    const vectorStore = new FakeVectorStore();
    vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.93 }];
    const model = new FakeChatModel(['{"intent":"recall","memories":[]}', 'You live in Paris.']);

    const result = await chat(deps(model, memoryRepository, vectorStore, conversationRepository), {
      userId,
      correlationId,
      message: 'Where do I live?',
    });

    expect(result.memoriesRetrieved).toEqual([existing.id]);
    expect(result.message).toContain('Paris');
    expect(model.calls[1][0].content).toContain('<retrieved_memories>');
    expect(model.calls[1][0].content).toContain('I live in Paris');
  });

  it('treats a personal question classified as general as recall', async () => {
    const memoryRepository = new InMemoryMemoryRepository();
    const existing = Memory.create({
      userId,
      type: 'long_term',
      content: 'I work as a marine biologist',
    });
    await memoryRepository.save(existing);

    const conversationRepository = new InMemoryConversationRepository();
    const vectorStore = new FakeVectorStore();
    vectorStore.results = [{ id: 'point-0', memoryId: existing.id, chunkIndex: 0, score: 0.91 }];
    const model = new FakeChatModel([
      '{"intent":"general","memories":[]}',
      'You work as a marine biologist.',
    ]);

    const result = await chat(deps(model, memoryRepository, vectorStore, conversationRepository), {
      userId,
      correlationId,
      message: 'What is my job?',
    });

    expect(result.memoriesRetrieved).toEqual([existing.id]);
    expect(model.calls[1][0].content).toContain('I work as a marine biologist');
  });
});
