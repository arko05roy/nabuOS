import { serve } from '@hono/node-server';
import { createServiceApp } from '@nabuos/service-kit';

const port = Number(process.env.PORT ?? 3100);
const app = createServiceApp('api-gateway');

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
