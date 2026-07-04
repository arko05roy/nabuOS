#!/usr/bin/env node
/**
 * Live smoke: services return x-trace-id and gateway propagates trace to guard.
 * Requires guard (:3001) and api-gateway (:3100) running with OTEL enabled.
 */
const guardUrl = (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const gatewayUrl = (process.env.GATEWAY_URL ?? 'http://127.0.0.1:3100').replace(/\/$/, '');

function assertTraceId(label, value) {
  if (!value || !/^(?!0{32})[0-9a-f]{32}$/.test(value)) {
    throw new Error(`${label}: missing or invalid x-trace-id (${value ?? 'null'})`);
  }
  return value;
}

async function checkService(name, url) {
  const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`${name} /healthz → ${res.status}`);
  const traceId = assertTraceId(name, res.headers.get('x-trace-id'));
  console.log(`ok ${name} trace_id=${traceId}`);
  return traceId;
}

async function checkGatewayPropagation() {
  const res = await fetch(`${gatewayUrl}/v1/guard/npm/lodash`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`gateway → guard /v1/guard/npm/lodash → ${res.status}`);
  const gatewayTrace = assertTraceId('gateway', res.headers.get('x-trace-id'));
  console.log(`ok gateway→guard trace_id=${gatewayTrace}`);
}

async function main() {
  await checkService('guard', guardUrl);
  await checkGatewayPropagation();
  console.log('smoke:otel passed');
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
