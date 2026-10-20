import type { ConversationRepository } from '@smriti/domain';
import { NotFoundError } from '@smriti/shared';
import { createChatGraph, type ChatGraphDeps } from './chat.graph.js';
import { toChatMessage, type ChatCommandResult, type ChatGraphState } from './chat.types.js';

export interface ChatCommandDeps extends ChatGraphDeps {
  conversationRepository: ConversationRepository;
}

export interface ChatCommandInput {
  userId: string;
  correlationId: string;
  conversationId?: string;
  message: string;
}

function titleFrom(message: string): string {
  const cleaned = message.replace(/\s+/g, ' ').trim();
  return cleaned.length > 60 ? `${cleaned.slice(0, 57)}...` : cleaned;
}

export async function chat(
  deps: ChatCommandDeps,
  input: ChatCommandInput,
): Promise<ChatCommandResult> {
  let conversation = input.conversationId
    ? await deps.conversationRepository.findConversation(input.userId, input.conversationId)
    : null;

  if (input.conversationId && !conversation) {
    throw new NotFoundError('Conversation', input.conversationId);
  }
  if (!conversation) {
    conversation = await deps.conversationRepository.createConversation(
      input.userId,
      titleFrom(input.message),
    );
  }

  const history = await deps.conversationRepository.listMessages(
    conversation.id,
    deps.historyLimit ?? 20,
  );
  await deps.conversationRepository.appendMessage(conversation.id, 'user', input.message);

  const graph = createChatGraph(deps);
  const initial: ChatGraphState = {
    userId: input.userId,
    conversationId: conversation.id,
    correlationId: input.correlationId,
    messages: [...history.map(toChatMessage), { role: 'user', content: input.message }],
    latestUserMessage: input.message,
    intent: null,
    extractedMemories: [],
    retrievedMemories: [],
    duplicateWarnings: [],
    memoriesCreated: [],
    createdMemoryContents: [],
    memoriesRetrieved: [],
    context: null,
    response: null,
  };

  const result = await graph.invoke(initial);
  const response = result.response?.trim() || 'I could not generate a response.';
  await deps.conversationRepository.appendMessage(conversation.id, 'assistant', response);

  return {
    conversationId: conversation.id,
    message: response,
    memoriesCreated: result.memoriesCreated,
    memoriesRetrieved: result.memoriesRetrieved,
    duplicateWarnings: result.duplicateWarnings,
  };
}
