import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const BASE = 'https://api.deps.dev/v3';

export class DepsDevError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'api_error',
    readonly status?: number,
  ) {
    super(message);
    this.name = 'DepsDevError';
  }
}

export interface DepsDevVersionKey {
  system: string;
  name: string;
  version: string;
}

export type DepsDevRelation = 'SELF' | 'DIRECT' | 'INDIRECT' | string;

export interface DepsDevNode {
  versionKey: DepsDevVersionKey;
  bundled: boolean;
  relation: DepsDevRelation;
  errors?: unknown[];
}

export interface DepsDevEdge {
  fromNode: number;
  toNode: number;
  requirement: string;
}

export interface DependencyGraph {
  nodes: DepsDevNode[];
  edges: DepsDevEdge[];
  /** deps.dev top-level error string when graph is partial */
  error?: string;
  degraded: boolean;
  source: 'deps.dev' | 'cache';
}

function cacheRoot(): string {
  return process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
}

function cachePath(system: string, name: string, version: string): string {
  const safe = name.replace(/^@/, '').replace(/\//g, '--');
  return join(cacheRoot(), 'cache', 'deps-dev', system, safe, `${version}.json`);
}

async function readCache(system: string, name: string, version: string): Promise<DependencyGraph | null> {
  try {
    const raw = await readFile(cachePath(system, name, version), 'utf8');
    return JSON.parse(raw) as DependencyGraph;
  } catch {
    return null;
  }
}

async function writeCache(system: string, name: string, version: string, graph: DependencyGraph): Promise<void> {
  const path = cachePath(system, name, version);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(graph));
}

/** GET /v3/systems/{system}/packages/{package}/versions/{version}:dependencies */
export function createDepsDevClient(fetchImpl: typeof fetch = fetch) {
  async function getDependencies(
    system: string,
    name: string,
    version: string,
    options?: { skipCache?: boolean },
  ): Promise<DependencyGraph> {
    if (!options?.skipCache) {
      const cached = await readCache(system, name, version);
      if (cached) return { ...cached, source: 'cache' };
    }

    const encoded = encodeURIComponent(name);
    const url = `${BASE}/systems/${system}/packages/${encoded}/versions/${version}:dependencies`;
    const res = await fetchImpl(url);
    if (res.status === 404) {
      throw new DepsDevError(`deps.dev graph not found: ${name}@${version}`, 'not_found', 404);
    }
    if (!res.ok) {
      throw new DepsDevError(`deps.dev error: ${res.status}`, 'api_error', res.status);
    }

    const data = (await res.json()) as {
      nodes?: DepsDevNode[];
      edges?: DepsDevEdge[];
      error?: string;
    };

    const graph: DependencyGraph = {
      nodes: data.nodes ?? [],
      edges: data.edges ?? [],
      error: data.error,
      degraded: Boolean(data.error) || (data.nodes?.length ?? 0) === 0,
      source: 'deps.dev',
    };

    await writeCache(system, name, version, graph);
    return graph;
  }

  async function getNpmDependencies(name: string, version: string): Promise<DependencyGraph> {
    return getDependencies('npm', name, version);
  }

  async function getPypiDependencies(name: string, version: string): Promise<DependencyGraph> {
    return getDependencies('pypi', name, version);
  }

  return { getDependencies, getNpmDependencies, getPypiDependencies };
}
