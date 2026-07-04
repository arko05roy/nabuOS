#!/usr/bin/env node
/** Live PyPI inventory smoke — guard on :3001 (or GUARD_URL). */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const cases = [
  { name: 'requests', version: '2.31.0', minDeps: 4 },
  { name: 'flask', version: '3.0.0', minDeps: 4, consoleScript: 'flask' },
];

let failed = false;

for (const { name, version, minDeps, consoleScript } of cases) {
  const path = `/v1/guard/pypi/${encodeURIComponent(name)}/${version}/inventory`;
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  const ok =
    res.status === 200 &&
    body.artifact?.digest_verified === true &&
    body.inventory?.name &&
    body.inventory.requires_dist?.length >= minDeps &&
    body.inventory.files?.count > 0 &&
    body.inventory.sources?.length > 0 &&
    (!consoleScript || body.inventory.console_scripts?.[consoleScript]);
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok' : 'FAIL'} inventory ${name}==${version}`,
    ok
      ? `deps=${body.inventory.requires_dist.length} files=${body.inventory.files.count} sources=${body.inventory.sources.join(',')}`
      : JSON.stringify(body),
  );
}

process.exit(failed ? 1 : 0);
