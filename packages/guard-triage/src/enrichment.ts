import type { DependencyGraph } from '@nabuos/deps-dev';
import { DepsDevError } from '@nabuos/deps-dev';
import type { OsvPackageQuery } from '@nabuos/osv';
import { createOsvClient } from '@nabuos/osv';

export interface EnrichmentPhase {
  name: string;
  status: 'completed' | 'degraded' | 'failed';
  error?: string;
}

export interface NpmEnrichmentResult {
  dependency_graph: DependencyGraph;
  vulnerabilities: Awaited<ReturnType<ReturnType<typeof createOsvClient>['scanPackages']>>;
  phases: EnrichmentPhase[];
}

export async function enrichNpmPackage(
  name: string,
  version: string,
  depsDev: ReturnType<typeof import('@nabuos/deps-dev').createDepsDevClient>,
  osv: ReturnType<typeof createOsvClient>,
): Promise<NpmEnrichmentResult> {
  const phases: EnrichmentPhase[] = [];
  let graph: DependencyGraph;

  try {
    graph = await depsDev.getNpmDependencies(name, version);
    phases.push({
      name: 'deps.dev',
      status: graph.degraded ? 'degraded' : 'completed',
      error: graph.error,
    });
  } catch (err) {
    if (err instanceof DepsDevError && err.code === 'not_found') {
      graph = { nodes: [], edges: [], degraded: true, source: 'deps.dev' };
      phases.push({ name: 'deps.dev', status: 'degraded', error: err.message });
    } else {
      graph = { nodes: [], edges: [], degraded: true, source: 'deps.dev' };
      phases.push({
        name: 'deps.dev',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const packages: OsvPackageQuery[] = graph.nodes.map((n) => ({
    name: n.versionKey.name,
    ecosystem: 'npm',
    version: n.versionKey.version,
  }));

  if (packages.length === 0) {
    packages.push({ name, ecosystem: 'npm', version });
  }

  let vulnerabilities;
  try {
    vulnerabilities = await osv.scanPackages(packages);
    phases.push({ name: 'osv', status: 'completed' });
  } catch (err) {
    vulnerabilities = {
      packages_queried: 0,
      total_vuln_refs: 0,
      packages: [],
      cache_hits: 0,
      cache_misses: 0,
    };
    phases.push({
      name: 'osv',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { dependency_graph: graph, vulnerabilities, phases };
}

export async function enrichPypiPackage(
  name: string,
  version: string,
  depsDev: ReturnType<typeof import('@nabuos/deps-dev').createDepsDevClient>,
  osv: ReturnType<typeof createOsvClient>,
): Promise<NpmEnrichmentResult> {
  const phases: EnrichmentPhase[] = [];
  let graph: DependencyGraph;

  try {
    graph = await depsDev.getPypiDependencies(name, version);
    phases.push({
      name: 'deps.dev',
      status: graph.degraded ? 'degraded' : 'completed',
      error: graph.error,
    });
  } catch (err) {
    if (err instanceof DepsDevError && err.code === 'not_found') {
      graph = { nodes: [], edges: [], degraded: true, source: 'deps.dev' };
      phases.push({ name: 'deps.dev', status: 'degraded', error: err.message });
    } else {
      graph = { nodes: [], edges: [], degraded: true, source: 'deps.dev' };
      phases.push({
        name: 'deps.dev',
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const packages: OsvPackageQuery[] = graph.nodes.map((n) => ({
    name: n.versionKey.name,
    ecosystem: 'PyPI',
    version: n.versionKey.version,
  }));

  if (packages.length === 0) {
    packages.push({ name, ecosystem: 'PyPI', version });
  }

  let vulnerabilities;
  try {
    vulnerabilities = await osv.scanPackages(packages);
    phases.push({ name: 'osv', status: 'completed' });
  } catch (err) {
    vulnerabilities = {
      packages_queried: 0,
      total_vuln_refs: 0,
      packages: [],
      cache_hits: 0,
      cache_misses: 0,
    };
    phases.push({
      name: 'osv',
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { dependency_graph: graph, vulnerabilities, phases };
}
