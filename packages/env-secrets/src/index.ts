/** ponytail: Infisical deferred — env-file is the vault for v0 */

const ENV_HANDLES: Record<string, string> = {
  'secret://env/gateway-api-key': 'GATEWAY_API_KEY',
};

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
