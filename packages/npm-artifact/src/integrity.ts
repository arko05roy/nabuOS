import { createHash } from 'node:crypto';

export type IntegrityResult =
  | { ok: true; algorithm: string; weak: false }
  | { ok: true; algorithm: 'sha1'; weak: true }
  | { ok: false; algorithm?: string; weak?: boolean; reason: string };

/** W3C SRI + npm dist.integrity: `<algo>-<base64>` (sha256|sha384|sha512). */
export function verifySriIntegrity(data: Buffer, integrity: string): IntegrityResult {
  for (const token of integrity.trim().split(/\s+/)) {
    const match = token.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
    if (!match) continue;
    const algo = match[1]!;
    const expected = match[2]!;
    const actual = createHash(algo).update(data).digest('base64');
    if (actual === expected) {
      return { ok: true, algorithm: algo, weak: false };
    }
  }
  return { ok: false, reason: 'integrity_mismatch' };
}

/** Legacy npm dist.shasum (SHA-1); weaker fallback when integrity absent. */
export function verifyShasum(data: Buffer, shasum: string): IntegrityResult {
  const expected = shasum.toLowerCase();
  const actual = createHash('sha1').update(data).digest('hex');
  if (actual === expected) {
    return { ok: true, algorithm: 'sha1', weak: true };
  }
  return { ok: false, algorithm: 'sha1', weak: true, reason: 'shasum_mismatch' };
}

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
