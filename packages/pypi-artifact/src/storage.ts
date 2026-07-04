import { mkdir, readdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

// ponytail: local FS until S3; same layout as npm-artifact

export function artifactRoot(): string {
  return process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
}

export function artifactKey(name: string, version: string): string {
  const safe = name.replace(/^@/, '').replace(/\//g, '--').toLowerCase();
  return `pypi/${safe}/${version}`;
}

export function artifactPath(key: string, filename: string): string {
  return join(artifactRoot(), key, filename);
}

export function extractDirPath(key: string): string {
  return join(artifactRoot(), key, 'extracted');
}

export async function storeArtifact(
  key: string,
  filename: string,
  data: Buffer,
): Promise<string> {
  const dir = join(artifactRoot(), key);
  await mkdir(dir, { recursive: true });
  const path = artifactPath(key, filename);
  await writeFile(path, data);
  return path;
}

export async function readStoredArtifact(key: string, filename: string): Promise<Buffer | null> {
  const path = artifactPath(key, filename);
  try {
    await access(path);
    return readFile(path);
  } catch {
    return null;
  }
}

export async function listExtractedFiles(dir: string, prefix = ''): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      paths.push(...(await listExtractedFiles(join(dir, entry.name), rel)));
    } else {
      paths.push(rel);
    }
  }
  return paths.sort();
}
