#!/usr/bin/env node
/** Live sandbox audit job — guard :3001, Docker+runsc, GATEWAY_API_KEY, semgrep on PATH. */
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

const sandboxUrl = process.env.SANDBOX_URL ?? 'http://127.0.0.1:3005';
const ready = await fetch(`${sandboxUrl}/readyz`);
const readyBody = await ready.json();
if (!ready.ok || !readyBody.ready) {
  console.log('SKIP sandbox audit smoke — runtime not ready:', JSON.stringify(readyBody));
  process.exit(0);
}

if (!process.env.GATEWAY_API_KEY) {
  console.error('FAIL GATEWAY_API_KEY required for sandbox audit (triage phase)');
  process.exit(1);
}

const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = process.env.SANDBOX_AUDIT_PKG ?? 'lodash';
const version = process.env.SANDBOX_AUDIT_VERSION ?? '4.17.21';

const createRes = await fetch(`${base}/v1/guard/audits`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ecosystem: 'npm', name, version, depth: 'sandbox' }),
});
const created = await createRes.json();

if (createRes.status !== 202 || !created.audit_id) {
  console.log('FAIL create sandbox audit', createRes.status, JSON.stringify(created));
  process.exit(1);
}

let job = created;
const deadline = Date.now() + 600_000;
while (job.status === 'pending' || job.status === 'running') {
  if (Date.now() > deadline) {
    console.log('FAIL sandbox audit timeout', JSON.stringify(job));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 5000));
  const poll = await fetch(`${base}/v1/guard/audits/${created.audit_id}`);
  job = await poll.json();
}

if (job.status !== 'completed') {
  console.log('FAIL sandbox audit status', job.status, JSON.stringify(job));
  process.exit(1);
}

const sandboxPhase = job.phases.find((p) => p.name === 'sandbox');
const ok =
  job.fast_verdict &&
  job.deep_verdict &&
  job.sandbox &&
  job.sandbox.phase === 'npm_lifecycle' &&
  typeof job.sandbox.network_isolated === 'boolean' &&
  sandboxPhase &&
  (sandboxPhase.status === 'completed' || sandboxPhase.status === 'failed') &&
  job.deep_verdict.scoring_version === 'guard-score-v0.3';

if (!ok) {
  console.log('FAIL sandbox audit result', JSON.stringify(job));
  process.exit(1);
}

console.log(
  'ok sandbox audit',
  created.audit_id,
  `${name}@${version}`,
  `fast=${job.fast_verdict.verdict}/${job.fast_verdict.score}`,
  `deep=${job.deep_verdict.verdict}/${job.deep_verdict.score}`,
  `sandbox=${job.sandbox.status}`,
  `network_isolated=${job.sandbox.network_isolated}`,
  `hard_blocks=${job.sandbox.hard_block_signals.length}`,
);
