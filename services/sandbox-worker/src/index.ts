import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createLogger, withTelemetry } from '@nabuos/otel';
import { createServiceApp } from '@nabuos/service-kit';
import type { CreateSandboxRunRequest, SandboxImage, SandboxRun } from '@nabuos/types';
import {
  SandboxError,
  assertAllowedExtractDir,
  createSandboxRunId,
  executeSandboxRun,
  loadSandboxRun,
  persistSandboxRun,
  probeSandboxRuntime,
  runNpmLifecycleSandbox,
  runPypiInstallSandbox,
  sandboxNodeImage,
  sandboxPythonImage,
} from '@nabuos/sandbox';

const port = Number(process.env.PORT ?? 3005);
const log = createLogger('sandbox-worker');
const health = createServiceApp('sandbox-worker', probeSandboxRuntime);
const app = withTelemetry(new Hono(), 'sandbox-worker');

app.route('/', health);

function parseCreateRun(body: unknown): CreateSandboxRunRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const extract_dir = b.extract_dir;
  const image = b.image;
  const command = b.command;

  if (typeof extract_dir !== 'string' || !extract_dir.trim()) {
    return { error: 'extract_dir is required' };
  }
  if (image !== 'node' && image !== 'python') {
    return { error: 'image must be node or python' };
  }
  if (!Array.isArray(command) || command.length === 0 || !command.every((c) => typeof c === 'string')) {
    return { error: 'command must be a non-empty string array' };
  }

  const req: CreateSandboxRunRequest = {
    extract_dir: extract_dir.trim(),
    image: image as SandboxImage,
    command,
  };

  if (typeof b.timeout_ms === 'number' && Number.isFinite(b.timeout_ms)) {
    req.timeout_ms = Math.max(1_000, Math.min(b.timeout_ms, 600_000));
  }
  if (typeof b.memory_mb === 'number' && Number.isFinite(b.memory_mb)) {
    req.memory_mb = Math.max(128, Math.min(b.memory_mb, 4096));
  }
  if (typeof b.cpus === 'number' && Number.isFinite(b.cpus)) {
    req.cpus = Math.max(0.25, Math.min(b.cpus, 4));
  }
  if (typeof b.audit_id === 'string') req.audit_id = b.audit_id;
  if (b.ecosystem === 'npm' || b.ecosystem === 'pypi') req.ecosystem = b.ecosystem;
  if (typeof b.name === 'string') req.name = b.name;
  if (typeof b.version === 'string') req.version = b.version;

  return req;
}

