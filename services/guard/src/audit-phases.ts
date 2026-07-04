import type { AuditPhase } from '@nabuos/types';

export function auditNow(): string {
  return new Date().toISOString();
}

export function upsertPhase(
  phases: AuditPhase[],
  name: string,
  status: AuditPhase['status'],
  error?: string,
): void {
  const phase = phases.find((p) => p.name === name);
  if (phase) {
    phase.status = status;
    if (status === 'running' && !phase.started_at) phase.started_at = auditNow();
    if (status === 'completed' || status === 'degraded' || status === 'failed' || status === 'skipped') {
      phase.completed_at = auditNow();
    }
    if (error) phase.error = error;
    else delete phase.error;
    return;
  }
  phases.push({
    name,
    status,
    started_at: auditNow(),
    completed_at:
      status === 'completed' || status === 'degraded' || status === 'failed' || status === 'skipped'
        ? auditNow()
        : undefined,
    error,
  });
}
