import type { ChatMessage, ConversationMessageRecord } from '@smriti/domain';
import type { ScoredMemoryDto } from '../queries/search-memories.query.js';

export type ChatIntent = 'remember' | 'recall' | 'general';

export interface ExtractedMemory {
  content: string;
  type: 'long_term' | 'semantic';
  confidence: number;
}

export interface DuplicateWarning {
  existingMemoryId: string;
  similarity: number;
}

export interface ChatGraphState {
  userId: string;
  conversationId: string;
  correlationId: string;
  messages: ChatMessage[];
  latestUserMessage: string;
  intent: ChatIntent | null;
  extractedMemories: ExtractedMemory[];
  retrievedMemories: ScoredMemoryDto[];
  duplicateWarnings: DuplicateWarning[];
  memoriesCreated: string[];
  createdMemoryContents: string[];
  memoriesRetrieved: string[];
  context: string | null;
  response: string | null;
}

export interface ChatCommandResult {
  conversationId: string;
  message: string;
  memoriesCreated: string[];
  memoriesRetrieved: string[];
  duplicateWarnings: DuplicateWarning[];
}

export function toChatMessage(message: ConversationMessageRecord): ChatMessage {
  return { role: message.role, content: message.content };
}
