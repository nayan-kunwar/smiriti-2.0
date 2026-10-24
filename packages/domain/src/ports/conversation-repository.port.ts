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
  turnId: string | null;
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
    turnId?: string,
  ): Promise<ConversationMessageRecord>;
  /**
   * Returns messages in chronological order. When `limit` is provided, the
   * most recent `limit` messages are returned (still chronological).
   */
  listMessages(conversationId: string, limit?: number): Promise<ConversationMessageRecord[]>;
  /**
   * Returns history for a new attempt at `excludeTurnId`, leaving out every
   * message already written by that turn so a retry cannot feed the same user
   * message to the model twice.
   */
  listMessagesForContext(
    conversationId: string,
    excludeTurnId: string | null,
    limit?: number,
  ): Promise<ConversationMessageRecord[]>;
}
