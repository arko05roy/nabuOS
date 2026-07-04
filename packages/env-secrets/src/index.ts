/** ponytail: Infisical deferred — env-file + encrypted FS for v0 */

import type { CreateSecretRequest, SecretPolicy, SecretRef } from '@nabuos/types';
import type { SecretProvider } from './provider.js';
import { evaluateSecretPolicy, type SecretResolveContext } from './policy.js';

export type { SecretProvider } from './provider.js';
export { evaluateSecretPolicy, type SecretResolveContext } from './policy.js';

const ENV_HANDLES: Record<string, string> = {
  'secret://env/gateway-api-key': 'GATEWAY_API_KEY',
};

const ENV_POLICY: SecretPolicy = {};

export function secretHandle(projectId: string, name: string): string {
  return `secret://${projectId}/${name}`;
}

export function listEnvSecretHandles(): string[] {
  return Object.keys(ENV_HANDLES);
}

export function resolveEnvSecret(
  handle: string,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const varName = ENV_HANDLES[handle];
  if (!varName) return null;
  return env[varName] ?? null;
}

export function envSecretsReady(
  env: NodeJS.ProcessEnv = process.env,
): { ready: boolean; checks: Record<string, 'ok' | 'fail'> } {
  const checks: Record<string, 'ok' | 'fail'> = {};
  for (const [handle, varName] of Object.entries(ENV_HANDLES)) {
    checks[handle] = env[varName] ? 'ok' : 'fail';
  }
  const ready = Object.values(checks).every((c) => c === 'ok');
  return { ready, checks };
}

/** Env-backed bootstrap secrets (BTL key). */
export function createEnvSecretProvider(
  env: NodeJS.ProcessEnv = process.env,
): SecretProvider {
  return {
    kind: 'env',
    async listHandles() {
      return listEnvSecretHandles();
    },
    async getRef(handle) {
      if (!ENV_HANDLES[handle]) return null;
      return {
        secret_id: `env_${handle}`,
        project_id: 'env',
        name: handle.split('/').pop() ?? handle,
        handle,
        policy: ENV_POLICY,
        created_at: '1970-01-01T00:00:00.000Z',
        updated_at: '1970-01-01T00:00:00.000Z',
      };
    },
    async listRefs() {
      const handles = listEnvSecretHandles();
      const refs: SecretRef[] = [];
      for (const handle of handles) {
        const ref = await this.getRef(handle);
        if (ref) refs.push(ref);
      }
      return refs;
    },
    async createSecret() {
      throw new Error('env secrets are read-only');
    },
    async resolveSecret(handle, ctx) {
      const ref = await this.getRef(handle);
      if (!ref) return null;
      const decision = evaluateSecretPolicy(ref.policy, ctx);
      if (!decision.allowed) return null;
      return resolveEnvSecret(handle, env);
    },
  };
}

/** ponytail: upgrade path = InfisicalProvider when INFISICAL_TOKEN + project/env set */
export function infisicalConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.INFISICAL_TOKEN && env.INFISICAL_PROJECT_ID && env.INFISICAL_ENV);
}

export function createSecretProviders(
  fsProvider: SecretProvider,
  env: NodeJS.ProcessEnv = process.env,
): SecretProvider[] {
  const providers: SecretProvider[] = [createEnvSecretProvider(env), fsProvider];
  if (infisicalConfigured(env)) {
    // ponytail: Infisical live provider ships when credentials provisioned
  }
  return providers;
}

export async function resolveThroughProviders(
  providers: SecretProvider[],
  handle: string,
  ctx: SecretResolveContext,
): Promise<{ value: string | null; ref: SecretRef | null }> {
  for (const provider of providers) {
    const ref = await provider.getRef(handle);
    if (!ref) continue;
    const value = await provider.resolveSecret(handle, ctx);
    return { value, ref };
  }
  return { value: null, ref: null };
}

export async function listAllHandles(providers: SecretProvider[]): Promise<string[]> {
  const handles = new Set<string>();
  for (const p of providers) {
    for (const h of await p.listHandles()) handles.add(h);
  }
  return [...handles];
}

export async function listAllRefs(providers: SecretProvider[]): Promise<SecretRef[]> {
  const refs: SecretRef[] = [];
  for (const p of providers) {
    refs.push(...(await p.listRefs()));
  }
  return refs;
}

export async function createStoredSecret(
  providers: SecretProvider[],
  input: CreateSecretRequest,
): Promise<SecretRef> {
  const fs = providers.find((p) => p.kind === 'fs');
  if (!fs) throw new Error('fs secret provider not configured');
  return fs.createSecret(input);
}

