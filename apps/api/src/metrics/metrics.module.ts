import { Global, Module } from '@nestjs/common';
import { Metrics } from '@smriti/infrastructure';
import { MetricsController } from './metrics.controller.js';
import { METRICS } from './metrics.constants.js';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [{ provide: METRICS, useFactory: () => new Metrics() }],
  exports: [METRICS],
})
export class MetricsModule {}
