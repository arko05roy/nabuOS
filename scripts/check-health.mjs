#!/usr/bin/env node
/** Hit /healthz and /readyz on every nabuOS service. Requires services to be running. */
const services = [
  { name: 'api-gateway', port: 3100 },
  { name: 'guard', port: 3001 },
  { name: 'mind', port: 3002 },
  { name: 'vault', port: 3003 },
  { name: 'run', port: 3004 },
  { name: 'sandbox-worker', port: 3005 },
];

let failed = false;

for (const svc of services) {
  for (const path of ['/healthz', '/readyz']) {
    const url = `http://127.0.0.1:${svc.port}${path}`;
    try {
      const res = await fetch(url);
      const body = await res.json();
      const ok = path === '/healthz' ? res.status === 200 : res.status === 200 || res.status === 503;
      if (!ok) failed = true;
      console.log(
        `${ok ? 'ok' : 'FAIL'} ${svc.name}${path} -> ${res.status}`,
        JSON.stringify(body),
      );
    } catch (err) {
      failed = true;
      console.error(`FAIL ${svc.name}${path} ->`, err instanceof Error ? err.message : err);
    }
  }
}

process.exit(failed ? 1 : 0);
