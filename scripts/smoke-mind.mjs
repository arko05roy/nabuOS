#!/usr/bin/env node
/** Live Mind API over Guard audit — mind :3002, guard :3001, GATEWAY_API_KEY required. */
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
  console.error('FAIL GATEWAY_API_KEY required for smoke:mind');
  process.exit(1);
}

const guardBase = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const mindBase = process.env.MIND_URL ?? 'http://127.0.0.1:3002';
const name = 'axios';
const version = '1.6.0';

let auditId;
const checkRes = await fetch(
  `${guardBase}/v1/guard/check?ecosystem=npm&name=${encodeURIComponent(name)}&version=${version}`,
);
if (checkRes.status === 200) {
  const check = await checkRes.json();
  auditId = check.audit_id;
}

if (!auditId) {
  const createRes = await fetch(`${guardBase}/v1/guard/audits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ecosystem: 'npm', name, version, depth: 'fast' }),
  });
  const created = await createRes.json();
  if (createRes.status !== 202 || !created.audit_id) {
    console.log('FAIL create guard audit', createRes.status, JSON.stringify(created));
    process.exit(1);
  }
  auditId = created.audit_id;
  const deadline = Date.now() + 120_000;
  let job = created;
  while (job.status === 'pending' || job.status === 'running') {
    if (Date.now() > deadline) {
      console.log('FAIL guard audit timeout');
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, 2000));
    job = await (await fetch(`${guardBase}/v1/guard/audits/${auditId}`)).json();
  }
  if (job.status !== 'completed') {
    console.log('FAIL guard audit', job.status);
    process.exit(1);
  }
}

const mindRes = await fetch(`${mindBase}/v1/mind/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    goal: `Should I use ${name} ${version} in a production agent?`,
    mode: 'brief',
    context_refs: [{ type: 'guard_audit', id: auditId }],
  }),
});
const mindRun = await mindRes.json();

if (mindRes.status !== 202 || !mindRun.mind_run_id) {
  console.log('FAIL create mind run', mindRes.status, JSON.stringify(mindRun));
  process.exit(1);
}

let run = mindRun;
const deadline = Date.now() + 180_000;
while (run.status === 'pending' || run.status === 'running') {
  if (Date.now() > deadline) {
    console.log('FAIL mind run timeout', JSON.stringify(run));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  run = await (await fetch(`${mindBase}/v1/mind/runs/${mindRun.mind_run_id}`)).json();
}

const stepTypes = run.steps?.map((s) => s.type) ?? [];
const ok =
  run.status === 'completed' &&
  run.decision &&
  run.summary &&
  stepTypes.includes('plan') &&
  stepTypes.includes('gather') &&
  stepTypes.includes('critique') &&
  stepTypes.includes('decide') &&
  stepTypes.includes('report') &&
  run.evidence?.some((e) => e.type === 'guard_audit' || e.type === 'guard_verdict');

if (!ok) {
  console.log('FAIL mind run', JSON.stringify(run));
  process.exit(1);
}

console.log(
  'ok mind',
  run.mind_run_id,
  `decision=${run.decision}`,
  `confidence=${run.confidence}`,
  `steps=${stepTypes.length}`,
  `evidence=${run.evidence.length}`,
  `btl_calls=${run.bt_runtime.request_ids.length}`,
);
