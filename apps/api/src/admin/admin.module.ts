import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [MemoryModule],
  controllers: [AdminController],
})
export class AdminModule {}
