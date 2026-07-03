import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createServiceApp } from '@nabuos/service-kit';
import {
  envSecretsReady,
  listEnvSecretHandles,
  resolveEnvSecret,
} from '@nabuos/env-secrets';

const port = Number(process.env.PORT ?? 3003);

const health = createServiceApp('vault', () => {
  const { ready, checks } = envSecretsReady();
  return {
    ready,
    checks: { process: 'ok', ...checks },
    message: ready ? undefined : 'env secrets not fully configured',
  };
});

const app = new Hono();

app.route('/', health);

/** List opaque handles — never returns secret values */
app.get('/v1/vault/handles', (c) =>
  c.json({ handles: listEnvSecretHandles() }),
);

/** Internal resolve — ponytail: no Infisical yet; env-only for BTL key */
app.get('/v1/vault/resolve', (c) => {
  const handle = c.req.query('handle');
  if (!handle) return c.json({ error: 'handle required' }, 400);
  const value = resolveEnvSecret(handle);
  if (!value) return c.json({ error: 'not_found' }, 404);
  return c.json({ handle, configured: true });
});

const server = serve({ fetch: app.fetch, port });
console.log(`vault listening on :${port}`);

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
