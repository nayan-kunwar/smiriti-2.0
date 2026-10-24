import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
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
import {
  CurrentUserId,
  CorrelationId,
  IdempotencyKey,
} from '../common/decorators/request-context.decorator.js';
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
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.chatService.send(userId, correlationId, body, idempotencyKey);
  }

  @Post('chat/turns/:turnId/retry')
  @HttpCode(HttpStatus.OK)
  async retryTurn(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Param('turnId', new ParseUUIDPipe()) turnId: string,
  ) {
    return this.chatService.retryTurn(userId, turnId, correlationId);
  }

  @Get('chat/turns/:turnId')
  async getTurn(
    @CurrentUserId() userId: string,
    @Param('turnId', new ParseUUIDPipe()) turnId: string,
  ) {
    return this.chatService.getTurn(userId, turnId);
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
