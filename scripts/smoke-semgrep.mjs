#!/usr/bin/env node
/** Live Semgrep per-route — guard :3001, semgrep on PATH. */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

async function checkSemgrepRoute(path, label) {
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  if (res.status !== 200 || !body.semgrep || typeof body.semgrep.finding_count !== 'number') {
    console.log(`FAIL ${label}`, res.status, JSON.stringify(body));
    process.exit(1);
  }
  console.log(
    `ok ${label}`,
    `findings=${body.semgrep.finding_count}`,
    `duration=${body.semgrep.scan_duration_ms}ms`,
    body.semgrep.raw_path ? `raw=${body.semgrep.raw_path}` : '',
  );
}

await checkSemgrepRoute('/v1/guard/npm/lodash/4.17.21/semgrep', 'npm semgrep');
await checkSemgrepRoute('/v1/guard/pypi/requests/2.31.0/semgrep', 'pypi semgrep');
