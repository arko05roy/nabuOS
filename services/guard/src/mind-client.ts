import type { AuditJob, MindInvestigation } from '@nabuos/types';

export class MindClientError extends Error {
  constructor(
    message: string,
    readonly code: 'mind_unreachable' | 'mind_rejected',
  ) {
    super(message);
    this.name = 'MindClientError';
  }
}

function mindBase(): string {
  return (process.env.MIND_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');
}

/** POST live Mind incident run over a completed Guard deep audit. */
export async function triggerMindInvestigation(job: AuditJob): Promise<MindInvestigation> {
  const findings = job.semgrep?.findings ?? [];
  const highRisk = findings.filter((f) => f.severity === 'critical' || f.severity === 'high').length;
  const goal =
    `Investigate ${highRisk} high-severity Semgrep static analysis findings in ${job.ecosystem} package ` +
    `${job.name}@${job.version}. Deep verdict: ${job.deep_verdict?.verdict ?? 'unknown'} ` +
    `(score ${job.deep_verdict?.score ?? 'n/a'}). Cite only Guard audit evidence; do not invent files.`;

  let res: Response;
  try {
    res = await fetch(`${mindBase()}/v1/mind/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `mind:guard:${job.audit_id}`,
      },
      body: JSON.stringify({
        goal,
        mode: 'incident',
        context_refs: [{ type: 'guard_audit', id: job.audit_id }],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MindClientError(`mind unreachable: ${msg}`, 'mind_unreachable');
  }

  let body: { mind_run_id?: string; status?: string; error?: string; message?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new MindClientError(`mind returned non-JSON ${res.status}`, 'mind_rejected');
  }

  if (!res.ok || !body.mind_run_id) {
    const detail = body.message ?? body.error ?? JSON.stringify(body);
    throw new MindClientError(`mind returned ${res.status}: ${detail}`, 'mind_rejected');
  }

  return {
    mind_run_id: body.mind_run_id,
    status: (body.status === 'completed' ||
    body.status === 'running' ||
    body.status === 'failed' ||
    body.status === 'pending'
      ? body.status
      : 'pending') as MindInvestigation['status'],
    triggered_at: new Date().toISOString(),
    trigger_reason: `${highRisk} critical/high semgrep findings on ${job.ecosystem}:${job.name}@${job.version}`,
  };
}

/** POST live Mind incident run over sandbox hard-block signals (Epic 4.5). */
export async function triggerSandboxMindInvestigation(job: AuditJob): Promise<MindInvestigation> {
  const signals = job.sandbox?.hard_block_signals ?? [];
  const goal =
    `Investigate ${signals.length} sandbox hard-block signal(s) in ${job.ecosystem} package ` +
    `${job.name}@${job.version}. Sandbox phase: ${job.sandbox?.phase ?? 'unknown'}, ` +
    `network_isolated=${job.sandbox?.network_isolated ?? 'unknown'}. ` +
    `Deep verdict: ${job.deep_verdict?.verdict ?? 'unknown'} (score ${job.deep_verdict?.score ?? 'n/a'}). ` +
    `Cite only Guard audit evidence; do not invent files.`;

  let res: Response;
  try {
    res = await fetch(`${mindBase()}/v1/mind/runs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `mind:sandbox:${job.audit_id}`,
      },
      body: JSON.stringify({
        goal,
        mode: 'incident',
        context_refs: [{ type: 'guard_audit', id: job.audit_id }],
      }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new MindClientError(`mind unreachable: ${msg}`, 'mind_unreachable');
  }

  let body: { mind_run_id?: string; status?: string; error?: string; message?: string };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    throw new MindClientError(`mind returned non-JSON ${res.status}`, 'mind_rejected');
  }

  if (!res.ok || !body.mind_run_id) {
    const detail = body.message ?? body.error ?? JSON.stringify(body);
    throw new MindClientError(`mind returned ${res.status}: ${detail}`, 'mind_rejected');
  }

  return {
    mind_run_id: body.mind_run_id,
    status: (body.status === 'completed' ||
    body.status === 'running' ||
    body.status === 'failed' ||
    body.status === 'pending'
      ? body.status
      : 'pending') as MindInvestigation['status'],
    triggered_at: new Date().toISOString(),
    trigger_reason: signals.join('; ') || `sandbox incident on ${job.ecosystem}:${job.name}@${job.version}`,
  };
}
