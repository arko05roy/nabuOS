#!/usr/bin/env node
/** Live PyPI artifact smoke — guard on :3001 (or GUARD_URL). */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const cases = [
  { name: 'requests', version: '2.31.0', minFiles: 20 },
  { name: 'flask', version: '3.0.0', minFiles: 20 },
];

let failed = false;

for (const { name, version, minFiles } of cases) {
  const path = `/v1/guard/pypi/${encodeURIComponent(name)}/${version}/artifact`;
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  const ok =
    res.status === 200 &&
    body.digest_verified === true &&
    body.packagetype === 'bdist_wheel' &&
    body.extracted_file_count >= minFiles &&
    body.sha256?.length === 64;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok' : 'FAIL'} ${name}==${version} artifact`,
    ok
      ? `${body.filename} files=${body.extracted_file_count} sha256=${body.sha256.slice(0, 12)}…`
      : JSON.stringify(body),
  );
}

process.exit(failed ? 1 : 0);
