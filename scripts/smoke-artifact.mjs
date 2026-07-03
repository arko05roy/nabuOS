#!/usr/bin/env node
/** Live artifact + inventory smoke — guard on :3001, real npm tarballs only. */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const cases = [
  { name: 'axios', version: '1.6.0', minFiles: 10 },
  { name: 'lodash', version: '4.17.21', minFiles: 10 },
];

let failed = false;

for (const { name, version, minFiles } of cases) {
  const enc = encodeURIComponent(name);
  const artifactPath = `/v1/guard/npm/${enc}/${version}/artifact`;
  const artifactRes = await fetch(`${base}${artifactPath}`);
  const artifact = await artifactRes.json();

  const artifactOk =
    artifactRes.status === 200 &&
    artifact.integrity_verified === true &&
    artifact.sha256?.length === 64 &&
    artifact.extracted_file_count >= minFiles &&
    artifact.extracted_files?.includes('package.json');

  if (!artifactOk) failed = true;
  console.log(
    `${artifactOk ? 'ok' : 'FAIL'} artifact ${name}@${version} -> ${artifactRes.status}`,
    artifactOk
      ? `sha256=${artifact.sha256.slice(0, 12)}… files=${artifact.extracted_file_count} weak=${artifact.integrity_weak}`
      : JSON.stringify(artifact),
  );

  const invRes = await fetch(`${base}/v1/guard/npm/${enc}/${version}/inventory`);
  const invBody = await invRes.json();
  const inv = invBody.inventory;

  const invOk =
    invRes.status === 200 &&
    inv?.name === name &&
    inv?.version === version &&
    inv?.files?.count >= minFiles &&
    typeof inv?.dependencies === 'object' &&
    inv?.entrypoints?.main;

  if (!invOk) failed = true;
  console.log(
    `${invOk ? 'ok' : 'FAIL'} inventory ${name}@${version} -> ${invRes.status}`,
    invOk
      ? `files=${inv.files.count} deps=${Object.keys(inv.dependencies).length} main=${inv.entrypoints.main}`
      : JSON.stringify(invBody),
  );
}

// Tampered integrity must fail (local, uses real axios@1.6.0 SRI from registry.npmjs.org)
const { verifySriIntegrity } = await import('../packages/npm-artifact/dist/index.js');
const bad = verifySriIntegrity(Buffer.from('tampered'), 'sha512-EZ1DYihju9pwVB+jg67ogm+Tmqc6JmhamRN6I4Zt8DfZu5lbcQGw3ozH9lFejSJgs/ibaef3A9PMXPLeefFGJg==');
if (bad.ok) {
  failed = true;
  console.log('FAIL tampered buffer must not verify axios integrity');
} else {
  console.log('ok tampered integrity rejected locally');
}

process.exit(failed ? 1 : 0);
