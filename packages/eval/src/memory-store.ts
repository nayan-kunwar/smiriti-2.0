import { randomUUID } from 'node:crypto';

export interface StoredMemory {
  id: string;
  content: string;
  type: 'long_term' | 'semantic';
  tags: string[];
}

export interface MemoryDraft {
  content: string;
  type: 'long_term' | 'semantic';
  tags?: string[];
}

export class MemoryStore {
  private readonly memories: StoredMemory[] = [];
  private readonly byKey = new Map<string, StoredMemory>();

  constructor(fixtures: MemoryDraft[] = []) {
    for (const fixture of fixtures) {
      this.insert(fixture, fixture.content);
    }
  }

  create(draft: MemoryDraft, idempotencyKey: string): { memory: StoredMemory; created: boolean } {
    const contentKey = draft.content;
    const existing = this.byKey.get(idempotencyKey) ?? this.byKey.get(contentKey);
    if (existing) return { memory: existing, created: false };
    return { memory: this.insert(draft, idempotencyKey), created: true };
  }

  search(query: string): StoredMemory[] {
    const needle = query.toLowerCase();
    return this.memories.filter((memory) => memory.content.toLowerCase().includes(needle));
  }

  list(): StoredMemory[] {
    return [...this.memories];
  }

  private insert(draft: MemoryDraft, idempotencyKey: string): StoredMemory {
    const memory: StoredMemory = {
      id: randomUUID(),
      content: draft.content,
      type: draft.type,
      tags: draft.tags ?? [],
    };
    this.memories.push(memory);
    this.byKey.set(idempotencyKey, memory);
    this.byKey.set(draft.content, memory);
    return memory;
  }
}
