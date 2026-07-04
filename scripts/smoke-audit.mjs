#!/usr/bin/env node
/** Live public audit API — guard on :3001, GATEWAY_API_KEY for triage phase. */
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
  console.error('FAIL GATEWAY_API_KEY required for smoke:audit (triage phase)');
  process.exit(1);
}

const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = 'axios';
const version = '1.6.0';
const idempotencyKey = `smoke-audit:npm:${name}:${version}:${Date.now()}`;

const createRes = await fetch(`${base}/v1/guard/audits`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey,
  },
  body: JSON.stringify({ ecosystem: 'npm', name, version, depth: 'fast' }),
});
const created = await createRes.json();

if (createRes.status !== 202 || !created.audit_id) {
  console.log('FAIL create audit', createRes.status, JSON.stringify(created));
  process.exit(1);
}

let job = created;
const deadline = Date.now() + 120_000;
while (job.status === 'pending' || job.status === 'running') {
  if (Date.now() > deadline) {
    console.log('FAIL audit timeout', JSON.stringify(job));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  const poll = await fetch(`${base}/v1/guard/audits/${created.audit_id}`);
  job = await poll.json();
}

if (job.status !== 'completed') {
  console.log('FAIL audit status', job.status, JSON.stringify(job));
  process.exit(1);
}

const verdict = job.fast_verdict;
const ok =
  verdict &&
  typeof verdict.score === 'number' &&
  ['allow', 'warn', 'block'].includes(verdict.verdict) &&
  job.artifact?.integrity_verified === true &&
  job.phases.some((p) => p.name === 'triage' && p.status === 'completed');

if (!ok) {
  console.log('FAIL audit verdict', JSON.stringify(job));
  process.exit(1);
}

const checkRes = await fetch(
  `${base}/v1/guard/check?ecosystem=npm&name=${encodeURIComponent(name)}&version=${version}`,
);
const check = await checkRes.json();

if (checkRes.status !== 200 || check.status !== 'completed' || check.audit_id !== created.audit_id) {
  console.log('FAIL check', checkRes.status, JSON.stringify(check));
  process.exit(1);
}

console.log(
  'ok audit',
  created.audit_id,
  `${name}@${version}`,
  `verdict=${verdict.verdict}`,
  `score=${verdict.score}`,
  `phases=${job.phases.filter((p) => p.status === 'completed').length}`,
);
