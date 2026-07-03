/** SSRF guard: only registry.npmjs.org tarballs (per nabuOS risk register). */
const ALLOWED_TARBALL_HOST = 'registry.npmjs.org';

export class ArtifactError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_tarball_url'
      | 'tarball_host_not_allowed'
      | 'download_failed'
      | 'integrity_verification_failed'
      | 'no_integrity_metadata'
      | 'extract_failed',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ArtifactError';
  }
}

export function assertAllowedTarballUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ArtifactError(`invalid tarball URL: ${url}`, 'invalid_tarball_url');
  }
  if (parsed.protocol !== 'https:') {
    throw new ArtifactError(`tarball must use https: ${url}`, 'invalid_tarball_url');
  }
  if (parsed.hostname !== ALLOWED_TARBALL_HOST) {
    throw new ArtifactError(
      `tarball host not allowed: ${parsed.hostname}`,
      'tarball_host_not_allowed',
    );
  }
  return parsed;
}

export async function downloadTarball(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  assertAllowedTarballUrl(url);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new ArtifactError(
      `tarball download failed: ${res.status} ${url}`,
      'download_failed',
      res.status,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
