#!/usr/bin/env node
/** Live deep audit with real Semgrep — guard on :3001, semgrep on PATH, GATEWAY_API_KEY for triage. */
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
  console.error('FAIL GATEWAY_API_KEY required for smoke:deep-audit (triage phase)');
  process.exit(1);
}

const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = 'lodash';
const version = '4.17.21';

const createRes = await fetch(`${base}/v1/guard/audits`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
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
  const poll = await fetch(`${base}/v1/guard/audits/${created.audit_id}`);
  job = await poll.json();
}

if (job.status !== 'completed') {
  console.log('FAIL deep audit status', job.status, JSON.stringify(job));
  process.exit(1);
}

const semgrepPhase = job.phases.find((p) => p.name === 'semgrep');
const ok =
  job.fast_verdict &&
  job.deep_verdict &&
  job.semgrep &&
  typeof job.semgrep.finding_count === 'number' &&
  job.semgrep.raw_path &&
  semgrepPhase?.status === 'completed' &&
  job.deep_verdict.scoring_version === 'guard-score-v0.2';

if (!ok) {
  console.log('FAIL deep audit result', JSON.stringify(job));
  process.exit(1);
}

console.log(
  'ok deep audit',
  created.audit_id,
  `${name}@${version}`,
  `fast=${job.fast_verdict.verdict}/${job.fast_verdict.score}`,
  `deep=${job.deep_verdict.verdict}/${job.deep_verdict.score}`,
  `semgrep_findings=${job.semgrep.finding_count}`,
);
