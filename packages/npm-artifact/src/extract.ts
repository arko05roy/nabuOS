import { mkdir, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { x as extractTar } from 'tar';

function isUnsafeTarPath(entryPath: string): boolean {
  const p = entryPath.replace(/\\/g, '/');
  return (
    p.startsWith('/') ||
    p.startsWith('../') ||
    p.includes('/../') ||
    p.includes('\0')
  );
}

async function listExtractedFiles(destDir: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        paths.push(relative(destDir, full).replace(/\\/g, '/'));
      }
    }
  }
  await walk(destDir);
  return paths.sort();
}

export async function extractTarballFile(tarballFile: string, destDir: string): Promise<string[]> {
  await mkdir(destDir, { recursive: true });
  try {
    await extractTar({
      file: tarballFile,
      cwd: destDir,
      strip: 1,
      strict: true,
      filter: (path: string) => !isUnsafeTarPath(path),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`tar extract failed: ${msg}`);
  }
  return listExtractedFiles(destDir);
}
