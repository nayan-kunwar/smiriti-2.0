import { createHash, randomUUID } from 'node:crypto';
import { ValidationError } from '@smriti/shared';

export type MemoryType = 'long_term' | 'semantic';

export type IndexingStatus = 'pending' | 'indexed' | 'failed' | 'not_applicable';

export interface MemoryProps {
  id: string;
  userId: string;
  type: MemoryType;
  content: string;
  category: string | null;
  tags: string[];
  importance: number;
  confidence: number;
  isPinned: boolean;
  isArchived: boolean;
  conversationId: string | null;
  contentHash: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateMemoryParams {
  userId: string;
  type: MemoryType;
  content: string;
  category?: string | null;
  tags?: string[];
  importance?: number;
  confidence?: number;
  conversationId?: string | null;
}

export interface UpdateMemoryParams {
  type?: MemoryType;
  content?: string;
  category?: string | null;
  tags?: string[];
  importance?: number;
  confidence?: number;
  isPinned?: boolean;
  isArchived?: boolean;
  conversationId?: string | null;
}

export function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export class Memory {
  private constructor(private props: MemoryProps) {}

  static create(params: CreateMemoryParams): Memory {
    const content = params.content.trim();
    if (!content) {
      throw new ValidationError('Memory content cannot be empty');
    }

    const now = new Date();
    return new Memory({
      id: randomUUID(),
      userId: params.userId,
      type: params.type,
      content,
      category: params.category ?? null,
      tags: params.tags ?? [],
      importance: params.importance ?? 0.5,
      confidence: params.confidence ?? 0.8,
      isPinned: false,
      isArchived: false,
      conversationId: params.conversationId ?? null,
      contentHash: computeContentHash(content),
      createdAt: now,
      updatedAt: now,
    });
  }

  static reconstitute(props: MemoryProps): Memory {
    return new Memory({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get userId(): string {
    return this.props.userId;
  }

  get type(): MemoryType {
    return this.props.type;
  }

  get content(): string {
    return this.props.content;
  }

  get category(): string | null {
    return this.props.category;
  }

  get tags(): string[] {
    return [...this.props.tags];
  }

  get importance(): number {
    return this.props.importance;
  }

  get confidence(): number {
    return this.props.confidence;
  }

  get isPinned(): boolean {
    return this.props.isPinned;
  }

  get isArchived(): boolean {
    return this.props.isArchived;
  }

  get conversationId(): string | null {
    return this.props.conversationId;
  }

  get contentHash(): string {
    return this.props.contentHash;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  update(params: UpdateMemoryParams): void {
    if (params.isPinned === true && params.isArchived === true) {
      throw new ValidationError('A memory cannot be both pinned and archived');
    }
    if (this.props.isPinned && params.isArchived === true) {
      throw new ValidationError('A memory cannot be both pinned and archived');
    }
    if (this.props.isArchived && params.isPinned === true) {
      throw new ValidationError('A memory cannot be both pinned and archived');
    }

    if (params.type !== undefined) this.props.type = params.type;
    if (params.category !== undefined) this.props.category = params.category;
    if (params.tags !== undefined) this.props.tags = [...params.tags];
    if (params.importance !== undefined) this.props.importance = params.importance;
    if (params.confidence !== undefined) this.props.confidence = params.confidence;
    if (params.isPinned !== undefined) this.props.isPinned = params.isPinned;
    if (params.isArchived !== undefined) this.props.isArchived = params.isArchived;
    if (params.conversationId !== undefined) this.props.conversationId = params.conversationId;

    if (params.content !== undefined) {
      const content = params.content.trim();
      if (!content) {
        throw new ValidationError('Memory content cannot be empty');
      }
      this.props.content = content;
      this.props.contentHash = computeContentHash(content);
    }

    this.props.updatedAt = new Date();
  }

  toProps(): MemoryProps {
    return { ...this.props, tags: [...this.props.tags] };
  }
}
