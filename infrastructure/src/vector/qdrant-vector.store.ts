import type {
  VectorPoint,
  VectorSearchParams,
  VectorSearchResult,
  VectorStore,
} from '@smriti/domain';

export interface QdrantVectorStoreOptions {
  baseUrl: string;
  collection: string;
  dimension: number;
}

export class QdrantVectorStore implements VectorStore {
  private readonly baseUrl: string;
  private readonly collection: string;
  private readonly dimension: number;

  constructor(opts: QdrantVectorStoreOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.collection = opts.collection;
    this.dimension = opts.dimension;
  }

  async ensureCollection(): Promise<void> {
    const existing = await fetch(`${this.baseUrl}/collections/${this.collection}`);
    if (existing.ok) {
      const json = (await existing.json()) as {
        result?: { config?: { params?: { vectors?: { size?: number } } } };
      };
      const size = json.result?.config?.params?.vectors?.size;
      if (size !== undefined && size !== this.dimension) {
        throw new Error(
          `Qdrant collection "${this.collection}" has size ${size} but provider needs ${this.dimension}. Use a separate collection per embedding provider (never share vectors across providers).`,
        );
      }
      return;
    }
    if (existing.status !== 404) {
      throw new Error(`Qdrant ensureCollection failed: ${existing.status}`);
    }
    const created = await fetch(`${this.baseUrl}/collections/${this.collection}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vectors: { size: this.dimension, distance: 'Cosine' },
      }),
    });
    if (!created.ok) {
      throw new Error(`Qdrant create collection failed: ${created.status}`);
    }
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points?wait=true`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        points: points.map((p) => ({
          id: p.id,
          vector: p.vector,
          payload: p.payload,
        })),
      }),
    });
    if (!res.ok) {
      throw new Error(`Qdrant upsert failed: ${res.status}`);
    }
  }

  async deleteByMemoryId(memoryId: string): Promise<void> {
    // Scroll all points matching memoryId (handles chunked {memoryId}_{i}), then delete.
    const matched: string[] = [];
    let offset: unknown = undefined;
    for (;;) {
      const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { must: [{ key: 'memoryId', match: { value: memoryId } }] },
          limit: 100,
          ...(offset !== undefined ? { offset } : {}),
          with_payload: false,
          with_vector: false,
        }),
      });
      if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
      const json = (await res.json()) as { result: { points: Array<{ id: string }>; next_page_offset?: unknown } };
      for (const p of json.result.points) matched.push(p.id);
      if (json.result.next_page_offset == null) break;
      offset = json.result.next_page_offset;
    }
    // Also cover chunked ids stored as point id prefix but payload missed (defensive).
    if (matched.length === 0) return;
    const del = await fetch(`${this.baseUrl}/collections/${this.collection}/points/delete?wait=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ points: matched }),
    });
    if (!del.ok) throw new Error(`Qdrant delete failed: ${del.status}`);
  }

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const must: unknown[] = [{ key: 'userId', match: { value: params.filter.userId } }];
    if (params.filter.category) must.push({ key: 'category', match: { value: params.filter.category } });
    if (params.filter.tags?.length) {
      for (const tag of params.filter.tags) must.push({ key: 'tags', match: { value: tag } });
    }
    if (params.filter.from ?? params.filter.to) {
      must.push({
        key: 'createdAt',
        range: {
          ...(params.filter.from ? { gte: params.filter.from.toISOString() } : {}),
          ...(params.filter.to ? { lte: params.filter.to.toISOString() } : {}),
        },
      });
    }

    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vector: params.vector,
        filter: { must },
        limit: params.limit,
        with_payload: true,
      }),
    });
    if (!res.ok) throw new Error(`Qdrant search failed: ${res.status}`);
    const json = (await res.json()) as {
      result: Array<{ id: string; score: number; payload: { memoryId: string; chunkIndex: number } }>;
    };
    return json.result.map((r) => ({
      id: String(r.id),
      memoryId: r.payload.memoryId,
      chunkIndex: r.payload.chunkIndex ?? 0,
      score: r.score,
    }));
  }
}
