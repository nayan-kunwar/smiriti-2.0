import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  UseInterceptors,
} from '@nestjs/common';
import {
  ChatRequestSchema,
  CreateConversationSchema,
  ListConversationMessagesQuerySchema,
  type ChatRequestInput,
  type CreateConversationInput,
  type ListConversationMessagesQueryInput,
} from '@smriti/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUserId, CorrelationId } from '../common/decorators/request-context.decorator.js';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor.js';
import { ChatService } from './chat.service.js';

@Controller('v1')
export class ChatController {
  constructor(@Inject(ChatService) private readonly chatService: ChatService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(IdempotencyInterceptor)
  async chat(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Body(new ZodValidationPipe(ChatRequestSchema)) body: ChatRequestInput,
  ) {
    return this.chatService.send(userId, correlationId, body);
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  async createConversation(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(CreateConversationSchema)) body: CreateConversationInput,
  ) {
    return this.chatService.createConversation(userId, body);
  }

  @Get('conversations/:id/messages')
  async listMessages(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(ListConversationMessagesQuerySchema))
    query: ListConversationMessagesQueryInput,
  ) {
    return this.chatService.listMessages(userId, id, query);
  }
}
