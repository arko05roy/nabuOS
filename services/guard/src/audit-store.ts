import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuditJob, Ecosystem } from '@nabuos/types';

// ponytail: local FS audit store until Postgres; upgrade path = audit_jobs table

function auditRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'audits');
}

function safeName(name: string): string {
  return name.replace(/^@/, '').replace(/\//g, '--');
}

function jobPath(auditId: string): string {
  return join(auditRoot(), `${auditId}.json`);
}

function checkIndexPath(ecosystem: Ecosystem, name: string, version: string): string {
  return join(auditRoot(), 'check', ecosystem, safeName(name), `${version}.json`);
}

function idempotencyPath(key: string): string {
  const safe = Buffer.from(key).toString('base64url');
  return join(auditRoot(), 'idempotency', `${safe}.json`);
}

const memory = new Map<string, AuditJob>();

export function createAuditId(): string {
  return `aud_${randomBytes(12).toString('hex')}`;
}

export function packageAuditKey(
  ecosystem: Ecosystem,
  name: string,
  version: string,
  depth: string,
): string {
  return `${ecosystem}:${name}:${version}:${depth}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function loadAudit(auditId: string): Promise<AuditJob | null> {
  const cached = memory.get(auditId);
  if (cached) return cached;
  const job = await readJson<AuditJob>(jobPath(auditId));
  if (job) memory.set(auditId, job);
  return job;
}

export async function saveAudit(job: AuditJob): Promise<void> {
  job.updated_at = new Date().toISOString();
  memory.set(job.audit_id, job);
  const dir = auditRoot();
  await mkdir(dir, { recursive: true });
  await writeFile(jobPath(job.audit_id), JSON.stringify(job, null, 2));
  if (job.status === 'completed') {
    const checkDir = join(auditRoot(), 'check', job.ecosystem, safeName(job.name));
    await mkdir(checkDir, { recursive: true });
    await writeFile(
      checkIndexPath(job.ecosystem, job.name, job.version),
      JSON.stringify({ audit_id: job.audit_id, updated_at: job.updated_at }),
    );
  }
}

export async function findAuditByIdempotencyKey(key: string): Promise<AuditJob | null> {
  const ref = await readJson<{ audit_id: string }>(idempotencyPath(key));
  if (!ref) return null;
  return loadAudit(ref.audit_id);
}

export async function bindIdempotencyKey(key: string, auditId: string): Promise<void> {
  const dir = join(auditRoot(), 'idempotency');
  await mkdir(dir, { recursive: true });
  await writeFile(idempotencyPath(key), JSON.stringify({ audit_id: auditId }));
}

export async function findCompletedCheck(
  ecosystem: Ecosystem,
  name: string,
  version: string,
): Promise<AuditJob | null> {
  const ref = await readJson<{ audit_id: string }>(checkIndexPath(ecosystem, name, version));
  if (!ref) return null;
  const job = await loadAudit(ref.audit_id);
  if (!job || job.status !== 'completed') return null;
  return job;
}
