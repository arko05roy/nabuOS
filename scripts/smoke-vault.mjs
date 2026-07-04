#!/usr/bin/env node
/** Live Vault API — vault on :3003, optional VAULT_ENCRYPTION_KEY for stored secrets. */
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

const base = process.env.VAULT_URL ?? 'http://127.0.0.1:3003';

const handlesRes = await fetch(`${base}/v1/vault/handles`);
const handlesBody = await handlesRes.json();
if (!handlesRes.ok || !Array.isArray(handlesBody.handles)) {
  console.log('FAIL handles', handlesRes.status, JSON.stringify(handlesBody));
  process.exit(1);
}

const envHandle = 'secret://env/gateway-api-key';
if (!handlesBody.handles.includes(envHandle)) {
  console.log('FAIL missing env handle', handlesBody.handles);
  process.exit(1);
}

const probeRes = await fetch(`${base}/v1/vault/resolve?handle=${encodeURIComponent(envHandle)}`);
const probe = await probeRes.json();
if (!probeRes.ok || probe.configured !== true) {
  console.log('FAIL env resolve probe', probeRes.status, JSON.stringify(probe));
  process.exit(1);
}

if (!process.env.VAULT_ENCRYPTION_KEY) {
  console.log('ok vault env-only (set VAULT_ENCRYPTION_KEY to smoke stored secrets)');
  process.exit(0);
}

const projectId = 'smoke';
const secretName = `btl-smoke-${Date.now()}`;
const createRes = await fetch(`${base}/v1/vault/secrets`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project_id: projectId,
    name: secretName,
    value: process.env.GATEWAY_API_KEY ?? 'smoke-placeholder',
    policy: { allowed_agent_ids: ['agent_smoke'], max_reads: 5 },
  }),
});
const created = await createRes.json();
if (createRes.status !== 201 || !created.handle) {
  console.log('FAIL create secret', createRes.status, JSON.stringify(created));
  process.exit(1);
}

const denyRes = await fetch(`${base}/v1/vault/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ handle: created.handle, agent_id: 'agent_wrong', tool: 'smoke' }),
});
if (denyRes.status !== 403) {
  console.log('FAIL policy should deny wrong agent', denyRes.status);
  process.exit(1);
}

const allowRes = await fetch(`${base}/v1/vault/resolve`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ handle: created.handle, agent_id: 'agent_smoke', tool: 'smoke' }),
});
const allowed = await allowRes.json();
if (!allowRes.ok || typeof allowed.value !== 'string' || !allowed.value.length) {
  console.log('FAIL policy allow', allowRes.status, JSON.stringify(allowed));
  process.exit(1);
}

const eventsRes = await fetch(`${base}/v1/vault/access-events?limit=5`);
const eventsBody = await eventsRes.json();
if (!eventsRes.ok || !eventsBody.events?.length) {
  console.log('FAIL access events', eventsRes.status, JSON.stringify(eventsBody));
  process.exit(1);
}

console.log('ok vault', created.handle, `events=${eventsBody.events.length}`);
