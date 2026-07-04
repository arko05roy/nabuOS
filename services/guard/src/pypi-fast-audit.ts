import type { AuditJob, AuditVerdict } from '@nabuos/types';
import type { createDepsDevClient } from '@nabuos/deps-dev';
import { fetchPypiInventory, PypiArtifactError } from '@nabuos/pypi-artifact';
import { PypiRegistryError, type createPypiRegistryClient } from '@nabuos/pypi-registry';
import type { createOsvClient } from '@nabuos/osv';
import { SemgrepError } from '@nabuos/semgrep';
import {
  enrichPypiPackage,
  GuardTriageError,
  runPypiGuardTriage,
  type GuardTriageResult,
} from '@nabuos/guard-triage';
import { upsertPhase } from './audit-phases.js';
import { saveAudit } from './audit-store.js';
import { runDeepAuditPhases } from './deep-audit.js';

type PypiClient = ReturnType<typeof createPypiRegistryClient>;
type DepsDevClient = ReturnType<typeof createDepsDevClient>;
type OsvClient = ReturnType<typeof createOsvClient>;

function triageToVerdict(triage: GuardTriageResult): AuditVerdict {
  return {
    verdict: triage.verdict_recommendation,
    score: Math.max(0, Math.min(100, 100 - triage.risk_score)),
    reasons: triage.findings.map((f) => `${f.severity}: ${f.message} (${f.citation})`),
    scoring_version: 'guard-score-v0.1',
  };
}

export async function runPypiFastAudit(
  job: AuditJob,
  deps: { pypi: PypiClient; depsDev: DepsDevClient; osv: OsvClient },
): Promise<void> {
  const { name, version } = job;
  job.status = 'running';
  await saveAudit(job);

  let extractDir: string | undefined;

  try {
    upsertPhase(job.phases, 'metadata', 'running');
    await saveAudit(job);
    const doc = await deps.pypi.getVersion(name, version);
    upsertPhase(job.phases, 'metadata', 'completed');
    await saveAudit(job);

    upsertPhase(job.phases, 'artifact', 'running');
    await saveAudit(job);
    const { artifact, inventory } = await fetchPypiInventory(name, version, doc.urls);
    extractDir = artifact.extract_dir;
    job.artifact = {
      url: artifact.url,
      sha256: artifact.sha256,
      integrity_verified: artifact.digest_verified,
    };
    upsertPhase(job.phases, 'artifact', 'completed');
    upsertPhase(job.phases, 'inventory', 'completed');
    await saveAudit(job);

    const enrichment = await enrichPypiPackage(name, version, deps.depsDev, deps.osv);
    for (const phase of enrichment.phases) {
      upsertPhase(job.phases, phase.name, phase.status, phase.error);
    }
    await saveAudit(job);

    upsertPhase(job.phases, 'triage', 'running');
    await saveAudit(job);
    const triage = await runPypiGuardTriage({
      name,
      version,
      yanked: doc.all_files_yanked,
      inventory,
      dependency_graph: enrichment.dependency_graph,
      vulnerabilities: enrichment.vulnerabilities,
    });
    upsertPhase(job.phases, 'triage', 'completed');
    job.fast_verdict = triageToVerdict(triage);

    if (job.depth === 'deep') {
      const dir = extractDir;
      if (!dir) {
        throw new Error('extract_dir missing after artifact phase');
      }
      await runDeepAuditPhases(job, job.fast_verdict, dir);
    } else {
      job.deep_verdict = null;
      job.mind_investigation = null;
    }

    job.status = 'completed';
    await saveAudit(job);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const running = job.phases.find((p) => p.status === 'running');
    if (running) {
      upsertPhase(job.phases, running.name, 'failed', message);
    } else {
      upsertPhase(job.phases, 'audit', 'failed', message);
    }
    job.status = 'failed';
    await saveAudit(job);

    if (
      !(err instanceof PypiRegistryError) &&
      !(err instanceof PypiArtifactError) &&
      !(err instanceof GuardTriageError) &&
      !(err instanceof SemgrepError)
    ) {
      throw err;
    }
  }
}
