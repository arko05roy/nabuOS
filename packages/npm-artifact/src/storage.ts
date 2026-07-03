import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

// ponytail: local FS artifact store until S3 is provisioned; upgrade path = S3-compatible bucket

export function artifactRoot(): string {
  return process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
}

export function artifactKey(name: string, version: string): string {
  const safe = name.replace(/^@/, '').replace(/\//g, '--');
  return `npm/${safe}/${version}`;
}

export function tarballPath(key: string): string {
  return join(artifactRoot(), key, 'package.tgz');
}

export function extractDirPath(key: string): string {
  return join(artifactRoot(), key, 'extracted');
}

export async function storeTarball(key: string, data: Buffer): Promise<{ path: string; sha256: string }> {
  const dir = join(artifactRoot(), key);
  await mkdir(dir, { recursive: true });
  const path = tarballPath(key);
  await writeFile(path, data);
  const sha256 = createHash('sha256').update(data).digest('hex');
  return { path, sha256 };
}

export async function readStoredTarball(key: string): Promise<Buffer | null> {
  const path = tarballPath(key);
  try {
    await access(path);
    return readFile(path);
  } catch {
    return null;
  }
}
