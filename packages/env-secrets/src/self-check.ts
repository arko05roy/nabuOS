import { evaluateSecretPolicy } from './policy.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function selfCheck(): void {
  const ok = evaluateSecretPolicy(
    { allowed_agent_ids: ['agent_a'], max_reads: 2 },
    { agent_id: 'agent_a', read_count: 1 },
  );
  assert(ok.allowed, 'allowed agent should pass');

  const denyAgent = evaluateSecretPolicy(
    { allowed_agent_ids: ['agent_a'] },
    { agent_id: 'agent_b' },
  );
  assert(!denyAgent.allowed && denyAgent.outcome === 'denied', 'wrong agent denied');

  const expired = evaluateSecretPolicy(
    { expires_at: '2000-01-01T00:00:00.000Z' },
    {},
  );
  assert(!expired.allowed && expired.outcome === 'expired', 'expired secret denied');

  const maxReads = evaluateSecretPolicy({ max_reads: 1 }, { read_count: 1 });
  assert(!maxReads.allowed, 'max_reads enforced');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  selfCheck();
  console.log('ok env-secrets self-check');
}
