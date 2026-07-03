import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname, basename } from 'node:path';

export interface NpmFileStats {
  count: number;
  total_bytes: number;
  extensions: Record<string, number>;
  paths: string[];
}

export interface NpmInventory {
  name: string;
  version: string;
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  dev_dependencies: Record<string, string>;
  optional_dependencies: Record<string, string>;
  peer_dependencies: Record<string, string>;
  bin: Record<string, string>;
  entrypoints: {
    main?: string;
    module?: string;
    types?: string;
    exports?: unknown;
  };
  files: NpmFileStats;
}

async function walkFiles(
  dir: string,
  root: string,
): Promise<{ paths: string[]; total_bytes: number; extensions: Record<string, number> }> {
  const paths: string[] = [];
  let total_bytes = 0;
  const extensions: Record<string, number> = {};

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(root, full).replace(/\\/g, '/');
        paths.push(rel);
        const st = await stat(full);
        total_bytes += st.size;
        const ext = extname(entry.name).toLowerCase() || '(none)';
        extensions[ext] = (extensions[ext] ?? 0) + 1;
      }
    }
  }

  await walk(dir);
  return { paths: paths.sort(), total_bytes, extensions };
}

function normalizeBin(bin: unknown, packageName: string): Record<string, string> {
  if (typeof bin === 'string') {
    return { [packageName]: bin };
  }
  if (bin && typeof bin === 'object' && !Array.isArray(bin)) {
    return bin as Record<string, string>;
  }
  return {};
}

export async function buildInventory(extractDir: string): Promise<NpmInventory> {
  const pkgPath = join(extractDir, 'package.json');
  const raw = await readFile(pkgPath, 'utf8');
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  const name = String(pkg.name ?? '');
  const version = String(pkg.version ?? '');
  const fileStats = await walkFiles(extractDir, extractDir);

  return {
    name,
    version,
    scripts: (pkg.scripts as Record<string, string>) ?? {},
    dependencies: (pkg.dependencies as Record<string, string>) ?? {},
    dev_dependencies: (pkg.devDependencies as Record<string, string>) ?? {},
    optional_dependencies: (pkg.optionalDependencies as Record<string, string>) ?? {},
    peer_dependencies: (pkg.peerDependencies as Record<string, string>) ?? {},
    bin: normalizeBin(pkg.bin, basename(name) || name),
    entrypoints: {
      main: typeof pkg.main === 'string' ? pkg.main : undefined,
      module: typeof pkg.module === 'string' ? pkg.module : undefined,
      types: typeof pkg.types === 'string' ? pkg.types : undefined,
      exports: pkg.exports,
    },
    files: {
      count: fileStats.paths.length,
      total_bytes: fileStats.total_bytes,
      extensions: fileStats.extensions,
      paths: fileStats.paths,
    },
  };
}
