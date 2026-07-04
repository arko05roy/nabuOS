import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createLogger, withTelemetry } from '@nabuos/otel';
import { createServiceApp } from '@nabuos/service-kit';
import type { CreateSecretRequest } from '@nabuos/types';
import {
  createSecretProviders,
  createStoredSecret,
  evaluateSecretPolicy,
  listAllHandles,
  listAllRefs,
  resolveEnvSecret,
  resolveThroughProviders,
} from '@nabuos/env-secrets';
import { countAllowedReads, listAccessEvents, recordAccessEvent } from './audit-log.js';
import { createFsSecretProvider, fsVaultReady } from './secret-store.js';

const port = Number(process.env.PORT ?? 3003);

const fsProvider = createFsSecretProvider(countAllowedReads);
const providers = createSecretProviders(fsProvider);

const log = createLogger('vault');

const health = createServiceApp('vault', () => {
  const fs = fsVaultReady();
  const envKey = resolveEnvSecret('secret://env/gateway-api-key');
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = {
    process: 'ok',
    env_gateway_key: envKey ? 'ok' : 'fail',
    fs_encryption: fs.ready ? 'ok' : 'unknown',
  };
  const ready = Boolean(envKey);
  return {
    ready,
    checks,
    message: ready ? undefined : 'GATEWAY_API_KEY required for env bootstrap secret',
  };
});

const app = withTelemetry(new Hono(), 'vault');
app.route('/', health);

function parseCreateSecret(body: unknown): CreateSecretRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const project_id = b.project_id;
  const name = b.name;
  const value = b.value;
  if (typeof project_id !== 'string' || !project_id.trim()) {
    return { error: 'project_id is required' };
  }
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (typeof value !== 'string' || !value.length) return { error: 'value is required' };
  const policy =
    b.policy && typeof b.policy === 'object' ? (b.policy as CreateSecretRequest['policy']) : {};
  return {
    project_id: project_id.trim(),
    name: name.trim(),
    value,
    policy: policy ?? {},
  };
}

/** List opaque handles — never returns secret values */
app.get('/v1/vault/handles', async (c) => {
  const handles = await listAllHandles(providers);
  return c.json({ handles });
});

/** List secret refs (metadata only) */
app.get('/v1/vault/secrets', async (c) => {
  const secrets = await listAllRefs(providers);
  return c.json({ secrets });
});

app.get('/v1/vault/secrets/:secret_id', async (c) => {
  const secretId = c.req.param('secret_id');
  const secrets = await listAllRefs(providers);
  const ref = secrets.find((s) => s.secret_id === secretId);
  if (!ref) return c.json({ error: 'secret_not_found' }, 404);
  return c.json(ref);
});

/** Store secret — value never returned after creation */
app.post('/v1/vault/secrets', async (c) => {
  const fs = fsVaultReady();
  if (!fs.ready) {
    return c.json(
      { error: 'vault_not_ready', message: fs.message ?? 'VAULT_ENCRYPTION_KEY required' },
      503,
    );
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseCreateSecret(body);
  if ('error' in parsed) return c.json({ error: 'invalid_request', message: parsed.error }, 400);

  try {
    const ref = await createStoredSecret(providers, parsed);
    return c.json(ref, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'create_failed', message: msg }, 500);
  }
});

/** Public probe — configured flag only */
app.get('/v1/vault/resolve', async (c) => {
  const handle = c.req.query('handle');
  if (!handle) return c.json({ error: 'handle required' }, 400);
  const envVal = resolveEnvSecret(handle);
  if (envVal) return c.json({ handle, configured: true });
  const ref = await fsProvider.getRef(handle);
  return c.json({ handle, configured: Boolean(ref) }, ref ? 200 : 404);
});

/** Internal resolve for Run — returns value to authorized agent only */
app.post('/v1/vault/resolve', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object') return c.json({ error: 'invalid_request' }, 400);
  const b = body as Record<string, unknown>;
  const handle = typeof b.handle === 'string' ? b.handle : '';
  const agent_id = typeof b.agent_id === 'string' ? b.agent_id : undefined;
  const tool = typeof b.tool === 'string' ? b.tool : undefined;
  if (!handle) return c.json({ error: 'handle required' }, 400);

  const readCount = await countAllowedReads(handle);
  const { value, ref } = await resolveThroughProviders(providers, handle, {
    agent_id,
    tool,
    read_count: readCount,
  });

  if (!ref) {
    await recordAccessEvent({ handle, agent_id, tool, outcome: 'not_found' });
    return c.json({ error: 'not_found' }, 404);
  }

  const decision = evaluateSecretPolicy(ref.policy, { agent_id, tool, read_count: readCount });
  if (!decision.allowed) {
    await recordAccessEvent({
      handle,
      agent_id,
      tool,
      outcome: decision.outcome,
      reason: decision.reason,
    });
    return c.json({ error: 'policy_denied', message: decision.reason }, 403);
  }

  if (!value) {
    await recordAccessEvent({ handle, agent_id, tool, outcome: 'not_found' });
    return c.json({ error: 'not_found' }, 404);
  }

  await recordAccessEvent({ handle, agent_id, tool, outcome: 'allowed' });
  return c.json({ handle, value });
});

app.get('/v1/vault/access-events', async (c) => {
  const limit = Number(c.req.query('limit') ?? '100');
  const events = await listAccessEvents(Number.isFinite(limit) ? limit : 100);
  return c.json({ events });
});

const server = serve({ fetch: app.fetch, port });
log.info(`vault listening on :${port}`);

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close((err) => {
    if (err) {
      log.error('shutdown failed', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
    process.exit(0);
  });
});
