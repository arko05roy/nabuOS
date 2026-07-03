const REGISTRY = 'https://registry.npmjs.org';

export class NpmRegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'package_not_found' | 'version_not_found' | 'registry_error',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'NpmRegistryError';
  }
}

/** Encode scoped names: @babel/core → @babel%2Fcore */
export function encodePackageName(name: string): string {
  return encodeURIComponent(name);
}

export interface NpmDist {
  tarball: string;
  shasum?: string;
  integrity?: string;
  fileCount?: number;
  unpackedSize?: number;
}

export interface NpmVersionDoc {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  dist: NpmDist;
  [key: string]: unknown;
}

export interface NpmPackument {
  name: string;
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, NpmVersionDoc>;
  time?: Record<string, string>;
  [key: string]: unknown;
}

export interface NpmInstallMetadata {
  name: string;
  version: string;
  dist: NpmDist;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function createNpmRegistryClient(fetchImpl: typeof fetch = fetch) {
  async function registryGet(path: string, accept?: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: accept ?? 'application/json',
    };
    return fetchImpl(`${REGISTRY}/${path}`, { headers });
  }

  /** GET /:package with abbreviated install metadata */
  async function getPackument(name: string): Promise<NpmPackument> {
    const res = await registryGet(
      encodePackageName(name),
      'application/vnd.npm.install-v1+json',
    );
    if (res.status === 404) {
      throw new NpmRegistryError(`npm package not found: ${name}`, 'package_not_found', 404);
    }
    if (!res.ok) {
      throw new NpmRegistryError(
        `npm registry error for ${name}: ${res.status}`,
        'registry_error',
        res.status,
      );
    }
    return (await res.json()) as NpmPackument;
  }

  /** Resolve exact version doc + dist fields */
  async function getVersion(name: string, version: string): Promise<NpmVersionDoc> {
    const encoded = encodePackageName(name);
    const res = await registryGet(`${encoded}/${version}`);
    if (res.status === 404) {
      throw new NpmRegistryError(
        `npm version not found: ${name}@${version}`,
        'version_not_found',
        404,
      );
    }
    if (!res.ok) {
      throw new NpmRegistryError(
        `npm registry error for ${name}@${version}: ${res.status}`,
        'registry_error',
        res.status,
      );
    }
    return (await res.json()) as NpmVersionDoc;
  }

  return { getPackument, getVersion };
}
