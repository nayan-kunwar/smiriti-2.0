import type { MemoryIndexStateRecord, MemoryIndexStateStore } from '@smriti/domain';

export class InMemoryMemoryIndexStateStore implements MemoryIndexStateStore {
  readonly states = new Map<string, MemoryIndexStateRecord>();

  async markPending(memoryId: string, contentHash: string): Promise<void> {
    this.states.set(memoryId, {
      memoryId,
      contentHash,
      status: 'pending',
      error: null,
      updatedAt: new Date(),
    });
  }

  async markIndexed(memoryId: string, contentHash: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (!state) {
      this.states.set(memoryId, {
        memoryId,
        contentHash,
        status: 'indexed',
        error: null,
        updatedAt: new Date(),
      });
      return;
    }
    if (state.contentHash !== contentHash) return;
    this.states.set(memoryId, {
      ...state,
      status: 'indexed',
      error: null,
      updatedAt: new Date(),
    });
  }

  async markFailed(memoryId: string, contentHash: string, error: string): Promise<void> {
    const state = this.states.get(memoryId);
    if (!state) {
      this.states.set(memoryId, {
        memoryId,
        contentHash,
        status: 'failed',
        error,
        updatedAt: new Date(),
      });
      return;
    }
    if (state.contentHash !== contentHash) return;
    this.states.set(memoryId, {
      ...state,
      status: 'failed',
      error,
      updatedAt: new Date(),
    });
  }

  async findByMemoryIds(memoryIds: string[]): Promise<Map<string, MemoryIndexStateRecord>> {
    const result = new Map<string, MemoryIndexStateRecord>();
    for (const id of memoryIds) {
      const state = this.states.get(id);
      if (state) result.set(id, { ...state });
    }
    return result;
  }

  clear(): void {
    this.states.clear();
  }
}
