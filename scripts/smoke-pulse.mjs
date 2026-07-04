#!/usr/bin/env node
/**
 * Live Pulse watchlist — pulse :3006, guard :3001, mind :3002, GATEWAY_API_KEY.
 * Uses chalk with baseline 4.0.0 (real npm version) to detect drift vs latest.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

try {
  const envPath = resolve(process.cwd(), '.env');
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* no .env */
}

if (!process.env.GATEWAY_API_KEY) {
  console.error('FAIL GATEWAY_API_KEY required for smoke:pulse');
  process.exit(1);
}

const base = process.env.PULSE_URL ?? 'http://127.0.0.1:3006';
const webhook = process.env.PULSE_SMOKE_WEBHOOK ?? 'https://httpbin.org/post';

const createRes = await fetch(`${base}/v1/pulse/watchlists`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: `smoke-${Date.now()}`,
    webhook_url: webhook,
    packages: [{ ecosystem: 'npm', name: 'chalk', baseline_version: '2.4.2' }],
  }),
});
const wl = await createRes.json();
if (createRes.status !== 201 || !wl.watchlist_id) {
  console.log('FAIL create watchlist', createRes.status, JSON.stringify(wl));
  process.exit(1);
}

const checkRes = await fetch(`${base}/v1/pulse/watchlists/${wl.watchlist_id}/check`, {
  method: 'POST',
});
const check1 = await checkRes.json();
if (!checkRes.ok) {
  console.log('FAIL check baseline', checkRes.status, JSON.stringify(check1));
  process.exit(1);
}

const check2Res = await fetch(`${base}/v1/pulse/watchlists/${wl.watchlist_id}/check`, {
  method: 'POST',
});
const check = await check2Res.json();
if (!check2Res.ok) {
  console.log('FAIL check drift', check2Res.status, JSON.stringify(check));
  process.exit(1);
}

const wlRes = await fetch(`${base}/v1/pulse/watchlists/${wl.watchlist_id}`);
const wlFresh = await wlRes.json();
const pkg = wlFresh.packages?.[0];

const alertsRes = await fetch(`${base}/v1/pulse/watchlists/${wl.watchlist_id}/alerts`);
const alertsBody = await alertsRes.json();

const drifted = pkg.last_seen_version && pkg.last_seen_version !== '2.4.2';
const hasAlert = check.alerts_created > 0 || alertsBody.alerts?.length > 0;

const ok =
  pkg?.last_audit_id &&
  typeof pkg.last_score === 'number' &&
  drifted &&
  (hasAlert || pkg.last_seen_version);

if (!ok) {
  console.log('FAIL pulse', JSON.stringify({ check, pkg, alerts: alertsBody }));
  process.exit(1);
}

const alert = check.alerts?.[0] ?? alertsBody.alerts?.[0];
console.log(
  'ok pulse',
  wl.watchlist_id,
  `chalk→${pkg.last_seen_version}`,
  hasAlert
    ? `alert ${alert?.previous_version}→${alert?.new_version} score ${alert?.previous_score}→${alert?.new_score}`
    : 'drift only (no risk increase)',
  alert?.webhook_delivered ? `webhook=${alert.webhook_status}` : '',
  alert?.mind_run_id ? `mind=${alert.mind_run_id}` : '',
);
