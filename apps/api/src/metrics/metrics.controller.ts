import { Controller, Get, Inject, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Metrics } from '@smriti/infrastructure';
import { Public } from '../auth/decorators/public.decorator.js';
import { METRICS } from './metrics.constants.js';

@Controller()
@Public()
@SkipThrottle()
export class MetricsController {
  constructor(@Inject(METRICS) private readonly metrics: Metrics) {}

  @Get('metrics')
  async getMetrics(@Res() response: Response): Promise<void> {
    response.setHeader('Content-Type', this.metrics.contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.send(await this.metrics.render());
  }
}
