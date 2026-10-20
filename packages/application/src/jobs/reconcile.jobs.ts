import {
  chunkMemoryContent,
  EMBED_AND_INDEX_JOB,
  qdrantPointId,
  type JobQueue,
  type Memory,
  type MemoryIndexStateRecord,
  type MemoryIndexStateStore,
  type MemoryRepository,
  type VectorStore,
} from '@smriti/domain';

export interface ReconcileVectorsDeps {
  memoryRepository: MemoryRepository;
  indexStateStore: MemoryIndexStateStore;
  vectorStore: VectorStore;
  jobQueue: JobQueue;
  batchSize?: number;
  scanPageSize?: number;
  maxEnqueue?: number;
  maxChunkTokens?: number;
  correlationId?: string;
}

export interface ReconcileVectorsSummary {
  memoriesScanned: number;
  pointsScanned: number;
  enqueued: number;
  orphanPointsDeleted: number;
}

export const DEFAULT_RECONCILE_BATCH_SIZE = 100;
export const DEFAULT_RECONCILE_SCAN_PAGE_SIZE = 256;
export const DEFAULT_RECONCILE_MAX_ENQUEUE = 500;

/**
 * Repairs drift between Postgres, the index-state table, and Qdrant.
 *
 * - Memories with no state, a stale content hash, or a non-indexed state are
 *   re-enqueued (forced, so a previously exhausted BullMQ job ID can run again).
 * - Indexed memories whose Qdrant point set does not match their current
 *   chunks are re-enqueued; the handler prunes stale chunks after re-indexing.
 * - Qdrant points whose memory no longer exists are deleted.
 *
 * Point deletion is guarded by a fresh Postgres existence check so a memory
 * created after the memory scan cannot have its fresh vectors removed.
 */
export async function reconcileVectors(
  deps: ReconcileVectorsDeps,
): Promise<ReconcileVectorsSummary> {
  const batchSize = deps.batchSize ?? DEFAULT_RECONCILE_BATCH_SIZE;
  const scanPageSize = deps.scanPageSize ?? DEFAULT_RECONCILE_SCAN_PAGE_SIZE;
  const maxEnqueue = deps.maxEnqueue ?? DEFAULT_RECONCILE_MAX_ENQUEUE;
  const correlationId = deps.correlationId ?? 'reconcile';

  // 1. Snapshot memories and their durable index states.
  const memories: Memory[] = [];
  const states = new Map<string, MemoryIndexStateRecord>();
  let memoryCursor: string | undefined;
  for (;;) {
    const page = await deps.memoryRepository.findAll(memoryCursor, batchSize);
    memories.push(...page.items);
    const pageStates = await deps.indexStateStore.findByMemoryIds(page.items.map((m) => m.id));
    for (const [id, state] of pageStates) states.set(id, state);
    if (!page.nextCursor) break;
    memoryCursor = page.nextCursor;
  }

  const needsReindex = new Map<string, Memory>();
  for (const memory of memories) {
    const state = states.get(memory.id);
    if (!state || state.contentHash !== memory.contentHash || state.status !== 'indexed') {
      needsReindex.set(memory.id, memory);
    }
  }

  // 2. Scan every point once: collect the actual point set per memory and
  //    identify potential orphans.
  const pointsByMemory = new Map<string, Set<string>>();
  let pointCursor: string | null | undefined;
  let pointsScanned = 0;
  for (;;) {
    const page = await deps.vectorStore.scanPoints(pointCursor, scanPageSize);
    pointsScanned += page.points.length;
    for (const point of page.points) {
      const ids = pointsByMemory.get(point.memoryId) ?? new Set<string>();
      ids.add(point.id);
      pointsByMemory.set(point.memoryId, ids);
    }
    if (!page.nextCursor) break;
    pointCursor = page.nextCursor;
  }

  // Re-check against Postgres before deleting: the memory snapshot above may
  // predate a concurrent create.
  const memoryIds = new Set(memories.map((m) => m.id));
  const orphanCandidates = [...pointsByMemory.keys()].filter((id) => !memoryIds.has(id));
  const stillExisting = await deps.memoryRepository.existsByIds(orphanCandidates);
  const orphanPointIds: string[] = [];
  for (const memoryId of orphanCandidates) {
    if (stillExisting.has(memoryId)) continue;
    orphanPointIds.push(...(pointsByMemory.get(memoryId) ?? []));
  }
  await deps.vectorStore.deletePoints(orphanPointIds);

  // 3. An "indexed" state is not enough: verify that the expected chunk
  //    points are present. Re-index if the point set drifted.
  for (const memory of memories) {
    const state = states.get(memory.id);
    if (!state || state.contentHash !== memory.contentHash || state.status !== 'indexed') {
      continue;
    }
    const expected = new Set(
      chunkMemoryContent(memory.content, deps.maxChunkTokens).map((chunk) =>
        qdrantPointId(memory.id, chunk.index),
      ),
    );
    const actual = pointsByMemory.get(memory.id) ?? new Set<string>();
    const consistent =
      expected.size === actual.size && [...expected].every((pointId) => actual.has(pointId));
    if (!consistent) needsReindex.set(memory.id, memory);
  }

  // 4. Re-enqueue a bounded number of repairs.
  let enqueued = 0;
  for (const memory of needsReindex.values()) {
    if (enqueued >= maxEnqueue) break;
    await deps.jobQueue.enqueue(
      EMBED_AND_INDEX_JOB,
      {
        memoryId: memory.id,
        userId: memory.userId,
        contentHash: memory.contentHash,
        correlationId,
      },
      { jobId: `${memory.id}_${memory.contentHash}`, force: true },
    );
    enqueued += 1;
  }

  return {
    memoriesScanned: memories.length,
    pointsScanned,
    enqueued,
    orphanPointsDeleted: orphanPointIds.length,
  };
}
