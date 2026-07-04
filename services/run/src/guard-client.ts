import type { AgentPolicy, AgentSkill, GuardSkillCheck, Verdict } from '@nabuos/types';

export class GuardClientError extends Error {
  constructor(
    message: string,
    readonly code: 'guard_unreachable' | 'audit_failed' | 'policy_rejected',
  ) {
    super(message);
    this.name = 'GuardClientError';
  }
}

function guardBase(): string {
  return (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
}

interface CompletedCheck {
  audit_id: string;
  fast_verdict: { verdict: Verdict; score: number };
}

async function fetchCheck(
  skill: AgentSkill,
): Promise<CompletedCheck | null> {
  const url = `${guardBase()}/v1/guard/check?ecosystem=${encodeURIComponent(skill.ecosystem)}&name=${encodeURIComponent(skill.name)}&version=${encodeURIComponent(skill.version)}`;
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GuardClientError(`guard check ${res.status}`, 'guard_unreachable');
  }
  const body = (await res.json()) as CompletedCheck & { status: string };
  if (body.status !== 'completed' || !body.fast_verdict) return null;
  return body;
}

async function runAndWaitAudit(skill: AgentSkill): Promise<CompletedCheck> {
  const createRes = await fetch(`${guardBase()}/v1/guard/audits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `run-gate:${skill.ecosystem}:${skill.name}:${skill.version}:fast`,
    },
    body: JSON.stringify({
      ecosystem: skill.ecosystem,
      name: skill.name,
      version: skill.version,
      depth: 'fast',
    }),
  });
  const created = (await createRes.json()) as { audit_id?: string; status?: string };
  if (!createRes.ok || !created.audit_id) {
    throw new GuardClientError(`audit create failed: ${createRes.status}`, 'audit_failed');
  }

  const deadline = Date.now() + 120_000;
  let job = created as { audit_id: string; status: string; fast_verdict?: CompletedCheck['fast_verdict'] };
  while (job.status === 'pending' || job.status === 'running') {
    if (Date.now() > deadline) {
      throw new GuardClientError(`audit timeout for ${skill.name}@${skill.version}`, 'audit_failed');
    }
    await new Promise((r) => setTimeout(r, 2000));
    const poll = await fetch(`${guardBase()}/v1/guard/audits/${created.audit_id}`);
    job = (await poll.json()) as typeof job;
  }

  if (job.status !== 'completed' || !job.fast_verdict) {
    throw new GuardClientError(`audit ${job.status} for ${skill.name}@${skill.version}`, 'audit_failed');
  }

  return { audit_id: created.audit_id, fast_verdict: job.fast_verdict };
}

function evaluateSkillPolicy(
  skill: AgentSkill,
  verdict: Verdict,
  score: number,
  policy: AgentPolicy,
): { passed: boolean; reason?: string } {
  if (verdict === 'block') {
    return { passed: false, reason: 'guard verdict block' };
  }
  if (verdict === 'warn' && !policy.allow_warn) {
    return { passed: false, reason: 'warn not allowed by deployment policy' };
  }
  if (score < policy.guard_min_score) {
    return {
      passed: false,
      reason: `score ${score} below guard_min_score ${policy.guard_min_score}`,
    };
  }
  return { passed: true };
}

export async function gateSkills(
  skills: AgentSkill[],
  policy: AgentPolicy,
): Promise<GuardSkillCheck[]> {
  const checks: GuardSkillCheck[] = [];

  for (const skill of skills) {
    let completed: CompletedCheck | null = null;
    try {
      completed = await fetchCheck(skill);
      if (!completed) completed = await runAndWaitAudit(skill);
    } catch (err) {
      if (err instanceof GuardClientError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new GuardClientError(msg, 'guard_unreachable');
    }

    const { verdict, score } = completed.fast_verdict;
    const evalResult = evaluateSkillPolicy(skill, verdict, score, policy);
    checks.push({
      ecosystem: skill.ecosystem,
      name: skill.name,
      version: skill.version,
      audit_id: completed.audit_id,
      verdict,
      score,
      passed: evalResult.passed,
      reason: evalResult.reason,
    });

    if (!evalResult.passed) {
      throw new GuardClientError(
        `skill ${skill.ecosystem}:${skill.name}@${skill.version} rejected: ${evalResult.reason}`,
        'policy_rejected',
      );
    }
  }

  return checks;
}
