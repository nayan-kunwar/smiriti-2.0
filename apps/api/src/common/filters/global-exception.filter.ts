import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { DomainError, NotFoundError, ValidationError, ConflictError, UnauthorizedError } from '@smriti/shared';

@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const correlationId =
      request.correlationId ??
      (request.headers['x-correlation-id'] as string | undefined) ??
      'unknown';

    if (exception instanceof NotFoundError) {
      response.status(HttpStatus.NOT_FOUND).json({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: exception.message,
        correlationId,
      });
      return;
    }

    if (exception instanceof ValidationError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: exception.message,
        correlationId,
      });
      return;
    }

    if (exception instanceof ConflictError) {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: exception.message,
        correlationId,
      });
      return;
    }

    if (exception instanceof UnauthorizedError) {
      response.status(HttpStatus.UNAUTHORIZED).json({
        statusCode: HttpStatus.UNAUTHORIZED,
        error: 'Unauthorized',
        message: exception.message,
        correlationId,
      });
      return;
    }

    if (exception instanceof DomainError) {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Domain Error',
        message: exception.message,
        correlationId,
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      response.status(status).json(
        typeof body === 'string'
          ? { statusCode: status, error: exception.name, message: body, correlationId }
          : { ...(body as object), correlationId },
      );
      return;
    }

    this.logger.error(
      `Unhandled error on ${request.method} ${request.url} (correlationId=${correlationId}): ${
        exception instanceof Error ? exception.stack ?? exception.message : String(exception)
      }`,
    );
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      error: 'Internal Server Error',
      message:
        process.env.NODE_ENV === 'test' && exception instanceof Error
          ? exception.message
          : 'An unexpected error occurred',
      correlationId,
    });
  }
}
