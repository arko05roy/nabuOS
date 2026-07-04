import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createDepsDevClient } from '@nabuos/deps-dev';
import {
  ArtifactError,
  fetchNpmArtifact,
  fetchNpmInventory,
} from '@nabuos/npm-artifact';
import {
  createNpmRegistryClient,
  NpmRegistryError,
} from '@nabuos/npm-registry';
import { createOsvClient } from '@nabuos/osv';
import {
  enrichNpmPackage,
  GuardTriageError,
  runGuardTriage,
} from '@nabuos/guard-triage';
import {
  fetchPypiArtifact,
  PypiArtifactError,
} from '@nabuos/pypi-artifact';
import {
  createPypiRegistryClient,
  isYanked,
  PypiRegistryError,
} from '@nabuos/pypi-registry';
import { createServiceApp } from '@nabuos/service-kit';
import type { AuditJob, CreateAuditRequest, GuardCheckResponse } from '@nabuos/types';
import {
  bindIdempotencyKey,
  createAuditId,
  findAuditByIdempotencyKey,
  findCompletedCheck,
  loadAudit,
  packageAuditKey,
  saveAudit,
} from './audit-store.js';
import { runNpmFastAudit } from './npm-fast-audit.js';

const port = Number(process.env.PORT ?? 3001);
const npm = createNpmRegistryClient();
const pypi = createPypiRegistryClient();
const depsDev = createDepsDevClient();
const osv = createOsvClient();

/** package key → audit_id while fast audit is in flight */
const inflight = new Map<string, string>();

const health = createServiceApp('guard');
const app = new Hono();

app.route('/', health);

function pypiArtifactStatus(err: PypiArtifactError): 400 | 422 | 502 {
  if (err.code === 'integrity_verification_failed' || err.code === 'no_digest_metadata') {
    return 422;
  }
  if (err.code === 'artifact_host_not_allowed' || err.code === 'invalid_artifact_url') {
    return 400;
  }
  if (err.code === 'all_yanked') return 422;
  return 502;
}

function artifactStatus(err: ArtifactError): 400 | 422 | 502 {
  if (err.code === 'integrity_verification_failed' || err.code === 'no_integrity_metadata') {
    return 422;
  }
  if (err.code === 'tarball_host_not_allowed' || err.code === 'invalid_tarball_url') {
    return 400;
  }
  return 502;
}

function initialPhases(): AuditJob['phases'] {
  return ['metadata', 'artifact', 'inventory', 'deps.dev', 'osv', 'triage'].map((name) => ({
    name,
    status: 'pending' as const,
  }));
}

function parseCreateAudit(body: unknown): CreateAuditRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'body must be a JSON object' };
  const b = body as Record<string, unknown>;
  const ecosystem = b.ecosystem;
  const name = b.name;
  const version = b.version;
  const depth = b.depth;
  if (ecosystem !== 'npm' && ecosystem !== 'pypi') {
    return { error: 'ecosystem must be npm or pypi' };
  }
  if (typeof name !== 'string' || !name.trim()) return { error: 'name is required' };
  if (typeof version !== 'string' || !version.trim()) return { error: 'version is required' };
  if (depth !== 'fast' && depth !== 'deep' && depth !== 'sandbox') {
    return { error: 'depth must be fast, deep, or sandbox' };
  }
  return { ecosystem, name: name.trim(), version: version.trim(), depth };
}

function scheduleNpmFastAudit(job: AuditJob): void {
  const key = packageAuditKey(job.ecosystem, job.name, job.version, job.depth);
  inflight.set(key, job.audit_id);
  void runNpmFastAudit(job, { npm, depsDev, osv }).finally(() => {
    inflight.delete(key);
  });
}

