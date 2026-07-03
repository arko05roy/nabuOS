import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE = 'https://api.osv.dev/v1';

export class OsvError extends Error {
  constructor(
    message: string,
    readonly code: 'api_error' | 'not_found',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OsvError';
  }
}

export interface OsvPackageQuery {
  name: string;
  ecosystem: string;
  version: string;
}

export interface OsvVulnRef {
  id: string;
  modified: string;
}

export interface OsvVulnSummary {
  id: string;
  modified: string;
  summary?: string;
  severity?: string;
  aliases?: string[];
}

export interface PackageVulnerability {
  package: OsvPackageQuery;
  vuln_ids: string[];
  vulns: OsvVulnSummary[];
}

export interface VulnerabilityReport {
  packages_queried: number;
  total_vuln_refs: number;
  packages: PackageVulnerability[];
  /** vuln id -> modified, for cache bookkeeping */
  cache_hits: number;
  cache_misses: number;
}

function cacheRoot(): string {
  return process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
}

function vulnCachePath(id: string): string {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return join(cacheRoot(), 'cache', 'osv', 'vulns', `${safe}.json`);
}

async function readVulnCache(id: string): Promise<OsvVulnSummary | null> {
  try {
    const raw = await readFile(vulnCachePath(id), 'utf8');
    return JSON.parse(raw) as OsvVulnSummary;
  } catch {
    return null;
  }
}

async function writeVulnCache(vuln: OsvVulnSummary): Promise<void> {
  const path = vulnCachePath(vuln.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(vuln));
}

function extractSeverity(detail: Record<string, unknown>): string | undefined {
  const db = detail.database_specific as Record<string, unknown> | undefined;
  if (typeof db?.severity === 'string') return db.severity;
  const sev = detail.severity as Array<{ type?: string; score?: string }> | undefined;
  if (sev?.[0]?.score) return sev[0].score;
  return undefined;
}

export function createOsvClient(fetchImpl: typeof fetch = fetch) {
  async function queryBatch(
    packages: OsvPackageQuery[],
  ): Promise<Array<{ vulns: OsvVulnRef[] }>> {
    const queries = packages.map((pkg) => ({ package: pkg }));
    const res = await fetchImpl(`${BASE}/querybatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ queries }),
    });
    if (!res.ok) {
      throw new OsvError(`OSV querybatch failed: ${res.status}`, 'api_error', res.status);
    }
    const data = (await res.json()) as { results: Array<{ vulns: OsvVulnRef[] }> };
    return data.results;
  }

  async function getVulnerability(id: string): Promise<OsvVulnSummary> {
    const cached = await readVulnCache(id);
    if (cached) return cached;

    const res = await fetchImpl(`${BASE}/vulns/${encodeURIComponent(id)}`);
    if (res.status === 404) {
      throw new OsvError(`OSV vuln not found: ${id}`, 'not_found', 404);
    }
    if (!res.ok) {
      throw new OsvError(`OSV GET /vulns failed: ${res.status}`, 'api_error', res.status);
    }

    const detail = (await res.json()) as Record<string, unknown>;
    const vuln: OsvVulnSummary = {
      id: String(detail.id ?? id),
      modified: String(detail.modified ?? ''),
      summary: typeof detail.summary === 'string' ? detail.summary : undefined,
      severity: extractSeverity(detail),
      aliases: Array.isArray(detail.aliases) ? (detail.aliases as string[]) : undefined,
    };
    await writeVulnCache(vuln);
    return vuln;
  }

  /** Batch OSV lookup for exact package versions; fetches full details on cache miss. */
  async function scanPackages(packages: OsvPackageQuery[]): Promise<VulnerabilityReport> {
    const unique = new Map<string, OsvPackageQuery>();
    for (const pkg of packages) {
      unique.set(`${pkg.ecosystem}:${pkg.name}@${pkg.version}`, pkg);
    }
    const list = [...unique.values()];
    if (list.length === 0) {
      return {
        packages_queried: 0,
        total_vuln_refs: 0,
        packages: [],
        cache_hits: 0,
        cache_misses: 0,
      };
    }

    const batch = await queryBatch(list);
    const vulnRefMap = new Map<string, OsvVulnRef>();
    for (const result of batch) {
      for (const ref of result.vulns ?? []) {
        vulnRefMap.set(ref.id, ref);
      }
    }

    let cacheHits = 0;
    let cacheMisses = 0;
    const vulnDetails = new Map<string, OsvVulnSummary>();

    for (const ref of vulnRefMap.values()) {
      const cached = await readVulnCache(ref.id);
      if (cached) {
        cacheHits += 1;
        vulnDetails.set(ref.id, cached);
      } else {
        cacheMisses += 1;
        const detail = await getVulnerability(ref.id);
        vulnDetails.set(ref.id, detail);
      }
    }

    const packagesOut: PackageVulnerability[] = list.map((pkg, i) => {
      const refs = batch[i]?.vulns ?? [];
      return {
        package: pkg,
        vuln_ids: refs.map((r) => r.id),
        vulns: refs.map((r) => vulnDetails.get(r.id)!).filter(Boolean),
      };
    });

    return {
      packages_queried: list.length,
      total_vuln_refs: vulnRefMap.size,
      packages: packagesOut,
      cache_hits: cacheHits,
      cache_misses: cacheMisses,
    };
  }

  return { queryBatch, getVulnerability, scanPackages };
}
