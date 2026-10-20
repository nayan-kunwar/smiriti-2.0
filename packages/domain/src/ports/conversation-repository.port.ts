export type ConversationRole = 'user' | 'assistant' | 'system';

export interface ConversationRecord {
  id: string;
  userId: string;
  title: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  role: ConversationRole;
  content: string;
  createdAt: Date;
}

export interface ConversationRepository {
  createConversation(userId: string, title: string | null): Promise<ConversationRecord>;
  findConversation(userId: string, id: string): Promise<ConversationRecord | null>;
  appendMessage(
    conversationId: string,
    role: ConversationRole,
    content: string,
  ): Promise<ConversationMessageRecord>;
  /**
   * Returns messages in chronological order. When `limit` is provided, the
   * most recent `limit` messages are returned (still chronological).
   */
  listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]>;
}
