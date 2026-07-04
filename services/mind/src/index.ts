import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { btlRuntimeFromEnv } from '@nabuos/btl-runtime';
import { createServiceApp } from '@nabuos/service-kit';
import type { CreateMindRunRequest, MindMode, MindRun } from '@nabuos/types';
import { runMindEngine } from './mind-engine.js';
import {
  bindMindIdempotencyKey,
  createMindRunId,
  findMindRunByIdempotencyKey,
  loadMindRun,
  saveMindRun,
} from './run-store.js';

const port = Number(process.env.PORT ?? 3002);

const health = createServiceApp('mind', async () => {
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

const app = new Hono();
app.route('/', health);

const inflight = new Set<string>();

function parseCreateMindRun(body: unknown): CreateMindRunRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const goal = b.goal;
  const mode = b.mode;
  if (typeof goal !== 'string' || !goal.trim()) return { error: 'goal is required' };
  const modes: MindMode[] = ['brief', 'deep', 'policy', 'incident'];
  if (!modes.includes(mode as MindMode)) {
    return { error: 'mode must be brief, deep, policy, or incident' };
  }
  const context_refs = Array.isArray(b.context_refs)
    ? b.context_refs
        .filter((r): r is { type: string; id: string } => {
          return !!r && typeof r === 'object' && typeof (r as { type?: string }).type === 'string';
        })
        .map((r) => ({ type: r.type, id: String((r as { id?: unknown }).id ?? '') }))
        .filter((r) => r.id.length > 0)
    : undefined;

  return { goal: goal.trim(), mode: mode as MindMode, context_refs };
}

function scheduleMindRun(run: MindRun): void {
  inflight.add(run.mind_run_id);
  void runMindEngine(run).finally(() => {
    inflight.delete(run.mind_run_id);
  });
}

app.post('/v1/mind/runs', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
  }

  const parsed = parseCreateMindRun(body);
  if ('error' in parsed) {
    return c.json({ error: 'invalid_request', message: parsed.error }, 400);
  }

  if (!parsed.context_refs?.length) {
    return c.json(
      { error: 'invalid_request', message: 'context_refs must include at least one guard_audit or package ref' },
      400,
    );
  }

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (idempotencyKey) {
    const existing = await findMindRunByIdempotencyKey(idempotencyKey);
    if (existing) return c.json(existing, existing.status === 'completed' ? 200 : 202);
  }

  const ts = new Date().toISOString();
  const run: MindRun = {
    mind_run_id: createMindRunId(),
    status: 'pending',
    goal: parsed.goal,
    mode: parsed.mode,
    context_refs: parsed.context_refs,
    steps: [],
    evidence: [],
    bt_runtime: { request_ids: [], total_charge: 0, total_saved: 0 },
    created_at: ts,
    updated_at: ts,
  };

  if (idempotencyKey) await bindMindIdempotencyKey(idempotencyKey, run.mind_run_id);
  await saveMindRun(run);
  scheduleMindRun(run);

  return c.json(run, 202);
});

app.get('/v1/mind/runs/:id', async (c) => {
  const mindRunId = c.req.param('id');
  const run = await loadMindRun(mindRunId);
  if (!run) {
    return c.json({ error: 'mind_run_not_found', message: `no mind run ${mindRunId}` }, 404);
  }
  return c.json(run);
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
