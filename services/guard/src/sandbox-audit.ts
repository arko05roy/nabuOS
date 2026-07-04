import type { AuditJob, AuditVerdict, MindInvestigation } from '@nabuos/types';
import {
  computeSandboxVerdict,
  needsSandboxMindInvestigation,
  probeSandboxRuntime,
  runNpmLifecycleSandbox,
  runPypiInstallSandbox,
  SandboxError,
} from '@nabuos/sandbox';
import type { NpmInventory } from '@nabuos/npm-artifact';
import type { PypiInventory } from '@nabuos/pypi-artifact';
import { upsertPhase } from './audit-phases.js';
import { saveAudit } from './audit-store.js';
import { MindClientError, triggerSandboxMindInvestigation } from './mind-client.js';

/** Epic 4.3–4.5 — gVisor dynamic phase, sandbox verdict, optional Mind. */
export async function runSandboxAuditPhases(
  job: AuditJob,
  priorVerdict: AuditVerdict,
  extractDir: string,
  inventory: NpmInventory | PypiInventory,
): Promise<void> {
  upsertPhase(job.phases, 'sandbox', 'running');
  await saveAudit(job);

  const probe = await probeSandboxRuntime();
  if (!probe.ready) {
    upsertPhase(job.phases, 'sandbox', 'skipped', probe.message ?? 'sandbox runtime unavailable');
    job.sandbox = null;
    return;
  }

  try {
    const sandbox =
      job.ecosystem === 'npm'
        ? await runNpmLifecycleSandbox({
            extract_dir: extractDir,
            inventory: inventory as NpmInventory,
            audit_id: job.audit_id,
            name: job.name,
            version: job.version,
          })
        : await runPypiInstallSandbox({
            extract_dir: extractDir,
            inventory: inventory as PypiInventory,
            audit_id: job.audit_id,
            name: job.name,
            version: job.version,
          });

    job.sandbox = sandbox;
    const phaseStatus =
      sandbox.status === 'completed'
        ? 'completed'
        : sandbox.status === 'failed' || sandbox.status === 'timeout'
          ? 'failed'
          : 'degraded';
    upsertPhase(job.phases, 'sandbox', phaseStatus);
    job.deep_verdict = computeSandboxVerdict(priorVerdict, sandbox);
    await saveAudit(job);

    if (!needsSandboxMindInvestigation(sandbox)) {
      return;
    }

    if (!process.env.GATEWAY_API_KEY) {
      upsertPhase(job.phases, 'mind_investigation', 'skipped', 'GATEWAY_API_KEY not set');
      return;
    }

    upsertPhase(job.phases, 'mind_investigation', 'running');
    job.status = 'completed';
    await saveAudit(job);

    try {
      job.mind_investigation = await triggerSandboxMindInvestigation(job);
      upsertPhase(job.phases, 'mind_investigation', 'completed');
    } catch (err) {
      const message =
        err instanceof MindClientError ? err.message : err instanceof Error ? err.message : String(err);
      upsertPhase(job.phases, 'mind_investigation', 'failed', message);
      job.mind_investigation = {
        mind_run_id: '',
        status: 'failed',
        triggered_at: new Date().toISOString(),
        trigger_reason: message,
      };
    }
  } catch (err) {
    const message =
      err instanceof SandboxError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    upsertPhase(job.phases, 'sandbox', 'failed', message);
    job.sandbox = null;
    throw err;
  }
}