/** Epic 1.6 — unified fast audit job API */
app.post('/v1/guard/audits', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json', message: 'request body must be JSON' }, 400);
  }

  const parsed = parseCreateAudit(body);
  if ('error' in parsed) {
    return c.json({ error: 'invalid_request', message: parsed.error }, 400);
  }

  if (parsed.ecosystem !== 'npm') {
    return c.json(
      { error: 'unsupported_ecosystem', message: 'pypi audits ship in Sprint 2; npm only for now' },
      400,
    );
  }
  if (parsed.depth !== 'fast') {
    return c.json(
      {
        error: 'unsupported_depth',
        message: 'deep and sandbox audits ship in later sprints; fast only for now',
      },
      400,
    );
  }

  const idempotencyKey = c.req.header('Idempotency-Key')?.trim();
  if (idempotencyKey) {
    const existing = await findAuditByIdempotencyKey(idempotencyKey);
    if (existing) return c.json(existing, existing.status === 'completed' ? 200 : 202);
  }

  const pkgKey = packageAuditKey(parsed.ecosystem, parsed.name, parsed.version, parsed.depth);
  const runningId = inflight.get(pkgKey);
  if (runningId) {
    const running = await loadAudit(runningId);
    if (running) return c.json(running, 202);
  }

  const ts = new Date().toISOString();
  const job: AuditJob = {
    audit_id: createAuditId(),
    status: 'pending',
    ecosystem: parsed.ecosystem,
    name: parsed.name,
    version: parsed.version,
    depth: parsed.depth,
    fast_verdict: null,
    deep_verdict: null,
    phases: initialPhases(),
    created_at: ts,
    updated_at: ts,
  };

  if (idempotencyKey) await bindIdempotencyKey(idempotencyKey, job.audit_id);
  await saveAudit(job);
  scheduleNpmFastAudit(job);

  return c.json(job, 202);
});

app.get('/v1/guard/audits/:id', async (c) => {
  const auditId = c.req.param('id');
  const job = await loadAudit(auditId);
  if (!job) {
    return c.json({ error: 'audit_not_found', message: `no audit ${auditId}` }, 404);
  }
  return c.json(job);
});

app.get('/v1/guard/check', async (c) => {
  const ecosystem = c.req.query('ecosystem');
  const name = c.req.query('name');
  const version = c.req.query('version');

  if (ecosystem !== 'npm' && ecosystem !== 'pypi') {
    return c.json({ error: 'invalid_request', message: 'ecosystem query param required (npm|pypi)' }, 400);
  }
  if (!name?.trim() || !version?.trim()) {
    return c.json({ error: 'invalid_request', message: 'name and version query params required' }, 400);
  }

  const job = await findCompletedCheck(ecosystem, name.trim(), version.trim());
  if (!job || !job.fast_verdict) {
    const miss: GuardCheckResponse = {
      status: 'not_found',
      ecosystem,
      name: name.trim(),
      version: version.trim(),
    };
    return c.json(miss, 404);
  }

  const hit: GuardCheckResponse = {
    status: 'completed',
    audit_id: job.audit_id,
    ecosystem: job.ecosystem,
    name: job.name,
    version: job.version,
    artifact: job.artifact,
    fast_verdict: job.fast_verdict,
    updated_at: job.updated_at,
  };
  return c.json(hit);
});

/** PyPI project metadata (Epic 2.1) */
app.get('/v1/guard/pypi/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  try {
    const project = await pypi.getProject(name);
    return c.json({
      name: project.info.name,
      normalized_name: project.info.name.toLowerCase(),
      version: project.info.version,
      summary: project.info.summary,
      requires_python: project.info.requires_python,
      releases: Object.keys(project.releases).sort(),
    });
  } catch (err) {
    if (err instanceof PypiRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    throw err;
  }
});

app.get('/v1/guard/pypi/:name/:version', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await pypi.getVersion(name, version);
    return c.json({
      name: doc.name,
      normalized_name: doc.normalized_name,
      version: doc.version,
      requires_python: doc.requires_python,
      info: {
        summary: doc.info.summary,
        author: doc.info.author,
        license: doc.info.license,
        classifiers: doc.info.classifiers,
      },
      urls: doc.urls.map((f) => ({
        filename: f.filename,
        url: f.url,
        packagetype: f.packagetype,
        python_version: f.python_version,
        requires_python: f.requires_python,
        digests: f.digests,
        yanked: f.yanked,
        yanked_reason: f.yanked_reason,
      })),
      simple_files: doc.simple_files.map((f) => ({
        filename: f.filename,
        url: f.url,
        hashes: f.hashes,
        yanked: isYanked(f.yanked),
        yanked_reason: typeof f.yanked === 'string' ? f.yanked : null,
      })),
      yanked_files: doc.yanked_files.map((f) => f.filename),
      all_files_yanked: doc.all_files_yanked,
    });
  } catch (err) {
    if (err instanceof PypiRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    throw err;
  }
});

