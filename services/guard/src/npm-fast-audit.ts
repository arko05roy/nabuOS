import type { AuditJob, AuditPhase, AuditVerdict } from '@nabuos/types';
import type { createDepsDevClient } from '@nabuos/deps-dev';
import { fetchNpmInventory, ArtifactError } from '@nabuos/npm-artifact';
import { NpmRegistryError, type createNpmRegistryClient } from '@nabuos/npm-registry';
import type { createOsvClient } from '@nabuos/osv';
import {
  enrichNpmPackage,
  GuardTriageError,
  runGuardTriage,
  type GuardTriageResult,
} from '@nabuos/guard-triage';
import { saveAudit } from './audit-store.js';

type NpmClient = ReturnType<typeof createNpmRegistryClient>;
type DepsDevClient = ReturnType<typeof createDepsDevClient>;
type OsvClient = ReturnType<typeof createOsvClient>;

function now(): string {
  return new Date().toISOString();
}

function upsertPhase(phases: AuditPhase[], name: string, status: AuditPhase['status'], error?: string): void {
  const phase = phases.find((p) => p.name === name);
  if (phase) {
    phase.status = status;
    if (status === 'running' && !phase.started_at) phase.started_at = now();
    if (status === 'completed' || status === 'degraded' || status === 'failed' || status === 'skipped') {
      phase.completed_at = now();
    }
    if (error) phase.error = error;
    else delete phase.error;
    return;
  }
  phases.push({
    name,
    status,
    started_at: now(),
    completed_at:
      status === 'completed' || status === 'degraded' || status === 'failed' || status === 'skipped'
        ? now()
        : undefined,
    error,
  });
}

function triageToVerdict(triage: GuardTriageResult): AuditVerdict {
  return {
    verdict: triage.verdict_recommendation,
    score: Math.max(0, Math.min(100, 100 - triage.risk_score)),
    reasons: triage.findings.map((f) => `${f.severity}: ${f.message} (${f.citation})`),
    scoring_version: 'guard-score-v0.1',
  };
}

export async function runNpmFastAudit(
  job: AuditJob,
  deps: { npm: NpmClient; depsDev: DepsDevClient; osv: OsvClient },
): Promise<void> {
  const { name, version } = job;
  job.status = 'running';
  await saveAudit(job);

  try {
    upsertPhase(job.phases, 'metadata', 'running');
    await saveAudit(job);
    const doc = await deps.npm.getVersion(name, version);
    upsertPhase(job.phases, 'metadata', 'completed');
    await saveAudit(job);

    upsertPhase(job.phases, 'artifact', 'running');
    await saveAudit(job);
    const { artifact, inventory } = await fetchNpmInventory(name, version, doc);
    job.artifact = {
      url: artifact.url,
      sha256: artifact.sha256,
      integrity_verified: artifact.integrity_verified,
    };
    upsertPhase(job.phases, 'artifact', 'completed');
    upsertPhase(job.phases, 'inventory', 'completed');
    await saveAudit(job);

    const enrichment = await enrichNpmPackage(name, version, deps.depsDev, deps.osv);
    for (const phase of enrichment.phases) {
      upsertPhase(job.phases, phase.name, phase.status, phase.error);
    }
    await saveAudit(job);

    upsertPhase(job.phases, 'triage', 'running');
    await saveAudit(job);
    const triage = await runGuardTriage({
      name,
      version,
      metadata: {
        dist: doc.dist,
        scripts: doc.scripts ?? {},
        dependencies: doc.dependencies ?? {},
        devDependencies: doc.devDependencies,
      },
      inventory,
      dependency_graph: enrichment.dependency_graph,
      vulnerabilities: enrichment.vulnerabilities,
    });
    upsertPhase(job.phases, 'triage', 'completed');
    job.fast_verdict = triageToVerdict(triage);
    job.deep_verdict = job.depth === 'fast' ? null : null;
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
      !(err instanceof NpmRegistryError) &&
      !(err instanceof ArtifactError) &&
      !(err instanceof GuardTriageError)
    ) {
      throw err;
    }
  }
}
