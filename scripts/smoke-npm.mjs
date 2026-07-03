#!/usr/bin/env node
/** Live npm registry smoke — hits guard service (must be running on :3001). */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const cases = [
  { name: 'axios', version: '1.6.0' },
  { name: 'lodash', version: '4.17.21' },
  { name: '@babel/core', version: '7.26.0' },
];

let failed = false;

for (const { name, version } of cases) {
  const path = `/v1/guard/npm/${encodeURIComponent(name)}/${version}`;
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  const ok = res.status === 200 && body.dist?.tarball;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok' : 'FAIL'} ${name}@${version} -> ${res.status}`,
    ok ? body.dist.tarball : JSON.stringify(body),
  );
}

process.exit(failed ? 1 : 0);
