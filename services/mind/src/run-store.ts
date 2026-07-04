import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { MindRun } from '@nabuos/types';

// ponytail: local FS mind store until Postgres; upgrade path = mind_runs table

function mindRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'mind');
}

function runPath(mindRunId: string): string {
  return join(mindRoot(), `${mindRunId}.json`);
}

function idempotencyPath(key: string): string {
  const safe = Buffer.from(key).toString('base64url');
  return join(mindRoot(), 'idempotency', `${safe}.json`);
}

const memory = new Map<string, MindRun>();

export function createMindRunId(): string {
  return `mind_${randomBytes(12).toString('hex')}`;
}

export function createStepId(): string {
  return `step_${randomBytes(8).toString('hex')}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function loadMindRun(mindRunId: string): Promise<MindRun | null> {
  const cached = memory.get(mindRunId);
  if (cached) return cached;
  const run = await readJson<MindRun>(runPath(mindRunId));
  if (run) memory.set(mindRunId, run);
  return run;
}

export async function saveMindRun(run: MindRun): Promise<void> {
  run.updated_at = new Date().toISOString();
  memory.set(run.mind_run_id, run);
  const dir = mindRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(runPath(run.mind_run_id), JSON.stringify(run, null, 2));
}

export async function findMindRunByIdempotencyKey(key: string): Promise<MindRun | null> {
  const ref = await readJson<{ mind_run_id: string }>(idempotencyPath(key));
  if (!ref) return null;
  return loadMindRun(ref.mind_run_id);
}

export async function bindMindIdempotencyKey(key: string, mindRunId: string): Promise<void> {
  const dir = join(mindRoot(), 'idempotency');
  await mkdir(dir, { recursive: true });
  await writeFile(idempotencyPath(key), JSON.stringify({ mind_run_id: mindRunId }));
}
