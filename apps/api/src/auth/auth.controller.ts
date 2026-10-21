import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import {
  CreateApiKeySchema,
  LoginSchema,
  LogoutSchema,
  RefreshTokenSchema,
  RegisterSchema,
  type CreateApiKeyInput,
  type LoginInput,
  type LogoutInput,
  type RefreshTokenInput,
  type RegisterInput,
} from '@smriti/shared';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUserId, CorrelationId } from '../common/decorators/request-context.decorator.js';
import { Public } from './decorators/public.decorator.js';
import { AuthService } from './auth.service.js';

@Controller('v1/auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body(new ZodValidationPipe(RegisterSchema)) body: RegisterInput,
    @CorrelationId() correlationId: string,
  ) {
    return this.authService.register(body, correlationId);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(LoginSchema)) body: LoginInput,
    @CorrelationId() correlationId: string,
  ) {
    return this.authService.login(body, correlationId);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body(new ZodValidationPipe(RefreshTokenSchema)) body: RefreshTokenInput,
    @CorrelationId() correlationId: string,
  ) {
    return this.authService.refresh(body, correlationId);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Body(new ZodValidationPipe(LogoutSchema)) body: LogoutInput,
    @CorrelationId() correlationId: string,
  ) {
    await this.authService.logout(body, correlationId);
  }
}

@Controller('v1/api-keys')
export class ApiKeysController {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUserId() userId: string,
    @Body(new ZodValidationPipe(CreateApiKeySchema)) body: CreateApiKeyInput,
    @CorrelationId() correlationId: string,
  ) {
    return this.authService.createApiKey(userId, body, correlationId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @CorrelationId() correlationId: string,
  ) {
    await this.authService.revokeApiKey(userId, id, correlationId);
  }
}
