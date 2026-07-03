import { serve } from '@hono/node-server';
import { createServiceApp } from '@nabuos/service-kit';

const port = Number(process.env.PORT ?? 3005);
const app = createServiceApp('sandbox-worker');

const server = serve({ fetch: app.fetch, port });
console.log(`sandbox-worker listening on :${port}`);

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
