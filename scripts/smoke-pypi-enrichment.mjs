#!/usr/bin/env node
/** Live PyPI inventory + deps.dev/OSV smoke — guard on :3001 (or GUARD_URL). */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = 'requests';
const version = '2.31.0';
const enc = encodeURIComponent(name);

let failed = false;

const invRes = await fetch(`${base}/v1/guard/pypi/${enc}/${version}/inventory`);
const inv = await invRes.json();
const invOk =
  invRes.status === 200 &&
  inv.inventory?.metadata_source === 'METADATA' &&
  inv.inventory?.requires_dist?.length >= 2 &&
  inv.inventory?.files?.count > 0;
if (!invOk) failed = true;
console.log(
  `${invOk ? 'ok' : 'FAIL'} inventory ${name}==${version}`,
  invOk
    ? `deps=${inv.inventory.requires_dist.length} files=${inv.inventory.files.count} python=${inv.inventory.requires_python}`
    : JSON.stringify(inv),
);

const depRes = await fetch(`${base}/v1/guard/pypi/${enc}/${version}/dependencies`);
const dep = await depRes.json();
const depOk = depRes.status === 200 && dep.nodes?.length > 0;
if (!depOk) failed = true;
console.log(
  `${depOk ? 'ok' : 'FAIL'} dependencies`,
  depOk ? `nodes=${dep.nodes.length} edges=${dep.edges?.length ?? 0}` : JSON.stringify(dep),
);

const vulnRes = await fetch(`${base}/v1/guard/pypi/${enc}/${version}/vulnerabilities`);
const vuln = await vulnRes.json();
const vulnOk =
  vulnRes.status === 200 &&
  vuln.phases?.some((p) => p.name === 'osv' && p.status === 'completed') &&
  typeof vuln.vulnerabilities?.packages_queried === 'number';
if (!vulnOk) failed = true;
console.log(
  `${vulnOk ? 'ok' : 'FAIL'} vulnerabilities`,
  vulnOk
    ? `queried=${vuln.vulnerabilities.packages_queried} refs=${vuln.vulnerabilities.total_vuln_refs}`
    : JSON.stringify(vuln),
);

process.exit(failed ? 1 : 0);
