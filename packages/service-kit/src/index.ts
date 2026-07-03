import { Hono } from 'hono';
import type { HealthResponse, ReadinessCheck } from '@nabuos/types';

export type ReadinessProbe = () => Promise<ReadinessCheck> | ReadinessCheck;

const startedAt = Date.now();

/** Shared /healthz and /readyz for all nabuOS services. */
export function createServiceApp(
  service: string,
  readiness?: ReadinessProbe,
): Hono {
  const app = new Hono();

  app.get('/healthz', (c) => {
    const body: HealthResponse = {
      status: 'ok',
      service,
      uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
    };
    return c.json(body);
  });

  app.get('/readyz', async (c) => {
    const result: ReadinessCheck = readiness
      ? await readiness()
      : { ready: true, checks: { process: 'ok' } };

    return c.json(result, result.ready ? 200 : 503);
  });

  return app;
}
