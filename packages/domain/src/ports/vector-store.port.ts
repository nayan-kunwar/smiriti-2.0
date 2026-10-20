export interface VectorPoint {
  id: string;
  vector: number[];
  payload: {
    userId: string;
    memoryId: string;
    chunkIndex: number;
    category?: string | null;
    tags?: string[];
    createdAt?: string;
  };
}

export interface VectorSearchFilter {
  userId: string;
  category?: string;
  tags?: string[];
  from?: Date;
  to?: Date;
  includeArchived?: boolean;
}

export interface VectorSearchParams {
  vector: number[];
  filter: VectorSearchFilter;
  limit: number;
}

export interface VectorSearchResult {
  id: string;
  memoryId: string;
  chunkIndex: number;
  score: number;
}

export interface VectorPointRef {
  id: string;
  memoryId: string;
  chunkIndex: number;
}

export interface VectorScanPage {
  points: VectorPointRef[];
  nextCursor: string | null;
}

export interface VectorStore {
  upsert(points: VectorPoint[]): Promise<void>;
  deleteByMemoryId(memoryId: string): Promise<void>;
  deletePoints(ids: string[]): Promise<void>;
  listPointsByMemoryId(memoryId: string): Promise<VectorPointRef[]>;
  scanPoints(cursor?: string | null, limit?: number): Promise<VectorScanPage>;
  search(params: VectorSearchParams): Promise<VectorSearchResult[]>;
  ensureCollection(): Promise<void>;
}
