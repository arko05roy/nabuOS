const PYPI = 'https://pypi.org';
const SIMPLE_ACCEPT = 'application/vnd.pypi.simple.v1+json';

export class PypiRegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'package_not_found' | 'version_not_found' | 'registry_error',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'PypiRegistryError';
  }
}

/** PEP 503: case-insensitive; runs of `.`, `_`, `-` are equivalent. */
export function normalizePackageName(name: string): string {
  return name.trim().replace(/[-_.]+/g, '-').toLowerCase();
}

/** Match distribution filenames for an exact release version. */
export function fileMatchesVersion(filename: string, version: string): boolean {
  return filename.includes(`-${version}-`) || filename.includes(`-${version}.`);
}

export function isYanked(value: boolean | string | null | undefined): boolean {
  return value !== false && value != null && value !== '';
}

export interface PypiSimpleFile {
  filename: string;
  url: string;
  hashes: Record<string, string>;
  size: number;
  'upload-time': string;
  'requires-python'?: string | null;
  yanked: boolean | string;
  'data-dist-info-metadata'?: boolean;
  'core-metadata'?: boolean;
}

export interface PypiSimpleIndex {
  name: string;
  files: PypiSimpleFile[];
  meta?: { 'api-version'?: string };
}

export interface PypiReleaseFile {
  filename: string;
  url: string;
  digests: {
    sha256?: string;
    md5?: string;
    blake2b_256?: string;
  };
  packagetype: string;
  python_version: string;
  requires_python?: string;
  size: number;
  upload_time_iso_8601?: string;
  yanked: boolean;
  yanked_reason?: string | null;
}

export interface PypiProjectInfo {
  name: string;
  version: string;
  summary?: string;
  requires_python?: string;
  author?: string;
  license?: string;
  project_urls?: Record<string, string>;
  classifiers?: string[];
  [key: string]: unknown;
}

export interface PypiProjectJson {
  info: PypiProjectInfo;
  releases: Record<string, PypiReleaseFile[]>;
  urls: PypiReleaseFile[];
}

export interface PypiReleaseJson {
  info: PypiProjectInfo;
  urls: PypiReleaseFile[];
  vulnerabilities?: unknown[];
}

export interface PypiVersionDoc {
  name: string;
  version: string;
  normalized_name: string;
  info: PypiProjectInfo;
  /** Release JSON file list (authoritative digests + yanked_reason). */
  urls: PypiReleaseFile[];
  /** Simple index files for this version (PEP 691). */
  simple_files: PypiSimpleFile[];
  requires_python?: string;
  yanked_files: PypiReleaseFile[];
  all_files_yanked: boolean;
}

export function createPypiRegistryClient(fetchImpl: typeof fetch = fetch) {
  async function pypiGet(path: string, accept?: string): Promise<Response> {
    const headers: Record<string, string> = {};
    if (accept) headers.Accept = accept;
    return fetchImpl(`${PYPI}/${path}`, { headers });
  }

  /** GET /simple/<project>/ — PEP 691 Simple JSON index */
  async function getSimpleIndex(name: string): Promise<PypiSimpleIndex> {
    const normalized = normalizePackageName(name);
    const res = await pypiGet(`simple/${normalized}/`, SIMPLE_ACCEPT);
    if (res.status === 404) {
      throw new PypiRegistryError(`pypi project not found: ${name}`, 'package_not_found', 404);
    }
    if (!res.ok) {
      throw new PypiRegistryError(
        `pypi simple index error for ${name}: ${res.status}`,
        'registry_error',
        res.status,
      );
    }
    return (await res.json()) as PypiSimpleIndex;
  }

  /** GET /pypi/<project>/json — project metadata at latest version */
  async function getProject(name: string): Promise<PypiProjectJson> {
    const normalized = normalizePackageName(name);
    const res = await pypiGet(`pypi/${normalized}/json`);
    if (res.status === 404) {
      throw new PypiRegistryError(`pypi project not found: ${name}`, 'package_not_found', 404);
    }
    if (!res.ok) {
      throw new PypiRegistryError(
        `pypi project json error for ${name}: ${res.status}`,
        'registry_error',
        res.status,
      );
    }
    return (await res.json()) as PypiProjectJson;
  }

  /** GET /pypi/<project>/<version>/json — release metadata fallback */
  async function getReleaseJson(name: string, version: string): Promise<PypiReleaseJson> {
    const normalized = normalizePackageName(name);
    const res = await pypiGet(`pypi/${normalized}/${version}/json`);
    if (res.status === 404) {
      throw new PypiRegistryError(
        `pypi version not found: ${name}==${version}`,
        'version_not_found',
        404,
      );
    }
    if (!res.ok) {
      throw new PypiRegistryError(
        `pypi release json error for ${name}==${version}: ${res.status}`,
        'registry_error',
        res.status,
      );
    }
    return (await res.json()) as PypiReleaseJson;
  }

  /** Simple index discovery + release JSON metadata for one version. */
  async function getVersion(name: string, version: string): Promise<PypiVersionDoc> {
    const normalized = normalizePackageName(name);
    const [simple, release] = await Promise.all([
      getSimpleIndex(name),
      getReleaseJson(name, version),
    ]);

    const simple_files = simple.files.filter((f) => fileMatchesVersion(f.filename, version));
    const yanked_files = release.urls.filter((f) => f.yanked);
    const all_files_yanked = release.urls.length > 0 && yanked_files.length === release.urls.length;

    return {
      name: release.info.name ?? name,
      version: release.info.version ?? version,
      normalized_name: normalized,
      info: release.info,
      urls: release.urls,
      simple_files,
      requires_python: release.info.requires_python,
      yanked_files,
      all_files_yanked,
    };
  }

  return { getSimpleIndex, getProject, getReleaseJson, getVersion };
}
