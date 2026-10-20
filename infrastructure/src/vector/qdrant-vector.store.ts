import type {
  VectorPoint,
  VectorPointRef,
  VectorScanPage,
  VectorSearchParams,
  VectorSearchResult,
  VectorStore,
} from '@smriti/domain';

export interface QdrantVectorStoreOptions {
  baseUrl: string;
  collection: string;
  dimension: number;
}

function toQdrantOffset(cursor: string): string | number {
  return /^\d+$/.test(cursor) ? Number(cursor) : cursor;
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
    const points = await this.listPointsByMemoryId(memoryId);
    await this.deletePoints(points.map((p) => p.id));
  }

  async deletePoints(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const res = await fetch(
      `${this.baseUrl}/collections/${this.collection}/points/delete?wait=true`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: ids }),
      },
    );
    if (!res.ok) throw new Error(`Qdrant delete failed: ${res.status}`);
  }

  async listPointsByMemoryId(memoryId: string): Promise<VectorPointRef[]> {
    const points: VectorPointRef[] = [];
    let offset: string | number | undefined;
    for (;;) {
      const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/scroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: { must: [{ key: 'memoryId', match: { value: memoryId } }] },
          limit: 100,
          ...(offset !== undefined ? { offset } : {}),
          with_payload: true,
          with_vector: false,
        }),
      });
      if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
      const json = (await res.json()) as {
        result: {
          points: Array<{
            id: string | number;
            payload?: { memoryId?: string; chunkIndex?: number };
          }>;
          next_page_offset?: string | number | null;
        };
      };
      for (const p of json.result.points) {
        points.push({
          id: String(p.id),
          memoryId: p.payload?.memoryId ?? memoryId,
          chunkIndex: p.payload?.chunkIndex ?? 0,
        });
      }
      if (json.result.next_page_offset == null) break;
      offset = toQdrantOffset(String(json.result.next_page_offset));
    }
    return points;
  }

  async scanPoints(cursor?: string | null, limit = 256): Promise<VectorScanPage> {
    const res = await fetch(`${this.baseUrl}/collections/${this.collection}/points/scroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: Math.min(Math.max(limit, 1), 1000),
        ...(cursor ? { offset: toQdrantOffset(cursor) } : {}),
        with_payload: true,
        with_vector: false,
      }),
    });
    if (!res.ok) throw new Error(`Qdrant scroll failed: ${res.status}`);
    const json = (await res.json()) as {
      result: {
        points: Array<{
          id: string | number;
          payload?: { memoryId?: string; chunkIndex?: number };
        }>;
        next_page_offset?: string | number | null;
      };
    };
    return {
      points: json.result.points
        .filter((p) => typeof p.payload?.memoryId === 'string')
        .map((p) => ({
          id: String(p.id),
          memoryId: p.payload!.memoryId!,
          chunkIndex: p.payload?.chunkIndex ?? 0,
        })),
      nextCursor:
        json.result.next_page_offset == null ? null : String(json.result.next_page_offset),
    };
  }

  async search(params: VectorSearchParams): Promise<VectorSearchResult[]> {
    const must: unknown[] = [{ key: 'userId', match: { value: params.filter.userId } }];
    if (params.filter.category)
      must.push({ key: 'category', match: { value: params.filter.category } });
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
      result: Array<{
        id: string;
        score: number;
        payload: { memoryId: string; chunkIndex: number };
      }>;
    };
    return json.result.map((r) => ({
      id: String(r.id),
      memoryId: r.payload.memoryId,
      chunkIndex: r.payload.chunkIndex ?? 0,
      score: r.score,
    }));
  }
}
