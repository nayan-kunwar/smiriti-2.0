import { z } from 'zod';

export const CreateConversationSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
});

export const ChatRequestSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1).max(10_000),
});

export const ListConversationMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreateConversationInput = z.infer<typeof CreateConversationSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type ListConversationMessagesQueryInput = z.infer<
  typeof ListConversationMessagesQuerySchema
>;