app.get('/v1/guard/pypi/:name/:version/artifact', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await pypi.getVersion(name, version);
    const artifact = await fetchPypiArtifact(name, version, doc.urls);
    return c.json(artifact);
  } catch (err) {
    if (err instanceof PypiRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    if (err instanceof PypiArtifactError) {
      return c.json({ error: err.code, message: err.message }, pypiArtifactStatus(err));
    }
    throw err;
  }
});

/** Live npm version doc — register before packument route */
app.get('/v1/guard/npm/:name/:version', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await npm.getVersion(name, version);
    return c.json({
      name,
      version: doc.version,
      dist: doc.dist,
      scripts: doc.scripts ?? {},
      dependencies: doc.dependencies ?? {},
      devDependencies: doc.devDependencies ?? {},
    });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    throw err;
  }
});

app.get('/v1/guard/npm/:name/:version/artifact', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await npm.getVersion(name, version);
    const artifact = await fetchNpmArtifact(name, version, doc);
    return c.json(artifact);
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    if (err instanceof ArtifactError) {
      return c.json({ error: err.code, message: err.message }, artifactStatus(err));
    }
    throw err;
  }
});

app.get('/v1/guard/npm/:name/:version/inventory', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await npm.getVersion(name, version);
    const { artifact, inventory } = await fetchNpmInventory(name, version, doc);
    return c.json({ artifact, inventory });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    if (err instanceof ArtifactError) {
      return c.json({ error: err.code, message: err.message }, artifactStatus(err));
    }
    throw err;
  }
});

/** deps.dev dependency graph (Epic 1.4) */
app.get('/v1/guard/npm/:name/:version/dependencies', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    await npm.getVersion(name, version);
    const graph = await depsDev.getNpmDependencies(name, version);
    return c.json({ name, version, ...graph });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    const graph = {
      nodes: [] as const,
      edges: [] as const,
      degraded: true,
      source: 'deps.dev' as const,
    };
    return c.json({
      name,
      version,
      ...graph,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

/** OSV batch + vuln details for graph packages (Epic 1.4) */
app.get('/v1/guard/npm/:name/:version/vulnerabilities', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    await npm.getVersion(name, version);
    const enrichment = await enrichNpmPackage(name, version, depsDev, osv);
    return c.json({
      name,
      version,
      dependency_graph: enrichment.dependency_graph,
      vulnerabilities: enrichment.vulnerabilities,
      phases: enrichment.phases,
    });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    throw err;
  }
});

/** BTL Runtime triage over metadata + inventory + OSV (Epic 1.5) */
app.get('/v1/guard/npm/:name/:version/triage', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  const version = c.req.param('version');
  try {
    const doc = await npm.getVersion(name, version);
    const { inventory } = await fetchNpmInventory(name, version, doc);
    const enrichment = await enrichNpmPackage(name, version, depsDev, osv);

    const triage = await runGuardTriage({
      name,
      version,
      metadata: {
        dist: doc.dist,
        scripts: doc.scripts ?? {},
        dependencies: doc.dependencies ?? {},
        devDependencies: doc.devDependencies,
      },
      inventory,
      dependency_graph: enrichment.dependency_graph,
      vulnerabilities: enrichment.vulnerabilities,
    });

    return c.json({
      name,
      version,
      phases: enrichment.phases,
      triage,
    });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    if (err instanceof ArtifactError) {
      return c.json({ error: err.code, message: err.message }, artifactStatus(err));
    }
    if (err instanceof GuardTriageError) {
      const status =
        err.code === 'btl_unconfigured' ? 503 : err.code === 'invalid_json' ? 502 : 502;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

app.get('/v1/guard/npm/:name', async (c) => {
  const name = decodeURIComponent(c.req.param('name'));
  try {
    const packument = await npm.getPackument(name);
    return c.json({ name, packument });
  } catch (err) {
    if (err instanceof NpmRegistryError) {
      return c.json({ error: err.code, message: err.message }, err.status === 404 ? 404 : 502);
    }
    throw err;
  }
});

const server = serve({ fetch: app.fetch, port });
console.log(`guard listening on :${port}`);

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
