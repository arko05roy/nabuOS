import { createHash } from 'node:crypto';

export function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

export function verifySha256(
  data: Buffer,
  expected: string,
): { ok: true } | { ok: false; reason: string } {
  const actual = sha256Hex(data);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    return { ok: false, reason: `sha256 mismatch: expected ${expected}, got ${actual}` };
  }
  return { ok: true };
}
