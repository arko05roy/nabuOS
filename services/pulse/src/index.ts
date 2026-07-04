import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { createServiceApp } from '@nabuos/service-kit';
import type { CreatePulseWatchlistRequest, PulseWatchlist } from '@nabuos/types';
import { pulseDependenciesReady, runWatchlistCheck } from './pulse-engine.js';
import {
  createWatchlistId,
  listAlertsForWatchlist,
  listWatchlists,
  loadWatchlist,
  saveWatchlist,
} from './watchlist-store.js';

const port = Number(process.env.PORT ?? 3006);

const health = createServiceApp('pulse', async () => {
  const { ready, checks } = await pulseDependenciesReady();
  return {
    ready,
    checks,
    message: ready ? undefined : 'guard and mind must be reachable',
  };
});

const app = new Hono();
app.use(
  '*',
  cors({
    origin: (process.env.PULSE_CORS_ORIGIN ?? 'http://127.0.0.1:5173').split(','),
    allowMethods: ['GET', 'POST', 'OPTIONS'],
  }),
);
app.route('/', health);

const inflight = new Set<string>();

function parseCreateWatchlist(body: unknown): CreatePulseWatchlistRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const name = b.name;
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (!Array.isArray(b.packages) || b.packages.length === 0) {
    return { error: 'packages required' };
  }

  const packages = b.packages
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => ({
      ecosystem: p.ecosystem as 'npm' | 'pypi',
      name: String(p.name ?? '').trim(),
      baseline_version:
        typeof p.baseline_version === 'string' ? p.baseline_version.trim() : undefined,
    }))
    .filter((p) => (p.ecosystem === 'npm' || p.ecosystem === 'pypi') && p.name);

  if (!packages.length) return { error: 'each package needs ecosystem (npm|pypi) and name' };

  const webhook_url =
    typeof b.webhook_url === 'string' && b.webhook_url.trim() ? b.webhook_url.trim() : undefined;

  return { name: name.trim(), webhook_url, packages };
}

app.post('/v1/pulse/watchlists', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseCreateWatchlist(body);
  if ('error' in parsed) return c.json({ error: 'invalid_request', message: parsed.error }, 400);

  const ts = new Date().toISOString();
  const wl: PulseWatchlist = {
    watchlist_id: createWatchlistId(),
    name: parsed.name,
    webhook_url: parsed.webhook_url,
    packages: parsed.packages,
    created_at: ts,
    updated_at: ts,
  };
  await saveWatchlist(wl);
  return c.json(wl, 201);
});

app.get('/v1/pulse/watchlists', async (c) => {
  const watchlists = await listWatchlists();
  return c.json({ watchlists });
});

app.get('/v1/pulse/watchlists/:id', async (c) => {
  const wl = await loadWatchlist(c.req.param('id'));
  if (!wl) return c.json({ error: 'watchlist_not_found' }, 404);
  return c.json(wl);
});

app.get('/v1/pulse/watchlists/:id/alerts', async (c) => {
  const wl = await loadWatchlist(c.req.param('id'));
  if (!wl) return c.json({ error: 'watchlist_not_found' }, 404);
  const alerts = await listAlertsForWatchlist(wl.watchlist_id);
  return c.json({ alerts });
});

app.post('/v1/pulse/watchlists/:id/check', async (c) => {
  const wl = await loadWatchlist(c.req.param('id'));
  if (!wl) return c.json({ error: 'watchlist_not_found' }, 404);

  if (inflight.has(wl.watchlist_id)) {
    return c.json({ error: 'check_in_progress', watchlist_id: wl.watchlist_id }, 409);
  }

  inflight.add(wl.watchlist_id);
  try {
    const result = await runWatchlistCheck(wl);
    return c.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'check_failed', message: msg }, 502);
  } finally {
    inflight.delete(wl.watchlist_id);
  }
});

const server = serve({ fetch: app.fetch, port });
console.log(`pulse listening on :${port}`);

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
