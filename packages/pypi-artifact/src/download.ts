const ALLOWED_HOSTS = new Set(['files.pythonhosted.org', 'pypi.org']);

export class PypiArtifactError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'invalid_artifact_url'
      | 'artifact_host_not_allowed'
      | 'download_failed'
      | 'integrity_verification_failed'
      | 'no_digest_metadata'
      | 'all_yanked'
      | 'extract_failed',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PypiArtifactError';
  }
}

export function assertAllowedArtifactUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PypiArtifactError(`invalid artifact URL: ${url}`, 'invalid_artifact_url');
  }
  if (parsed.protocol !== 'https:') {
    throw new PypiArtifactError(`artifact must use https: ${url}`, 'invalid_artifact_url');
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new PypiArtifactError(
      `artifact host not allowed: ${parsed.hostname}`,
      'artifact_host_not_allowed',
    );
  }
  return parsed;
}

export async function downloadArtifact(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Buffer> {
  assertAllowedArtifactUrl(url);
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new PypiArtifactError(
      `artifact download failed: ${res.status} ${url}`,
      'download_failed',
      res.status,
    );
  }
  return Buffer.from(await res.arrayBuffer());
}
