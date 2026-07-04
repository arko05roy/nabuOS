import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { createServiceApp } from '@nabuos/service-kit';
import type { ReadinessCheck } from '@nabuos/types';

const port = Number(process.env.PORT ?? 3100);

function upstreamUrl(envKey: string, defaultPort: number): string {
  return (process.env[envKey] ?? `http://127.0.0.1:${defaultPort}`).replace(/\/$/, '');
}

const upstreams = {
  guard: upstreamUrl('GUARD_URL', 3001),
  mind: upstreamUrl('MIND_URL', 3002),
  vault: upstreamUrl('VAULT_URL', 3003),
  run: upstreamUrl('RUN_URL', 3004),
  sandbox: upstreamUrl('SANDBOX_URL', 3005),
  pulse: upstreamUrl('PULSE_URL', 3006),
} as const;

async function gatewayReadiness(): Promise<ReadinessCheck> {
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = {};
  await Promise.all(
    Object.entries(upstreams).map(async ([name, base]) => {
      try {
        const res = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(3_000) });
        checks[name] = res.ok ? 'ok' : 'fail';
      } catch {
        checks[name] = 'fail';
      }
    }),
  );
  const ready = Object.values(checks).every((v) => v === 'ok');
  return {
    ready,
    checks,
    message: ready ? undefined : 'one or more upstream services unreachable',
  };
}

async function proxyTo(c: Context, base: string) {
  const incoming = new URL(c.req.url);
  const requestId =
    c.req.header('x-nabu-request-id') ??
    `req_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const target = `${base}${incoming.pathname}${incoming.search}`;

  const headers = new Headers();
  c.req.raw.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'host') return;
    headers.set(key, value);
  });
  headers.set('x-nabu-request-id', requestId);
  headers.set('x-forwarded-host', c.req.header('host') ?? 'localhost');
  headers.set('x-forwarded-proto', incoming.protocol.replace(':', ''));

  const init: RequestInit & { duplex?: 'half' } = {
    method: c.req.method,
    headers,
    redirect: 'manual',
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && c.req.method !== 'OPTIONS') {
    init.body = c.req.raw.body;
    init.duplex = 'half';
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'bad_gateway', message }, 502);
  }

  const out = new Headers(res.headers);
  out.set('x-nabu-request-id', requestId);
  return new Response(res.body, { status: res.status, headers: out });
}

const health = createServiceApp('api-gateway', gatewayReadiness);
const app = new Hono();

app.route('/', health);

app.all('/v1/guard/*', (c) => proxyTo(c, upstreams.guard));
app.all('/v1/mind/*', (c) => proxyTo(c, upstreams.mind));
app.all('/v1/vault/*', (c) => proxyTo(c, upstreams.vault));
app.all('/v1/run/*', (c) => proxyTo(c, upstreams.run));
app.all('/v1/sandbox/*', (c) => proxyTo(c, upstreams.sandbox));
app.all('/v1/pulse/*', (c) => proxyTo(c, upstreams.pulse));

app.all('/v1/*', (c) =>
  c.json({ error: 'not_found', message: `no upstream for ${c.req.path}` }, 404),
);

app.onError((err, c) => {
  console.error('api-gateway error:', err);
  return c.json({ error: 'internal_error', message: 'unexpected gateway error' }, 500);
});

const server = serve({ fetch: app.fetch, port });
console.log(`api-gateway listening on :${port}`);

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
