#!/usr/bin/env node
/** Live deep audit + auto Mind incident — guard :3001, mind :3002, semgrep on PATH, GATEWAY_API_KEY required. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const envPath = resolve(process.cwd(), '.env');
  const lines = readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env */
}

if (!process.env.GATEWAY_API_KEY) {
  console.error('FAIL GATEWAY_API_KEY required for smoke:deep-audit-mind');
  process.exit(1);
}

const guardBase = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const mindBase = process.env.MIND_URL ?? 'http://127.0.0.1:3002';
const name = 'node-ipc';
const version = '9.1.1';

const createRes = await fetch(`${guardBase}/v1/guard/audits`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': `smoke:deep-mind:${name}:${version}`,
  },
  body: JSON.stringify({ ecosystem: 'npm', name, version, depth: 'deep' }),
});
const created = await createRes.json();

if (createRes.status !== 202 || !created.audit_id) {
  console.log('FAIL create deep audit', createRes.status, JSON.stringify(created));
  process.exit(1);
}

let job = created;
const deadline = Date.now() + 300_000;
while (job.status === 'pending' || job.status === 'running') {
  if (Date.now() > deadline) {
    console.log('FAIL deep audit timeout', JSON.stringify(job));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 3000));
  job = await (await fetch(`${guardBase}/v1/guard/audits/${created.audit_id}`)).json();
}

if (job.status !== 'completed') {
  console.log('FAIL deep audit status', job.status, JSON.stringify(job));
  process.exit(1);
}

const mindPhase = job.phases.find((p) => p.name === 'mind_investigation');
const highRisk = (job.semgrep?.findings ?? []).some(
  (f) => f.severity === 'critical' || f.severity === 'high',
);

if (!highRisk) {
  console.log('FAIL expected high-risk semgrep findings on node-ipc for mind trigger smoke');
  process.exit(1);
}

if (!job.mind_investigation?.mind_run_id || mindPhase?.status !== 'completed') {
  console.log('FAIL mind_investigation not triggered', JSON.stringify({ job, mindPhase }));
  process.exit(1);
}

let mindRun = await (await fetch(`${mindBase}/v1/mind/runs/${job.mind_investigation.mind_run_id}`)).json();
const mindDeadline = Date.now() + 180_000;
while (mindRun.status === 'pending' || mindRun.status === 'running') {
  if (Date.now() > mindDeadline) {
    console.log('FAIL mind run timeout', JSON.stringify(mindRun));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  mindRun = await (await fetch(`${mindBase}/v1/mind/runs/${job.mind_investigation.mind_run_id}`)).json();
}

const ok =
  mindRun.status === 'completed' &&
  mindRun.decision &&
  mindRun.evidence?.some((e) => e.type === 'semgrep_finding' || e.type === 'semgrep_summary');

if (!ok) {
  console.log('FAIL mind incident run', JSON.stringify(mindRun));
  process.exit(1);
}

console.log(
  'ok deep-audit-mind',
  created.audit_id,
  `mind=${job.mind_investigation.mind_run_id}`,
  `decision=${mindRun.decision}`,
  `deep=${job.deep_verdict?.verdict}/${job.deep_verdict?.score}`,
  `semgrep=${job.semgrep?.finding_count}`,
);
