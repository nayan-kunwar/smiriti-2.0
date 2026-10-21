import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Controller, Get } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Metrics } from '@smriti/infrastructure';
import request from 'supertest';
import { HttpMetricsMiddleware } from '../common/middleware/http-metrics.middleware.js';
import { METRICS } from './metrics.constants.js';
import { MetricsModule } from './metrics.module.js';

@Controller('test')
class TestController {
  @Get()
  get(): { ok: boolean } {
    return { ok: true };
  }
}

describe('Metrics endpoint', () => {
  let app: INestApplication;
  let metrics: Metrics;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MetricsModule],
      controllers: [TestController],
      providers: [HttpMetricsMiddleware],
    }).compile();

    app = moduleRef.createNestApplication();
    const middleware = moduleRef.get(HttpMetricsMiddleware);
    app.use((req, res, next) => middleware.use(req, res, next));
    await app.init();
    metrics = moduleRef.get(METRICS);
  });

  beforeEach(() => {
    metrics.reset();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves Prometheus metrics without recording the scrape itself', async () => {
    await request(app.getHttpServer()).get('/test').expect(200);
    await request(app.getHttpServer()).get('/test').expect(200);

    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.text).toContain('smriti_http_requests_total');
    expect(response.text).toContain('smriti_http_request_duration_seconds_bucket');
    expect(response.text).toMatch(
      /smriti_http_requests_total\{[^}]*method="GET"[^}]*route="\/test"[^}]*status="200"[^}]*\} 2/,
    );
    expect(response.text).not.toContain('route="/metrics"');
  });

  it('records unmatched requests without using their raw URL as a label', async () => {
    await request(app.getHttpServer()).get('/missing/secret-id').expect(404);

    const response = await request(app.getHttpServer()).get('/metrics').expect(200);

    expect(response.text).toMatch(
      /smriti_http_requests_total\{[^}]*method="GET"[^}]*route="unmatched"[^}]*status="404"[^}]*\} 1/,
    );
    expect(response.text).not.toContain('/missing/secret-id');
  });
});
