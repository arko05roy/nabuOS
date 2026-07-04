import type { PypiReleaseFile } from '@nabuos/pypi-registry';
import { PypiArtifactError } from './download.js';

/** Prefer wheel; fall back to sdist. Skip yanked distributions. */
export function selectPypiArtifact(urls: PypiReleaseFile[]): PypiReleaseFile {
  const active = urls.filter((f) => !f.yanked);
  if (active.length === 0) {
    throw new PypiArtifactError('all distributions are yanked', 'all_yanked');
  }
  const wheel = active.find((f) => f.packagetype === 'bdist_wheel');
  if (wheel) return wheel;
  const sdist = active.find((f) => f.packagetype === 'sdist');
  if (sdist) return sdist;
  return active[0]!;
}
