import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const header = process.env.CORRELATION_ID_HEADER ?? 'x-correlation-id';
    const correlationId = (req.headers[header] as string | undefined) ?? randomUUID();
    req.headers[header] = correlationId;
    res.setHeader(header, correlationId);
    (req as Request & { correlationId: string }).correlationId = correlationId;
    next();
  }
}
