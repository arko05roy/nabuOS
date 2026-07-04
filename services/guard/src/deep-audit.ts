import type { AuditJob, AuditVerdict } from '@nabuos/types';
import { computeDeepVerdict, needsMindInvestigation, scanSemgrep } from '@nabuos/semgrep';
import { upsertPhase } from './audit-phases.js';
import { saveAudit } from './audit-store.js';
import { MindClientError, triggerMindInvestigation } from './mind-client.js';

/** Semgrep scan, deep verdict, optional Mind incident run (Epic 3.3). */
export async function runDeepAuditPhases(
  job: AuditJob,
  fastVerdict: AuditVerdict,
  extractDir: string,
): Promise<void> {
  upsertPhase(job.phases, 'semgrep', 'running');
  await saveAudit(job);

  const semgrep = await scanSemgrep({ auditId: job.audit_id, extractDir });
  job.semgrep = semgrep;
  upsertPhase(job.phases, 'semgrep', 'completed');
  job.deep_verdict = computeDeepVerdict(fastVerdict, semgrep.findings);
  await saveAudit(job);

  if (!needsMindInvestigation(semgrep.findings)) {
    job.mind_investigation = null;
    return;
  }

  if (!process.env.GATEWAY_API_KEY) {
    upsertPhase(job.phases, 'mind_investigation', 'skipped', 'GATEWAY_API_KEY not set');
    job.mind_investigation = null;
    return;
  }

  upsertPhase(job.phases, 'mind_investigation', 'running');
  job.status = 'completed';
  await saveAudit(job);

  try {
    job.mind_investigation = await triggerMindInvestigation(job);
    upsertPhase(job.phases, 'mind_investigation', 'completed');
  } catch (err) {
    const message = err instanceof MindClientError ? err.message : err instanceof Error ? err.message : String(err);
    upsertPhase(job.phases, 'mind_investigation', 'failed', message);
    job.mind_investigation = {
      mind_run_id: '',
      status: 'failed',
      triggered_at: new Date().toISOString(),
      trigger_reason: message,
    };
  }
}
