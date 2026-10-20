import type {
  VectorPoint,
  VectorPointRef,
  VectorScanPage,
  VectorSearchParams,
  VectorSearchResult,
  VectorStore,
} from '@smriti/domain';

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export class InMemoryVectorStore implements VectorStore {
  private readonly points = new Map<string, VectorPoint>();

  async ensureCollection(): Promise<void> {}

  async upsert(points: VectorPoint[]): Promise<void> {
    for (const p of points) this.points.set(p.id, p);
  }

  async deleteByMemoryId(memoryId: string): Promise<void> {
    for (const [id, p] of this.points) {
      if (p.payload.memoryId === memoryId || id === memoryId || id.startsWith(`${memoryId}_`)) {
        this.points.delete(id);
      }
    }
  }

  async deletePoints(ids: string[]): Promise<void> {
    for (const id of ids) this.points.delete(id);
  }

  async listPointsByMemoryId(memoryId: string): Promise<VectorPointRef[]> {
    return [...this.points.values()]
      .filter((p) => p.payload.memoryId === memoryId)
      .map((p) => ({
        id: p.id,
        memoryId: p.payload.memoryId,
        chunkIndex: p.payload.chunkIndex,
      }));
  }

  async scanPoints(cursor?: string | null, limit = 256): Promise<VectorScanPage> {
    const items = [...this.points.values()].sort((a, b) => a.id.localeCompare(b.id));
    let startIndex = 0;
    if (cursor) {
      const cursorIndex = items.findIndex((p) => p.id === cursor);
      startIndex = cursorIndex >= 0 ? cursorIndex + 1 : 0;
    }

    const page = items.slice(startIndex, startIndex + limit);
    return {
      points: page.map((p) => ({
        id: p.id,
        memoryId: p.payload.memoryId,
        chunkIndex: p.payload.chunkIndex,
      })),
      nextCursor: startIndex + limit < items.length ? (page[page.length - 1]?.id ?? null) : null,
    };
  }

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const scored: VectorSearchResult[] = [];
    for (const p of this.points.values()) {
      if (p.payload.userId !== params.filter.userId) continue;
      scored.push({
        id: p.id,
        memoryId: p.payload.memoryId,
        chunkIndex: p.payload.chunkIndex,
        score: cosine(params.vector, p.vector),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, params.limit);
  }
}
