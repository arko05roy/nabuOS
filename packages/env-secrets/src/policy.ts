import type { SecretPolicy } from '@nabuos/types';

export interface SecretResolveContext {
  agent_id?: string;
  tool?: string;
  read_count?: number;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; reason: string; outcome: 'denied' | 'expired' };

/** Enforce secret policy before resolve. */
export function evaluateSecretPolicy(
  policy: SecretPolicy,
  ctx: SecretResolveContext,
): PolicyDecision {
  if (policy.expires_at) {
    const expires = Date.parse(policy.expires_at);
    if (Number.isFinite(expires) && Date.now() >= expires) {
      return { allowed: false, reason: 'secret expired', outcome: 'expired' };
    }
  }

  if (policy.allowed_agent_ids?.length) {
    if (!ctx.agent_id || !policy.allowed_agent_ids.includes(ctx.agent_id)) {
      return { allowed: false, reason: 'agent not allowed', outcome: 'denied' };
    }
  }

  if (policy.allowed_tools?.length) {
    if (!ctx.tool || !policy.allowed_tools.includes(ctx.tool)) {
      return { allowed: false, reason: 'tool not allowed', outcome: 'denied' };
    }
  }

  if (policy.max_reads != null && policy.max_reads >= 0) {
    const reads = ctx.read_count ?? 0;
    if (reads >= policy.max_reads) {
      return { allowed: false, reason: 'max_reads exceeded', outcome: 'denied' };
    }
  }

  return { allowed: true };
}
