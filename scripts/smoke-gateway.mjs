#!/usr/bin/env node
/** Live api-gateway reverse proxy — gateway :3100, guard :3001 (or GUARD_URL). */
const gateway = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');
const guard = (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const pkg = process.env.GATEWAY_SMOKE_PKG ?? 'lodash';
const version = process.env.GATEWAY_SMOKE_VERSION ?? '4.17.21';
const path = `/v1/guard/npm/${pkg}/${version}`;

const ready = await fetch(`${gateway}/readyz`);
const readyBody = await ready.json();
if (!ready.ok) {
  console.log('FAIL gateway readyz', ready.status, JSON.stringify(readyBody));
  process.exit(1);
}
if (!readyBody.ready) {
  console.log('SKIP gateway smoke — upstreams not ready:', JSON.stringify(readyBody));
  process.exit(0);
}

const [viaGateway, direct] = await Promise.all([
  fetch(`${gateway}${path}`),
  fetch(`${guard}${path}`),
]);

const gwBody = await viaGateway.json();
const directBody = await direct.json();

if (viaGateway.status !== 200 || direct.status !== 200) {
  console.log('FAIL fetch', viaGateway.status, direct.status, JSON.stringify(gwBody));
  process.exit(1);
}

const requestId = viaGateway.headers.get('x-nabu-request-id');
if (!requestId) {
  console.log('FAIL missing x-nabu-request-id on proxied response');
  process.exit(1);
}

if (gwBody.name !== directBody.name || gwBody.version !== directBody.version) {
  console.log('FAIL body mismatch', JSON.stringify({ gw: gwBody, direct: directBody }));
  process.exit(1);
}

console.log(
  'ok gateway',
  path,
  `request_id=${requestId}`,
  `name=${gwBody.name}`,
  `version=${gwBody.version}`,
);
