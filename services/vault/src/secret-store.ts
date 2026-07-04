import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreateSecretRequest, SecretRef } from '@nabuos/types';
import {
  evaluateSecretPolicy,
  secretHandle,
  type SecretProvider,
  type SecretResolveContext,
} from '@nabuos/env-secrets';

// ponytail: encrypted FS until Infisical; upgrade path = InfisicalProvider

interface StoredSecret {
  ref: SecretRef;
  ciphertext: string;
  iv: string;
  tag: string;
}

function vaultRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'vault', 'secrets');
}

function encryptionKey(): Buffer | null {
  const raw = process.env.VAULT_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
  return createHash('sha256').update(raw).digest();
}

function encryptValue(plain: string): { ciphertext: string; iv: string; tag: string } {
  const key = encryptionKey();
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptValue(stored: StoredSecret): string {
  const key = encryptionKey();
  if (!key) throw new Error('VAULT_ENCRYPTION_KEY not configured');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(stored.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(stored.tag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(stored.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
}

function secretPath(secretId: string): string {
  return join(vaultRoot(), `${secretId}.json`);
}

function handleIndexPath(handle: string): string {
  const safe = Buffer.from(handle).toString('base64url');
  return join(vaultRoot(), 'handles', `${safe}.json`);
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export function fsVaultReady(): { ready: boolean; message?: string } {
  if (!encryptionKey()) {
    return { ready: false, message: 'VAULT_ENCRYPTION_KEY not set' };
  }
  return { ready: true };
}

export function createFsSecretProvider(
  readCountForHandle: (handle: string) => Promise<number>,
): SecretProvider {
  return {
    kind: 'fs',
    async listHandles() {
      const refs = await this.listRefs();
      return refs.map((r) => r.handle);
    },
    async getRef(handle) {
      const idx = await readJson<{ secret_id: string }>(handleIndexPath(handle));
      if (!idx) return null;
      const stored = await readJson<StoredSecret>(secretPath(idx.secret_id));
      return stored?.ref ?? null;
    },
    async listRefs() {
      const root = vaultRoot();
      try {
        await access(root);
      } catch {
        return [];
      }
      const { readdir } = await import('node:fs/promises');
      const files = await readdir(root);
      const refs: SecretRef[] = [];
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'handles') continue;
        const stored = await readJson<StoredSecret>(join(root, file));
        if (stored?.ref) refs.push(stored.ref);
      }
      return refs;
    },
    async createSecret(input: CreateSecretRequest) {
      if (!encryptionKey()) throw new Error('VAULT_ENCRYPTION_KEY not configured');
      const ts = new Date().toISOString();
      const secretId = `sec_${randomBytes(12).toString('hex')}`;
      const handle = secretHandle(input.project_id, input.name);
      const ref: SecretRef = {
        secret_id: secretId,
        project_id: input.project_id,
        name: input.name,
        handle,
        policy: input.policy ?? {},
        created_at: ts,
        updated_at: ts,
      };
      const stored: StoredSecret = {
        ref,
        ...encryptValue(input.value),
      };
      await mkdir(vaultRoot(), { recursive: true });
      await mkdir(join(vaultRoot(), 'handles'), { recursive: true });
      await writeFile(secretPath(secretId), JSON.stringify(stored, null, 2));
      await writeFile(handleIndexPath(handle), JSON.stringify({ secret_id: secretId }));
      return ref;
    },
    async resolveSecret(handle, ctx: SecretResolveContext) {
      const idx = await readJson<{ secret_id: string }>(handleIndexPath(handle));
      if (!idx) return null;
      const stored = await readJson<StoredSecret>(secretPath(idx.secret_id));
      if (!stored) return null;
      const readCount = await readCountForHandle(handle);
      const decision = evaluateSecretPolicy(stored.ref.policy, {
        ...ctx,
        read_count: readCount,
      });
      if (!decision.allowed) return null;
      return decryptValue(stored);
    },
  };
}
