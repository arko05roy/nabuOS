#!/usr/bin/env node
/** Live PyPI metadata smoke — guard on :3001. */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const cases = [
  { name: 'requests', version: '2.31.0' },
  { name: 'flask', version: '3.0.0' },
  { name: 'Django', version: '5.0.1' },
];

let failed = false;

for (const { name, version } of cases) {
  const path = `/v1/guard/pypi/${encodeURIComponent(name)}/${version}`;
  const res = await fetch(`${base}${path}`);
  const body = await res.json();
  const wheel = body.urls?.find((f) => f.packagetype === 'bdist_wheel');
  const ok =
    res.status === 200 &&
    body.version === version &&
    wheel?.digests?.sha256 &&
    body.simple_files?.length > 0 &&
    body.all_files_yanked === false;
  if (!ok) failed = true;
  console.log(
    `${ok ? 'ok' : 'FAIL'} ${name}==${version} -> ${res.status}`,
    ok ? `wheel=${wheel.filename} sha256=${wheel.digests.sha256.slice(0, 12)}…` : JSON.stringify(body),
  );
}

// Name normalization: Django → django
const normRes = await fetch(`${base}/v1/guard/pypi/Django`);
const normBody = await normRes.json();
if (normRes.status !== 200 || !normBody.releases?.includes('5.0.1')) {
  failed = true;
  console.log('FAIL Django project normalize', normRes.status, JSON.stringify(normBody));
} else {
  console.log('ok Django normalize', `latest=${normBody.version}`, `releases=${normBody.releases.length}`);
}

process.exit(failed ? 1 : 0);
