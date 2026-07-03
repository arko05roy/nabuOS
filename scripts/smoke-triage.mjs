#!/usr/bin/env node
/** Live BTL triage smoke — requires GATEWAY_API_KEY in env and guard on :3001. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env if present (same pattern as smoke-btl)
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
  console.error('FAIL GATEWAY_API_KEY required for smoke:triage');
  process.exit(1);
}

const base = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const name = 'axios';
const version = '1.6.0';
const enc = encodeURIComponent(name);

const res = await fetch(`${base}/v1/guard/npm/${enc}/${version}/triage`);
const body = await res.json();

const ok =
  res.status === 200 &&
  typeof body.triage?.risk_score === 'number' &&
  ['allow', 'warn', 'block'].includes(body.triage?.verdict_recommendation) &&
  Array.isArray(body.triage?.findings) &&
  body.triage?.scoring_version === 'guard-triage-v0.1' &&
  body.triage?.btl_runtime?.model;

if (res.status === 503 && body.error === 'btl_unconfigured') {
  console.error(
    'FAIL triage: guard needs GATEWAY_API_KEY — start with: cd services/guard && node --env-file=../../.env dist/index.js',
  );
  process.exit(1);
}

if (!ok) {
  console.log('FAIL triage', res.status, JSON.stringify(body));
  process.exit(1);
}

console.log(
  'ok triage',
  `${name}@${version}`,
  `score=${body.triage.risk_score}`,
  `verdict=${body.triage.verdict_recommendation}`,
  `findings=${body.triage.findings.length}`,
  `btl_model=${body.triage.btl_runtime.model}`,
  `charge=${body.triage.btl_runtime.customer_charge ?? 'n/a'}`,
);
