import { Module } from '@nestjs/common';
import { createChatModel } from '@smriti/infrastructure';
import type { ChatModel } from '@smriti/domain';
import type { AppConfig } from '@smriti/shared';
import { APP_CONFIG } from '../config/config.module.js';
import { MemoryModule } from '../memory/memory.module.js';
import { ChatController } from './chat.controller.js';
import { ChatService } from './chat.service.js';
import { CHAT_MODEL } from './chat.tokens.js';

@Module({
  imports: [MemoryModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    {
      provide: CHAT_MODEL,
      useFactory: (config: AppConfig): ChatModel => createChatModel(config),
      inject: [APP_CONFIG],
    },
  ],
})
export class ChatModule {}
