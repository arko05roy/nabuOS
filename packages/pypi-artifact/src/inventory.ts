import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';

export interface PypiFileStats {
  count: number;
  total_bytes: number;
  extensions: Record<string, number>;
  paths: string[];
}

export interface PypiInventory {
  name: string;
  version: string;
  requires_python?: string;
  requires_dist: string[];
  optional_requires_dist: string[];
  console_scripts: Record<string, string>;
  entry_points: Record<string, Record<string, string>>;
  native_extensions: string[];
  metadata_source: 'METADATA' | 'PKG-INFO' | 'pyproject.toml' | 'setup.cfg' | 'setup.py' | 'unknown';
  /** Manifest files that contributed fields */
  sources: string[];
  files: PypiFileStats;
}

/** RFC 822 / PEP 643 core metadata fields */
export function parseMetadata(content: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  let key = '';
  for (const line of content.split(/\r?\n/)) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && key) {
      const last = fields[key]!.length - 1;
      fields[key]![last] = `${fields[key]![last]} ${line.trim()}`;
    } else if (line.includes(':')) {
      const idx = line.indexOf(':');
      key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      const bucket = fields[key] ?? [];
      bucket.push(val);
      fields[key] = bucket;
    } else {
      key = '';
    }
  }
  return fields;
}

/** Parse [group] sections from entry_points.txt — setup.py never executed */
export function parseEntryPoints(content: string): Record<string, Record<string, string>> {
  const groups: Record<string, Record<string, string>> = {};
  let section = '';
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const sectionMatch = trimmed.match(/^\[(.+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1]!;
      if (!groups[section]) groups[section] = {};
      continue;
    }
    const eq = trimmed.indexOf('=');
    if (eq > 0 && section) {
      const name = trimmed.slice(0, eq).trim();
      const target = trimmed.slice(eq + 1).trim();
      groups[section]![name] = target;
    }
  }
  return groups;
}

