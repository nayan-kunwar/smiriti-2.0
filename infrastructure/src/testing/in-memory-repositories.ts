import { randomUUID } from 'node:crypto';
import { Memory, User } from '@smriti/domain';
import type {
  ApiKeyRecord,
  ApiKeyRepository,
  AuditLogEntry,
  AuditLogRecord,
  AuditLogRepository,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationRepository,
  ConversationRole,
  JobFailureEntry,
  JobFailureRecord,
  JobFailureRepository,
  ListAuditLogsQuery,
  ListJobFailuresQuery,
  ListMemoriesQuery,
  ListUsersQuery,
  MemoryRepository,
  PaginatedResult,
  RefreshTokenRecord,
  RefreshTokenRepository,
  UserRepository,
} from '@smriti/domain';

export class InMemoryMemoryRepository implements MemoryRepository {
  private store = new Map<string, Memory>();

  async save(memory: Memory): Promise<void> {
    this.store.set(memory.id, Memory.reconstitute(memory.toProps()));
  }

  async findById(userId: string, id: string): Promise<Memory | null> {
    const memory = this.store.get(id);
    if (!memory || memory.userId !== userId) return null;
    return Memory.reconstitute(memory.toProps());
  }

  async findByUser(userId: string, query: ListMemoriesQuery): Promise<PaginatedResult<Memory>> {
    let items = [...this.store.values()].filter((m) => m.userId === userId);

    if (!query.includeArchived) {
      items = items.filter((m) => !m.isArchived);
    }
    if (query.category) {
      items = items.filter((m) => m.category === query.category);
    }
    if (query.tags?.length) {
      items = items.filter((m) => query.tags!.every((t) => m.tags.includes(t)));
    }
    if (query.isPinned !== undefined) {
      items = items.filter((m) => m.isPinned === query.isPinned);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((m) => m.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor,
    };
  }

  async findAll(cursor: string | undefined, limit: number): Promise<PaginatedResult<Memory>> {
    const items = [...this.store.values()].sort((a, b) => a.id.localeCompare(b.id));

    let startIndex = 0;
    if (cursor) {
      const cursorIndex = items.findIndex((m) => m.id === cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((m) => Memory.reconstitute(m.toProps())),
      nextCursor,
    };
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

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryAuditLogRepository implements AuditLogRepository {
  readonly entries: AuditLogEntry[] = [];

  async append(entry: AuditLogEntry): Promise<void> {
    this.entries.push({ ...entry, payloadSnapshot: { ...entry.payloadSnapshot } });
  }

  async findAll(
    query: ListAuditLogsQuery,
  ): Promise<{ items: AuditLogRecord[]; nextCursor: string | null }> {
    let items = this.entries.map((entry, index) => ({
      id: `audit-${index}`,
      createdAt: new Date(),
      ...entry,
    }));

    if (query.userId) {
      items = items.filter((entry) => entry.userId === query.userId);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((entry) => entry.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return { items: page, nextCursor };
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export class InMemoryUserRepository implements UserRepository {
  private store = new Map<string, User>();

  async save(user: User): Promise<void> {
    this.store.set(user.id, User.reconstitute(user.toProps()));
  }

  async findByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    for (const user of this.store.values()) {
      if (user.email === normalized) return User.reconstitute(user.toProps());
    }
    return null;
  }

  async findById(id: string): Promise<User | null> {
    const user = this.store.get(id);
    return user ? User.reconstitute(user.toProps()) : null;
  }

  async findAll(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    const items = [...this.store.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((user) => user.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((user) => User.reconstitute(user.toProps())),
      nextCursor,
    };
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryRefreshTokenRepository implements RefreshTokenRepository {
  private store = new Map<string, RefreshTokenRecord>();

  async save(record: RefreshTokenRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByTokenHash(tokenHash: string): Promise<RefreshTokenRecord | null> {
    for (const record of this.store.values()) {
      if (record.tokenHash === tokenHash) return { ...record };
    }
    return null;
  }

  async revoke(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) {
      this.store.set(id, { ...record, revokedAt: new Date() });
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryConversationRepository implements ConversationRepository {
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
    return { ...record, metadata: { ...record.metadata } };
  }

  async findConversation(userId: string, id: string): Promise<ConversationRecord | null> {
    const record = this.conversations.get(id);
    if (!record || record.userId !== userId) return null;
    return { ...record, metadata: { ...record.metadata } };
  }

  async appendMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessageRecord> {
    if (!this.conversations.has(conversationId)) {
      throw new Error(`Conversation not found: ${conversationId}`);
    }
    const record: ConversationMessageRecord = {
      id: randomUUID(),
      conversationId,
      role,
      content,
      createdAt: new Date(),
    };
    this.messages.get(conversationId)!.push(record);
    const conversation = this.conversations.get(conversationId)!;
    conversation.updatedAt = new Date();
    return { ...record };
  }

  async listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]> {
    const messages = [...(this.messages.get(conversationId) ?? [])];
    const selected = limit ? messages.slice(-limit) : messages;
    return selected.map((message) => ({ ...message }));
  }

  clear(): void {
    this.conversations.clear();
    this.messages.clear();
  }
}

export class InMemoryApiKeyRepository implements ApiKeyRepository {
  private store = new Map<string, ApiKeyRecord>();

  async save(record: ApiKeyRecord): Promise<void> {
    this.store.set(record.id, { ...record });
  }

  async findByKeyHash(keyHash: string): Promise<ApiKeyRecord | null> {
    for (const record of this.store.values()) {
      if (record.keyHash === keyHash) return { ...record };
    }
    return null;
  }

  async findById(userId: string, id: string): Promise<ApiKeyRecord | null> {
    const record = this.store.get(id);
    if (!record || record.userId !== userId) return null;
    return { ...record };
  }

  async findByUser(userId: string): Promise<ApiKeyRecord[]> {
    return [...this.store.values()]
      .filter((record) => record.userId === userId)
      .map((record) => ({ ...record }));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const record = this.store.get(id);
    if (!record || record.userId !== userId) return false;
    return this.store.delete(id);
  }

  async updateLastUsed(id: string): Promise<void> {
    const record = this.store.get(id);
    if (record) {
      this.store.set(id, { ...record, lastUsedAt: new Date() });
    }
  }

  clear(): void {
    this.store.clear();
  }
}

export class InMemoryJobFailureRepository implements JobFailureRepository {
  private store = new Map<string, JobFailureRecord>();

  async record(entry: JobFailureEntry): Promise<JobFailureRecord> {
    const now = new Date();
    const record: JobFailureRecord = {
      ...entry,
      payload: { ...entry.payload },
      id: randomUUID(),
      status: 'open',
      retriedAt: null,
      retriedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.set(record.id, record);
    return { ...record, payload: { ...record.payload } };
  }

  async findAll(
    query: ListJobFailuresQuery,
  ): Promise<{ items: JobFailureRecord[]; nextCursor: string | null }> {
    let items = [...this.store.values()];
    if (query.status) {
      items = items.filter((entry) => entry.status === query.status);
    }
    if (query.jobName) {
      items = items.filter((entry) => entry.jobName === query.jobName);
    }

    items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));

    let startIndex = 0;
    if (query.cursor) {
      const cursorIndex = items.findIndex((entry) => entry.id === query.cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + query.limit);
    const nextCursor =
      startIndex + query.limit < items.length ? (page[page.length - 1]?.id ?? null) : null;

    return {
      items: page.map((entry) => ({ ...entry, payload: { ...entry.payload } })),
      nextCursor,
    };
  }

  async findById(id: string): Promise<JobFailureRecord | null> {
    const record = this.store.get(id);
    return record ? { ...record, payload: { ...record.payload } } : null;
  }

  async markRetried(
    id: string,
    retriedBy: string,
    retriedAt: Date,
  ): Promise<JobFailureRecord | null> {
    const record = this.store.get(id);
    if (!record || record.status !== 'open') return null;
    const updated: JobFailureRecord = {
      ...record,
      status: 'retried',
      retriedAt,
      retriedBy,
      updatedAt: retriedAt,
    };
    this.store.set(id, updated);
    return { ...updated, payload: { ...updated.payload } };
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (const [id, record] of this.store) {
      if (record.createdAt < cutoff) {
        this.store.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }

  clear(): void {
    this.store.clear();
  }
}
