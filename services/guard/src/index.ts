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
import { createServiceApp } from '@nabuos/service-kit';

const port = Number(process.env.PORT ?? 3001);
const npm = createNpmRegistryClient();
const depsDev = createDepsDevClient();
const osv = createOsvClient();

const health = createServiceApp('guard');
const app = new Hono();

app.route('/', health);

function artifactStatus(err: ArtifactError): 400 | 422 | 502 {
  if (err.code === 'integrity_verification_failed' || err.code === 'no_integrity_metadata') {
    return 422;
  }
  if (err.code === 'tarball_host_not_allowed' || err.code === 'invalid_tarball_url') {
    return 400;
  }
  return 502;
}

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
