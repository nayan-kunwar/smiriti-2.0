import type {
  VectorPoint,
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