/** Start gVisor sandbox run (async). */
app.post('/v1/sandbox/runs', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
  }

  const parsed = parseCreateRun(body);
  if ('error' in parsed) {
    return c.json({ error: 'invalid_request', message: parsed.error }, 400);
  }

  const probe = await probeSandboxRuntime();
  if (!probe.ready) {
    return c.json(
      {
        error: 'sandbox_unavailable',
        message: probe.message ?? 'Docker + runsc runtime required',
        checks: probe.checks,
      },
      503,
    );
  }

  let artifactDir: string;
  try {
    artifactDir = assertAllowedExtractDir(parsed.extract_dir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'invalid_extract_dir', message }, 400);
  }

  const runId = createSandboxRunId();
  const ts = new Date().toISOString();
  const imageTag = parsed.image === 'python' ? sandboxPythonImage() : sandboxNodeImage();
  const pending: SandboxRun = {
    run_id: runId,
    status: 'pending',
    runtime: 'runsc',
    network_mode: 'none',
    image: imageTag,
    command: parsed.command,
    resource_limits: {
      memory_mb: parsed.memory_mb ?? 512,
      cpus: parsed.cpus ?? 1,
      timeout_ms: parsed.timeout_ms ?? 120_000,
    },
    mounts: {
      artifact: { host: artifactDir, container: '/artifact', mode: 'ro' },
      scratch: { host: '', container: '/scratch', mode: 'rw' },
    },
    stdout: '',
    stderr: '',
    files_written: [],
    network_probe_failed: false,
    raw_log_path: '',
    audit_id: parsed.audit_id,
    ecosystem: parsed.ecosystem,
    name: parsed.name,
    version: parsed.version,
    created_at: ts,
    updated_at: ts,
  };

  await persistSandboxRun(pending);

  void executeSandboxRun({
    run_id: runId,
    extract_dir: artifactDir,
    image: parsed.image,
    command: parsed.command,
    timeout_ms: parsed.timeout_ms,
    memory_mb: parsed.memory_mb,
    cpus: parsed.cpus,
  }).catch((err) => {
    log.error('sandbox run failed', {
      run_id: runId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  return c.json(pending, 202);
});

app.get('/v1/sandbox/runs/:id', async (c) => {
  const runId = c.req.param('id');
  const run = await loadSandboxRun(runId);
  if (!run) {
    return c.json({ error: 'run_not_found', message: `no sandbox run ${runId}` }, 404);
  }
  return c.json(run);
});

/** Epic 4.3 — npm lifecycle in gVisor (sync; may take minutes). */
app.post('/v1/sandbox/npm-lifecycle', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
  }
  const b = body as Record<string, unknown>;
  const extract_dir = b.extract_dir;
  const scripts = b.scripts;
  if (typeof extract_dir !== 'string' || !extract_dir.trim()) {
    return c.json({ error: 'invalid_request', message: 'extract_dir is required' }, 400);
  }
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts)) {
    return c.json({ error: 'invalid_request', message: 'scripts object is required' }, 400);
  }

  const probe = await probeSandboxRuntime();
  if (!probe.ready) {
    return c.json({ error: 'sandbox_unavailable', message: probe.message, checks: probe.checks }, 503);
  }

  let artifactDir: string;
  try {
    artifactDir = assertAllowedExtractDir(extract_dir.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'invalid_extract_dir', message }, 400);
  }

  const sandbox = await runNpmLifecycleSandbox({
    extract_dir: artifactDir,
    inventory: { scripts: scripts as Record<string, string> },
    audit_id: typeof b.audit_id === 'string' ? b.audit_id : undefined,
    name: typeof b.name === 'string' ? b.name : undefined,
    version: typeof b.version === 'string' ? b.version : undefined,
  });
  return c.json(sandbox, 200);
});

/** Epic 4.4 — PyPI install/compile in gVisor (sync). */
app.post('/v1/sandbox/pypi-install', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
  }
  const b = body as Record<string, unknown>;
  const extract_dir = b.extract_dir;
  const inventory = b.inventory;
  if (typeof extract_dir !== 'string' || !extract_dir.trim()) {
    return c.json({ error: 'invalid_request', message: 'extract_dir is required' }, 400);
  }
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    return c.json({ error: 'invalid_request', message: 'inventory object is required' }, 400);
  }

  const probe = await probeSandboxRuntime();
  if (!probe.ready) {
    return c.json({ error: 'sandbox_unavailable', message: probe.message, checks: probe.checks }, 503);
  }

  let artifactDir: string;
  try {
    artifactDir = assertAllowedExtractDir(extract_dir.trim());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'invalid_extract_dir', message }, 400);
  }

  const inv = inventory as {
    metadata_source: string;
    files: { paths: string[]; count?: number; total_bytes?: number; extensions?: Record<string, number> };
  };
  const sandbox = await runPypiInstallSandbox({
    extract_dir: artifactDir,
    inventory: {
      metadata_source: inv.metadata_source as
        | 'setup.py'
        | 'pyproject.toml'
        | 'setup.cfg'
        | 'METADATA'
        | 'PKG-INFO'
        | 'unknown',
      files: {
        paths: inv.files.paths,
        count: inv.files.count ?? inv.files.paths.length,
        total_bytes: inv.files.total_bytes ?? 0,
        extensions: inv.files.extensions ?? {},
      },
    },
    audit_id: typeof b.audit_id === 'string' ? b.audit_id : undefined,
    name: typeof b.name === 'string' ? b.name : undefined,
    version: typeof b.version === 'string' ? b.version : undefined,
  });
  return c.json(sandbox, 200);
});

app.onError((err, c) => {
  if (err instanceof SandboxError) {
    const status =
      err.code === 'invalid_extract_dir'
        ? 400
        : err.code === 'docker_missing' || err.code === 'runsc_missing'
          ? 503
          : 500;
    return c.json({ error: err.code, message: err.message }, status);
  }
  log.error('sandbox-worker error', { error: err instanceof Error ? err.message : String(err) });
  return c.json({ error: 'internal_error', message: 'unexpected error' }, 500);
});

const server = serve({ fetch: app.fetch, port });
log.info(`sandbox-worker listening on :${port}`);

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
