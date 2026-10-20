import type {
  IndexingStatus,
  Memory,
  MemoryIndexStateRecord,
  MemoryIndexStateStore,
} from '@smriti/domain';

/**
 * Derives the API-facing indexing status from the durable index state.
 *
 * A state row only counts when its content hash matches the memory: a stale
 * row describes an older version of the content and must be re-indexed.
 */
export function resolveIndexingStatus(
  memory: Memory,
  state: MemoryIndexStateRecord | undefined,
  indexingEnabled: boolean,
): IndexingStatus {
  if (!indexingEnabled) return 'not_applicable';
  if (!state) return 'pending';
  if (state.contentHash !== memory.contentHash) return 'pending';
  return state.status;
}

export async function resolveIndexingStatuses(
  store: MemoryIndexStateStore | undefined,
  memories: Memory[],
  indexingEnabled: boolean,
): Promise<Map<string, IndexingStatus>> {
  const statuses = new Map<string, IndexingStatus>();
  if (!indexingEnabled) {
    for (const memory of memories) statuses.set(memory.id, 'not_applicable');
    return statuses;
  }
  if (memories.length === 0) return statuses;

  const states = store ? await store.findByMemoryIds(memories.map((m) => m.id)) : new Map();
  for (const memory of memories) {
    statuses.set(memory.id, resolveIndexingStatus(memory, states.get(memory.id), true));
  }
  return statuses;
}
