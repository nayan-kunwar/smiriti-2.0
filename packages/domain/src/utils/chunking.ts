import { createHash } from 'node:crypto';

export interface TextChunk {
  index: number;
  text: string;
  tokenCount: number;
}

const CHARS_PER_TOKEN = 4;
const ATOMIC_TOKEN_LIMIT = 500;
const CHUNK_TOKEN_SIZE = 900;
const CHUNK_OVERLAP_TOKENS = 100;

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function chunkMemoryContent(
  content: string,
  maxInputTokens = CHUNK_TOKEN_SIZE,
): TextChunk[] {
  const tokenLimit = Math.max(1, maxInputTokens);
  const totalTokens = estimateTokens(content);
  const atomicTokenLimit = Math.min(ATOMIC_TOKEN_LIMIT, tokenLimit);
  if (totalTokens <= atomicTokenLimit) {
    return [{ index: 0, text: content, tokenCount: totalTokens }];
  }

  const chunkTokenSize = Math.min(CHUNK_TOKEN_SIZE, tokenLimit);
  const overlapTokenSize = Math.min(CHUNK_OVERLAP_TOKENS, Math.floor(chunkTokenSize / 4));
  const chunkChars = chunkTokenSize * CHARS_PER_TOKEN;
  const overlapChars = overlapTokenSize * CHARS_PER_TOKEN;
  const step = Math.max(1, chunkChars - overlapChars);

  const chunks: TextChunk[] = [];
  let index = 0;
  for (let start = 0; start < content.length; start += step) {
    const text = content.slice(start, start + chunkChars);
    if (!text) break;
    chunks.push({ index, text, tokenCount: estimateTokens(text) });
    index += 1;
    if (start + chunkChars >= content.length) break;
  }
  return chunks;
}

const QDRANT_POINT_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Qdrant point IDs must be unsigned integers or UUIDs, so chunk indices
 * cannot be suffixed to the memory UUID. Chunk 0 keeps the memory ID for
 * backwards compatibility; later chunks use a deterministic UUIDv5.
 */
export function qdrantPointId(memoryId: string, chunkIndex: number): string {
  if (chunkIndex === 0) return memoryId;
  return uuidV5(`${memoryId}:${chunkIndex}`, QDRANT_POINT_NAMESPACE);
}

function uuidV5(name: string, namespace: string): string {
  const namespaceBytes = Buffer.from(namespace.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(namespaceBytes).update(name).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const hex = hash.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
