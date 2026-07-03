import { serve } from '@hono/node-server';
import { createServiceApp } from '@nabuos/service-kit';
import { btlRuntimeFromEnv } from '@nabuos/btl-runtime';

const port = Number(process.env.PORT ?? 3002);

const app = createServiceApp('mind', async () => {
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = { process: 'ok' };
  const client = btlRuntimeFromEnv();

  if (!client) {
    return {
      ready: false,
      checks: { ...checks, btl_runtime: 'fail' },
      message: 'GATEWAY_API_KEY not set',
    };
  }

  try {
    await client.ping();
    checks.btl_runtime = 'ok';
    return { ready: true, checks };
  } catch {
    checks.btl_runtime = 'fail';
    return {
      ready: false,
      checks,
      message: 'BTL Runtime unreachable or key rejected',
    };
  }
});

const server = serve({ fetch: app.fetch, port });
console.log(`mind listening on :${port}`);

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      console.error(err);
      process.exit(1);
    }
    process.exit(0);
  });
});
