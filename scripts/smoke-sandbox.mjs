#!/usr/bin/env node
/**
 * Live gVisor sandbox smoke — guard :3001 (artifact extract), sandbox-worker :3005.
 * Requires Docker daemon + runsc runtime + built sandbox images.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const guard = process.env.GUARD_URL ?? 'http://127.0.0.1:3001';
const sandbox = process.env.SANDBOX_URL ?? 'http://127.0.0.1:3005';
const pkg = process.env.SANDBOX_PKG ?? 'lodash';
const version = process.env.SANDBOX_VERSION ?? '4.17.21';

async function pollRun(runId, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${sandbox}/v1/sandbox/runs/${runId}`);
    const body = await res.json();
    if (!res.ok) {
      console.log('FAIL poll', res.status, JSON.stringify(body));
      process.exit(1);
    }
    if (body.status === 'completed' || body.status === 'failed' || body.status === 'timeout') {
      return body;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log('FAIL poll timeout', runId);
  process.exit(1);
}

const ready = await fetch(`${sandbox}/readyz`);
const readyBody = await ready.json();
if (!ready.ok || !readyBody.ready) {
  console.log('SKIP sandbox smoke — runtime not ready:', JSON.stringify(readyBody));
  process.exit(0);
}

const artifactRes = await fetch(`${guard}/v1/guard/npm/${pkg}/${version}/artifact`);
const artifact = await artifactRes.json();
if (artifactRes.status !== 200 || !artifact.extract_dir) {
  console.log('FAIL guard artifact', artifactRes.status, JSON.stringify(artifact));
  process.exit(1);
}
console.log('ok artifact', artifact.extract_dir, `files=${artifact.extracted_files?.length ?? '?'}`);

const createRes = await fetch(`${sandbox}/v1/sandbox/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    extract_dir: artifact.extract_dir,
    image: 'node',
    ecosystem: 'npm',
    name: pkg,
    version,
    command: [
      'sh',
      '-c',
      'ls /artifact | head -5 > /scratch/listing.txt && test -f /artifact/package.json',
    ],
    timeout_ms: 60_000,
    memory_mb: 512,
    cpus: 1,
  }),
});
const created = await createRes.json();
if (createRes.status !== 202) {
  console.log('FAIL create run', createRes.status, JSON.stringify(created));
  process.exit(1);
}

const run = await pollRun(created.run_id);
if (run.status !== 'completed') {
  console.log('FAIL run', run.status, run.error, run.stderr?.slice(0, 300));
  process.exit(1);
}
if (!run.network_probe_failed) {
  console.log('FAIL network probe — external fetch should fail with --network=none');
  process.exit(1);
}
if (!run.files_written.includes('listing.txt')) {
  console.log('FAIL scratch write', run.files_written);
  process.exit(1);
}

console.log(
  'ok sandbox',
  `run=${run.run_id}`,
  `runtime=${run.runtime}`,
  `network=${run.network_mode}`,
  `duration=${run.duration_ms}ms`,
  `network_isolated=${run.network_probe_failed}`,
);

// ponytail: assert-based self-check for path guard
const badRoot = join(process.cwd(), '.nabu-sandbox-bad');
await mkdir(badRoot, { recursive: true });
const trapFile = join(badRoot, 'probe.txt');
await writeFile(trapFile, 'x');
const badRes = await fetch(`${sandbox}/v1/sandbox/runs`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    extract_dir: trapFile,
    image: 'node',
    command: ['true'],
  }),
});
const badBody = await badRes.json();
if (badRes.status === 202) {
  console.log('FAIL path guard — accepted extract_dir outside artifact root');
  process.exit(1);
}
if (badRes.status !== 400 && badRes.status !== 500) {
  console.log('ok path guard rejected', badRes.status, badBody.error ?? badBody.message);
}
