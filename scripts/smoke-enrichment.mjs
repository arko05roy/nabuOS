#!/usr/bin/env node
/** Live deps.dev + OSV smoke — guard on :3001, real upstream APIs only. */
const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = 'axios';
const version = '1.6.0';
const enc = encodeURIComponent(name);

let failed = false;

const depsRes = await fetch(`${base}/v1/guard/npm/${enc}/${version}/dependencies`);
const deps = await depsRes.json();
const depsOk =
  depsRes.status === 200 &&
  deps.nodes?.length > 0 &&
  deps.nodes.some((n) => n.relation === 'SELF') &&
  deps.edges?.length > 0;
if (!depsOk) failed = true;
console.log(
  `${depsOk ? 'ok' : 'FAIL'} dependencies ${name}@${version} -> ${depsRes.status}`,
  depsOk ? `nodes=${deps.nodes.length} edges=${deps.edges.length}` : JSON.stringify(deps),
);

const vulnRes = await fetch(`${base}/v1/guard/npm/${enc}/${version}/vulnerabilities`);
const vulnBody = await vulnRes.json();
const vulnOk =
  vulnRes.status === 200 &&
  vulnBody.vulnerabilities?.packages_queried > 0 &&
  vulnBody.phases?.some((p) => p.name === 'osv' && p.status === 'completed');
if (!vulnOk) failed = true;
console.log(
  `${vulnOk ? 'ok' : 'FAIL'} vulnerabilities ${name}@${version} -> ${vulnRes.status}`,
  vulnOk
    ? `queried=${vulnBody.vulnerabilities.packages_queried} refs=${vulnBody.vulnerabilities.total_vuln_refs}`
    : JSON.stringify(vulnBody),
);

process.exit(failed ? 1 : 0);
