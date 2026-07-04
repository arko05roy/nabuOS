#!/usr/bin/env node
/**
 * Live Run deploy + job — guard :3001, vault :3003, GATEWAY_API_KEY.
 * Uses real npm skill axios@1.6.0 and env BTL secret handle.
 */
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
  console.error('FAIL GATEWAY_API_KEY required for smoke:run');
  process.exit(1);
}

const runBase = process.env.RUN_URL ?? 'http://127.0.0.1:3004';
const guardBase = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';

const skillCandidates = [
  { ecosystem: 'npm', name: 'ms', version: '2.1.3' },
  { ecosystem: 'npm', name: 'zod', version: '3.23.8' },
  { ecosystem: 'npm', name: 'chalk', version: '5.3.0' },
  { ecosystem: 'npm', name: 'uuid', version: '9.0.1' },
];

async function ensureFastAudit(skill) {
  const checkRes = await fetch(
    `${guardBase}/v1/guard/check?ecosystem=${skill.ecosystem}&name=${encodeURIComponent(skill.name)}&version=${skill.version}`,
  );
  if (checkRes.status === 200) return (await checkRes.json()).fast_verdict;

  const auditRes = await fetch(`${guardBase}/v1/guard/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `smoke-run-preflight:${skill.ecosystem}:${skill.name}:${skill.version}`,
    },
    body: JSON.stringify({ ...skill, depth: 'fast' }),
  });
  const audit = await auditRes.json();
  if (!audit.audit_id) throw new Error(`preflight audit failed ${auditRes.status}`);

  const deadline = Date.now() + 120_000;
  let job = audit;
  while (job.status === 'pending' || job.status === 'running') {
    if (Date.now() > deadline) throw new Error('preflight audit timeout');
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${guardBase}/v1/guard/audits/${audit.audit_id}`);
    job = await poll.json();
  }
  if (job.status !== 'completed') throw new Error(`preflight audit ${job.status}`);
  return job.fast_verdict;
}

let skill = null;
for (const candidate of skillCandidates) {
  const verdict = await ensureFastAudit(candidate);
  if (verdict?.verdict === 'block') continue;
  skill = candidate;
  break;
}
if (!skill) {
  console.log('FAIL no skill candidate passed guard (all block)');
  process.exit(1);
}

const deployRes = await fetch(`${runBase}/v1/run/agents`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Idempotency-Key': `smoke-run:${Date.now()}`,
  },
  body: JSON.stringify({
    name: 'smoke-guard-agent',
    template: 'smoke',
    skills: [skill],
    secrets: ['secret://env/gateway-api-key'],
    policy: { guard_min_score: 0, allow_warn: true },
  }),
});
const deployment = await deployRes.json();
if (deployRes.status !== 202 || !deployment.deployment_id) {
  console.log('FAIL deploy create', deployRes.status, JSON.stringify(deployment));
  process.exit(1);
}

const deployDeadline = Date.now() + 180_000;
let dep = deployment;
while (dep.status === 'pending' || dep.status === 'deploying') {
  if (Date.now() > deployDeadline) {
    console.log('FAIL deploy timeout', JSON.stringify(dep));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  const poll = await fetch(`${runBase}/v1/run/agents/${deployment.deployment_id}`);
  dep = await poll.json();
}

if (dep.status !== 'running') {
  console.log('FAIL deploy status', dep.status, dep.failure_reason, JSON.stringify(dep));
  process.exit(1);
}

const jobRes = await fetch(`${runBase}/v1/run/agents/${dep.agent_id}/jobs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    deployment_id: dep.deployment_id,
    goal: 'In one sentence, what is axios used for in Node.js projects?',
  }),
});
const job = await jobRes.json();
if (jobRes.status !== 202 || !job.job_id) {
  console.log('FAIL job create', jobRes.status, JSON.stringify(job));
  process.exit(1);
}

const jobDeadline = Date.now() + 120_000;
let runningJob = job;
while (runningJob.status === 'pending' || runningJob.status === 'running') {
  if (Date.now() > jobDeadline) {
    console.log('FAIL job timeout', JSON.stringify(runningJob));
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 2000));
  const poll = await fetch(`${runBase}/v1/run/jobs/${job.job_id}`);
  runningJob = await poll.json();
}

if (runningJob.status !== 'completed' || !runningJob.result_summary) {
  console.log('FAIL job', runningJob.status, runningJob.error, JSON.stringify(runningJob));
  process.exit(1);
}

console.log(
  'ok run',
  dep.deployment_id,
  dep.agent_id,
  `guard_checks=${dep.guard_checks?.length ?? 0}`,
  `job=${job.job_id}`,
  `btl=${runningJob.btl_request_id ?? 'n/a'}`,
);
