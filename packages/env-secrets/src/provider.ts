import type { CreateSecretRequest, SecretRef } from '@nabuos/types';
import type { SecretResolveContext } from './policy.js';

export interface SecretProvider {
  readonly kind: 'env' | 'fs' | 'infisical';

  listHandles(): Promise<string[]>;

  getRef(handle: string): Promise<SecretRef | null>;

  listRefs(): Promise<SecretRef[]>;

  createSecret(input: CreateSecretRequest): Promise<SecretRef>;

  resolveSecret(handle: string, ctx: SecretResolveContext): Promise<string | null>;
}
