import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CreateMemorySchema,
  ListMemoriesQuerySchema,
  SearchMemoriesSchema,
  UpdateMemorySchema,
  type CreateMemoryInput,
  type ListMemoriesQueryInput,
  type SearchMemoriesInput,
  type UpdateMemoryInput,
} from '@smriti/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUserId, CorrelationId } from '../common/decorators/request-context.decorator.js';
import { MemoryService } from './memory.service.js';

@Controller('v1/memories')
export class MemoryController {
  constructor(@Inject(MemoryService) private readonly memoryService: MemoryService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Body(new ZodValidationPipe(CreateMemorySchema)) body: CreateMemoryInput,
  ) {
    return this.memoryService.create(userId, correlationId, body);
  }

  @Get()
  async list(
    @CurrentUserId() userId: string,
    @Query(new ZodValidationPipe(ListMemoriesQuerySchema)) query: ListMemoriesQueryInput,
  ) {
    return this.memoryService.list(userId, query);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  async search(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(SearchMemoriesSchema)) body: SearchMemoriesInput,
  ) {
    return this.memoryService.search(userId, body);
  }

  @Get(':id')
  async get(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.memoryService.get(userId, id);
  }

  @Patch(':id')
  async update(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateMemorySchema)) body: UpdateMemoryInput,
  ) {
    return this.memoryService.update(userId, correlationId, id, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentUserId() userId: string,
    @CorrelationId() correlationId: string,
    @Param('id') id: string,
  ) {
    await this.memoryService.delete(userId, correlationId, id);
  }
}
