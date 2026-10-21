import { describe, expect, it } from 'vitest';
import { Metrics } from './metrics.js';

describe('Metrics', () => {
  it('renders process and HTTP metrics in Prometheus format', async () => {
    const metrics = new Metrics();

    metrics.observeHttp('get', '/v1/memories/:id', 200, 0.042);
    metrics.observeHttp('get', '/v1/memories/:id', 500, 0.5);

    const output = await metrics.render();

    expect(metrics.contentType).toContain('text/plain');
    expect(output).toContain('smriti_http_requests_total');
    expect(output).toContain('smriti_http_request_duration_seconds');
    expect(output).toMatch(
      /smriti_http_requests_total\{[^}]*method="GET"[^}]*route="\/v1\/memories\/:id"[^}]*status="200"[^}]*\} 1/,
    );
    expect(output).toMatch(
      /smriti_http_requests_total\{[^}]*method="GET"[^}]*route="\/v1\/memories\/:id"[^}]*status="500"[^}]*\} 1/,
    );
  });

  it('counts completed and failed jobs', async () => {
    const metrics = new Metrics();

    metrics.observeJob('smriti-jobs', 'embed-and-index', 'completed', 1.25);
    metrics.observeJob('smriti-jobs', 'embed-and-index', 'failed', 0.75);

    const output = await metrics.render();

    expect(output).toMatch(
      /smriti_bullmq_jobs_total\{[^}]*queue="smriti-jobs"[^}]*job="embed-and-index"[^}]*status="completed"[^}]*\} 1/,
    );
    expect(output).toMatch(
      /smriti_bullmq_jobs_total\{[^}]*queue="smriti-jobs"[^}]*job="embed-and-index"[^}]*status="failed"[^}]*\} 1/,
    );
    expect(output).toContain('smriti_bullmq_job_duration_seconds_bucket');
  });
});
