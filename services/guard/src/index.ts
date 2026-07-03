import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { createServiceApp } from '@nabuos/service-kit';
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
