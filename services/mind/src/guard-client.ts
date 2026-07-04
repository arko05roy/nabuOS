import type { AuditJob, GuardCheckResponse } from '@nabuos/types';

export class GuardClientError extends Error {
  constructor(
    message: string,
    readonly code: 'guard_unreachable' | 'audit_not_found' | 'audit_incomplete',
  ) {
    super(message);
    this.name = 'GuardClientError';
  }
}

function guardBase(): string {
  return (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
}

export async function fetchGuardAudit(auditId: string): Promise<AuditJob> {
  let res: Response;
  try {
    res = await fetch(`${guardBase()}/v1/guard/audits/${encodeURIComponent(auditId)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GuardClientError(`guard unreachable: ${msg}`, 'guard_unreachable');
  }

  if (res.status === 404) {
    throw new GuardClientError(`audit ${auditId} not found`, 'audit_not_found');
  }
  if (!res.ok) {
    throw new GuardClientError(`guard returned ${res.status}`, 'guard_unreachable');
  }

  const job = (await res.json()) as AuditJob;
  if (job.status !== 'completed') {
    throw new GuardClientError(`audit ${auditId} status=${job.status}`, 'audit_incomplete');
  }
  return job;
}

export async function fetchGuardCheck(
  ecosystem: 'npm' | 'pypi',
  name: string,
  version: string,
): Promise<GuardCheckResponse & { status: 'completed' }> {
  const url = `${guardBase()}/v1/guard/check?ecosystem=${encodeURIComponent(ecosystem)}&name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GuardClientError(`guard unreachable: ${msg}`, 'guard_unreachable');
  }

  const body = (await res.json()) as GuardCheckResponse;
  if (res.status === 404 || body.status === 'not_found') {
    throw new GuardClientError(`no completed audit for ${ecosystem}:${name}@${version}`, 'audit_not_found');
  }
  if (!res.ok || body.status !== 'completed') {
    throw new GuardClientError(`guard check failed: ${res.status}`, 'guard_unreachable');
  }
  return body;
}

/** package ref id format: npm:axios:1.6.0 */
export function parsePackageRef(id: string): { ecosystem: 'npm' | 'pypi'; name: string; version: string } | null {
  const parts = id.split(':');
  if (parts.length < 3) return null;
  const ecosystem = parts[0];
  const version = parts[parts.length - 1] ?? '';
  const name = parts.slice(1, -1).join(':');
  if ((ecosystem !== 'npm' && ecosystem !== 'pypi') || !name || !version) return null;
  return { ecosystem, name, version };
}
