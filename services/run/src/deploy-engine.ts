import { btlRuntimeFromEnv, createBtlRuntime } from '@nabuos/btl-runtime';
import type { AgentDeployment } from '@nabuos/types';
import { gateSkills } from './guard-client.js';
import { saveDeployment } from './deployment-store.js';
import { resolveVaultSecret, verifySecretHandles, VaultClientError } from './vault-client.js';

export async function runDeployEngine(dep: AgentDeployment): Promise<void> {
  dep.status = 'deploying';
  await saveDeployment(dep);

  try {
    dep.guard_checks = await gateSkills(dep.skills, dep.policy);
    dep.secret_handles_bound = await verifySecretHandles(dep.secrets, dep.agent_id);
    dep.status = 'running';
    dep.failure_reason = undefined;
  } catch (err) {
    dep.status = 'failed';
    dep.failure_reason = err instanceof Error ? err.message : String(err);
  }

  await saveDeployment(dep);
}

export async function runAgentJob(input: {
  agent_id: string;
  deployment_id: string;
  goal: string;
  secret_handle: string;
}): Promise<{ summary: string; btl_request_id?: string; btl_charge?: number }> {
  let apiKey: string;
  try {
    apiKey = await resolveVaultSecret({
      handle: input.secret_handle,
      agent_id: input.agent_id,
      tool: 'run.job',
    });
  } catch (err) {
    if (err instanceof VaultClientError) throw err;
    throw err;
  }

  const client = createBtlRuntime({ apiKey });
  const model = process.env.BTL_SMOKE_MODEL ?? 'btl-2';
  const result = await client.chatCompletion({
    model,
    messages: [
      {
        role: 'system',
        content:
          'You are an agent job runner. Answer the goal in 2-4 sentences. Never repeat or echo API keys or secrets.',
      },
      { role: 'user', content: input.goal },
    ],
  });

  const summary = result.content?.trim() || 'completed with empty model response';
  return {
    summary,
    btl_request_id: result.headers.request_id,
    btl_charge: result.headers.customer_charge,
  };
}

/** Readiness: guard + vault URLs reachable from run service */
export async function runDependenciesReady(): Promise<{
  ready: boolean;
  checks: Record<string, 'ok' | 'fail' | 'unknown'>;
}> {
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = { process: 'ok' };
  const guardUrl = (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const vaultUrl = (process.env.VAULT_URL ?? 'http://127.0.0.1:3003').replace(/\/$/, '');

  try {
    const g = await fetch(`${guardUrl}/healthz`);
    checks.guard = g.ok ? 'ok' : 'fail';
  } catch {
    checks.guard = 'fail';
  }

  try {
    const v = await fetch(`${vaultUrl}/healthz`);
    checks.vault = v.ok ? 'ok' : 'fail';
  } catch {
    checks.vault = 'fail';
  }

  checks.btl_runtime = btlRuntimeFromEnv() ? 'ok' : 'unknown';
  const ready = checks.guard === 'ok' && checks.vault === 'ok';
  return { ready, checks };
}
