import type { AuditJob, Ecosystem, GuardCheckResponse } from '@nabuos/types';

function guardBase(): string {
  return (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
}

export async function ensureGuardAudit(
  ecosystem: Ecosystem,
  name: string,
  version: string,
): Promise<{ audit_id: string; verdict: string; score: number }> {
  const checkUrl = `${guardBase()}/v1/guard/check?ecosystem=${encodeURIComponent(ecosystem)}&name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`;
  const checkRes = await fetch(checkUrl);
  if (checkRes.status === 200) {
    const hit = (await checkRes.json()) as GuardCheckResponse & { status: 'completed' };
    if (hit.status === 'completed' && hit.fast_verdict) {
      return {
        audit_id: hit.audit_id,
        verdict: hit.fast_verdict.verdict,
        score: hit.fast_verdict.score,
      };
    }
  }

  const createRes = await fetch(`${guardBase()}/v1/guard/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `pulse:${ecosystem}:${name}:${version}:fast`,
    },
    body: JSON.stringify({ ecosystem, name, version, depth: 'fast' }),
  });
  const created = (await createRes.json()) as AuditJob;
  if (!createRes.ok || !created.audit_id) {
    throw new Error(`guard audit create failed: ${createRes.status}`);
  }

  const deadline = Date.now() + 120_000;
  let job = created;
  while (job.status === 'pending' || job.status === 'running') {
    if (Date.now() > deadline) throw new Error(`guard audit timeout ${name}@${version}`);
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${guardBase()}/v1/guard/audits/${created.audit_id}`);
    job = (await poll.json()) as AuditJob;
  }

  if (job.status !== 'completed' || !job.fast_verdict) {
    throw new Error(`guard audit ${job.status} for ${name}@${version}`);
  }

  return {
    audit_id: job.audit_id,
    verdict: job.fast_verdict.verdict,
    score: job.fast_verdict.score,
  };
}
