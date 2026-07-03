import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createServiceApp } from '@nabuos/service-kit';
import {
  ArtifactError,
  fetchNpmArtifact,
  fetchNpmInventory,
} from '@nabuos/npm-artifact';
import {
  createNpmRegistryClient,
  NpmRegistryError,
} from '@nabuos/npm-registry';

const port = Number(process.env.PORT ?? 3001);
const npm = createNpmRegistryClient();

const health = createServiceApp('guard');
const app = new Hono();

app.route('/', health);

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

/** Download tarball, verify dist.integrity, store + extract (Epic 1.2) */
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
      const status =
        err.code === 'integrity_verification_failed' || err.code === 'no_integrity_metadata'
          ? 422
          : err.code === 'tarball_host_not_allowed' || err.code === 'invalid_tarball_url'
            ? 400
            : 502;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

/** Inventory from extracted tarball — scripts, deps, entrypoints, file stats (Epic 1.3) */
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
      const status =
        err.code === 'integrity_verification_failed' || err.code === 'no_integrity_metadata'
          ? 422
          : err.code === 'tarball_host_not_allowed' || err.code === 'invalid_tarball_url'
            ? 400
            : 502;
      return c.json({ error: err.code, message: err.message }, status);
    }
    throw err;
  }
});

/** Live npm packument from registry.npmjs.org */
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
