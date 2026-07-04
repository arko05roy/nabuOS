export class VaultClientError extends Error {
  constructor(
    message: string,
    readonly code: 'vault_unreachable' | 'not_found' | 'policy_denied',
  ) {
    super(message);
    this.name = 'VaultClientError';
  }
}

function vaultBase(): string {
  return (process.env.VAULT_URL ?? 'http://127.0.0.1:3003').replace(/\/$/, '');
}

export async function resolveVaultSecret(input: {
  handle: string;
  agent_id: string;
  tool?: string;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${vaultBase()}/v1/vault/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new VaultClientError(`vault unreachable: ${msg}`, 'vault_unreachable');
  }

  const body = (await res.json()) as { value?: string; error?: string; message?: string };
  if (res.status === 404) {
    throw new VaultClientError(body.message ?? 'secret not found', 'not_found');
  }
  if (res.status === 403) {
    throw new VaultClientError(body.message ?? 'policy denied', 'policy_denied');
  }
  if (!res.ok || !body.value) {
    throw new VaultClientError(`vault returned ${res.status}`, 'vault_unreachable');
  }
  return body.value;
}

export async function verifySecretHandles(
  handles: string[],
  agentId: string,
): Promise<string[]> {
  const bound: string[] = [];
  for (const handle of handles) {
    await resolveVaultSecret({ handle, agent_id: agentId, tool: 'run.deploy' });
    bound.push(handle);
  }
  return bound;
}
