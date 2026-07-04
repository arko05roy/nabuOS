import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { promisify } from 'node:util';
import * as tar from 'tar';
import { PypiArtifactError } from './download.js';

const execFileAsync = promisify(execFile);

function filterPath(entryPath: string): boolean {
  const normalized = entryPath.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !normalized.includes('../');
}

/** .whl is a zip archive — ponytail: system unzip; pure-JS zip if Windows CI needs it */
async function extractWheel(archivePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  try {
    await execFileAsync('unzip', ['-q', archivePath, '-d', destDir]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PypiArtifactError(`wheel extract failed: ${msg}`, 'extract_failed');
  }
}

async function extractSdist(archivePath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  try {
    await tar.extract({
      file: archivePath,
      cwd: destDir,
      strip: 1,
      filter: (path) => filterPath(path),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new PypiArtifactError(`sdist extract failed: ${msg}`, 'extract_failed');
  }
}

export async function extractDistribution(
  archivePath: string,
  destDir: string,
  packagetype: string,
): Promise<void> {
  if (packagetype === 'bdist_wheel') {
    await extractWheel(archivePath, destDir);
    return;
  }
  if (packagetype === 'sdist') {
    await extractSdist(archivePath, destDir);
    return;
  }
  throw new PypiArtifactError(`unsupported packagetype: ${packagetype}`, 'extract_failed');
}