function parseQuotedList(block: string): string[] {
  const out: string[] = [];
  const re = /(['"])(.*?)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) out.push(m[2]!);
  return out;
}

/** ponytail: regex read-only setup.py — never executed */
export function parseSetupPy(content: string): {
  dependencies: string[];
  entry_points: Record<string, Record<string, string>>;
  native_extensions: string[];
} {
  const dependencies: string[] = [];
  const entry_points: Record<string, Record<string, string>> = {};
  const native_extensions: string[] = [];

  const installMatch = content.match(/install_requires\s*=\s*(\[[\s\S]*?\]|['"][^'"]+['"])/);
  if (installMatch) {
    const block = installMatch[1]!;
    dependencies.push(...(block.startsWith('[') ? parseQuotedList(block) : [block.replace(/^['"]|['"]$/g, '')]));
  }

  const epMatch = content.match(/entry_points\s*=\s*(\{[\s\S]*?\})/);
  if (epMatch) {
    const block = epMatch[1]!;
    const groupRe = /['"]([^'"]+)['"]\s*:\s*(\[[\s\S]*?\]|['"][^'"]*['"])/g;
    let gm: RegExpExecArray | null;
    while ((gm = groupRe.exec(block))) {
      const group = gm[1]!;
      const body = gm[2]!;
      entry_points[group] ??= {};
      if (body.startsWith('[')) {
        for (const line of parseQuotedList(body)) {
          const eq = line.indexOf('=');
          if (eq === -1) continue;
          entry_points[group]![line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
        }
      }
    }
  }

  if (/ext_modules\s*=/.test(content) || /Extension\s*\(/.test(content)) {
    native_extensions.push('setup.py:ext_modules');
  }

  return { dependencies, entry_points, native_extensions };
}

export function parseSetupCfg(content: string): {
  dependencies: string[];
  requires_python?: string;
  entry_points: Record<string, Record<string, string>>;
} {
  const dependencies: string[] = [];
  const entry_points: Record<string, Record<string, string>> = {};
  let section = '';
  let installBlock = false;
  let requires_python: string | undefined;

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) continue;
    const sec = trimmed.match(/^\[(.+)]$/);
    if (sec) {
      section = sec[1]!.toLowerCase();
      installBlock = false;
      continue;
    }
    if (section === 'options') {
      if (trimmed.startsWith('install_requires')) {
        installBlock = true;
        const inline = trimmed.split('=').slice(1).join('=').trim();
        if (inline) dependencies.push(...inline.split(',').map((s) => s.trim()).filter(Boolean));
        continue;
      }
      if (installBlock && !trimmed.includes('=')) {
        dependencies.push(trimmed);
        continue;
      }
      installBlock = false;
      if (trimmed.startsWith('python_requires')) {
        requires_python = trimmed.split('=').slice(1).join('=').trim();
      }
    }
    if (section.startsWith('options.entry_points')) {
      const group = section.slice('options.entry_points'.length).replace(/^\./, '') || 'console_scripts';
      entry_points[group] ??= {};
      const eq = trimmed.indexOf('=');
      if (eq !== -1) {
        entry_points[group]![trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
    }
  }

  return { dependencies, requires_python, entry_points };
}

function mergeUnique(base: string[], extra: string[]): string[] {
  const seen = new Set(base);
  for (const item of extra) {
    if (!seen.has(item)) {
      seen.add(item);
      base.push(item);
    }
  }
  return base;
}

function findSetupRelPath(paths: string[], filename: string): string | null {
  return paths.find((p) => p === filename || p.endsWith(`/${filename}`)) ?? null;
}

function firstField(fields: Record<string, string[]>, key: string): string | undefined {
  return fields[key]?.[0];
}

function allFields(fields: Record<string, string[]>, key: string): string[] {
  return fields[key] ?? [];
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

function findMetadataRelPath(paths: string[]): string | null {
  const distInfo = paths.find((p) => /\.dist-info\/METADATA$/i.test(p));
  if (distInfo) return distInfo;
  for (const name of ['PKG-INFO', 'METADATA']) {
    const hit = paths.find((p) => p === name || p.endsWith(`/${name}`));
    if (hit) return hit;
  }
  return null;
}

function findEntryPointsRelPath(paths: string[]): string | null {
  return paths.find((p) => /\.dist-info\/entry_points\.txt$/i.test(p)) ?? null;
}

function findPyprojectRelPath(paths: string[]): string | null {
  return paths.find((p) => p === 'pyproject.toml' || p.endsWith('/pyproject.toml')) ?? null;
}

function findSetupPyRelPath(paths: string[]): string | null {
  return findSetupRelPath(paths, 'setup.py');
}

function findSetupCfgRelPath(paths: string[]): string | null {
  return findSetupRelPath(paths, 'setup.cfg');
}

/** ponytail: regex scan for requires-python only; full TOML parse when inventory gaps hurt */
function parsePyprojectBasics(content: string): {
  requires_python?: string;
  dependencies: string[];
} {
  const requires_python = content.match(/requires-python\s*=\s*["']([^"']+)["']/i)?.[1];
  const deps: string[] = [];
  const block = content.match(/dependencies\s*=\s*\[([\s\S]*?)]/i)?.[1];
  if (block) {
    for (const m of block.matchAll(/["']([^"']+)["']/g)) {
      deps.push(m[1]!);
    }
  }
  return { requires_python, dependencies: deps };
}

const NATIVE_EXT = /\.(so|pyd|dylib|dll|abi3\.so)(\d+)?$/i;

export async function buildPypiInventory(extractDir: string): Promise<PypiInventory> {
  const fileStats = await walkFiles(extractDir, extractDir);
  const native_extensions = fileStats.paths.filter((p) => NATIVE_EXT.test(p));

  let name = '';
  let version = '';
  let requires_python: string | undefined;
  let requires_dist: string[] = [];
  let optional_requires_dist: string[] = [];
  let metadata_source: PypiInventory['metadata_source'] = 'unknown';
  const sources: string[] = [];

  const metadataRel = findMetadataRelPath(fileStats.paths);
  if (metadataRel) {
    sources.push(metadataRel);
    const fields = parseMetadata(await readFile(join(extractDir, metadataRel), 'utf8'));
    name = firstField(fields, 'Name') ?? name;
    version = firstField(fields, 'Version') ?? version;
    requires_python = firstField(fields, 'Requires-Python');
    requires_dist = allFields(fields, 'Requires-Dist');
    optional_requires_dist = allFields(fields, 'Provides-Extra').flatMap((extra) =>
      allFields(fields, 'Requires-Dist')
        .filter((d) => d.includes(`extra == "${extra}"`) || d.includes(`extra == '${extra}'`))
        .map((d) => d),
    );
    metadata_source = metadataRel.endsWith('PKG-INFO') ? 'PKG-INFO' : 'METADATA';
  }

  const pyprojectRel = findPyprojectRelPath(fileStats.paths);
  if (pyprojectRel && (!name || requires_dist.length === 0)) {
    sources.push(pyprojectRel);
    const basics = parsePyprojectBasics(await readFile(join(extractDir, pyprojectRel), 'utf8'));
    requires_python = requires_python ?? basics.requires_python;
    if (requires_dist.length === 0) requires_dist = basics.dependencies;
    if (!name) metadata_source = 'pyproject.toml';
  }

  let entry_points: Record<string, Record<string, string>> = {};

  const setupPyRel = findSetupPyRelPath(fileStats.paths);
  if (setupPyRel) {
    sources.push(setupPyRel);
    if (requires_dist.length === 0) {
      const setup = parseSetupPy(await readFile(join(extractDir, setupPyRel), 'utf8'));
      requires_dist = setup.dependencies;
      for (const [group, items] of Object.entries(setup.entry_points)) {
        entry_points[group] = { ...entry_points[group], ...items };
      }
      mergeUnique(native_extensions, setup.native_extensions);
      if (metadata_source === 'unknown') metadata_source = 'setup.py';
    }
  }

  const setupCfgRel = findSetupCfgRelPath(fileStats.paths);
  if (setupCfgRel) {
    sources.push(setupCfgRel);
    if (requires_dist.length === 0) {
      const cfg = parseSetupCfg(await readFile(join(extractDir, setupCfgRel), 'utf8'));
      requires_dist = cfg.dependencies;
      requires_python = requires_python ?? cfg.requires_python;
      for (const [group, items] of Object.entries(cfg.entry_points)) {
        entry_points[group] = { ...entry_points[group], ...items };
      }
      if (metadata_source === 'unknown') metadata_source = 'setup.cfg';
    }
  }

  const entryPointsRel = findEntryPointsRelPath(fileStats.paths);
  if (entryPointsRel) {
    sources.push(entryPointsRel);
    const parsed = parseEntryPoints(await readFile(join(extractDir, entryPointsRel), 'utf8'));
    for (const [group, items] of Object.entries(parsed)) {
      entry_points[group] = { ...entry_points[group], ...items };
    }
  }

  const console_scripts = entry_points['console_scripts'] ?? {};

  return {
    name,
    version,
    requires_python,
    requires_dist,
    optional_requires_dist,
    console_scripts,
    entry_points,
    native_extensions,
    metadata_source,
    sources,
    files: {
      count: fileStats.paths.length,
      total_bytes: fileStats.total_bytes,
      extensions: fileStats.extensions,
      paths: fileStats.paths,
    },
  };
}
