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

export function chunkMemoryContent(content: string): TextChunk[] {
  const totalTokens = estimateTokens(content);
  if (totalTokens <= ATOMIC_TOKEN_LIMIT) {
    return [{ index: 0, text: content, tokenCount: totalTokens }];
  }

  const chunkChars = CHUNK_TOKEN_SIZE * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP_TOKENS * CHARS_PER_TOKEN;
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

export function qdrantPointId(memoryId: string, chunkIndex: number): string {
  if (chunkIndex === 0) return memoryId;
  return `${memoryId}_${chunkIndex}`;
}
