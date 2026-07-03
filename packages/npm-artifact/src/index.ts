import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type { NpmVersionDoc } from '@nabuos/npm-registry';
import { ArtifactError, downloadTarball } from './download.js';
import { extractTarballFile } from './extract.js';
import { verifyShasum, verifySriIntegrity, sha256Hex } from './integrity.js';
import { buildInventory, type NpmInventory } from './inventory.js';
import {
  artifactKey,
  extractDirPath,
  readStoredTarball,
  storeTarball,
  tarballPath,
} from './storage.js';

export { ArtifactError } from './download.js';
export { verifySriIntegrity, verifyShasum, sha256Hex } from './integrity.js';
export { buildInventory, type NpmInventory, type NpmFileStats } from './inventory.js';
export { artifactRoot, artifactKey } from './storage.js';

export interface NpmArtifactResult {
  name: string;
  version: string;
  url: string;
  sha256: string;
  integrity_verified: boolean;
  integrity_algorithm: string;
  integrity_weak: boolean;
  storage_path: string;
  extract_dir: string;
  extracted_file_count: number;
  extracted_files: string[];
}

function verifyDistIntegrity(
  data: Buffer,
  dist: NpmVersionDoc['dist'],
): { ok: true; algorithm: string; weak: boolean } | { ok: false; reason: string } {
  if (dist.integrity) {
    const result = verifySriIntegrity(data, dist.integrity);
    if (result.ok) {
      return { ok: true, algorithm: result.algorithm, weak: result.weak };
    }
    return { ok: false, reason: result.reason };
  }
  if (dist.shasum) {
    const result = verifyShasum(data, dist.shasum);
    if (result.ok) {
      return { ok: true, algorithm: result.algorithm, weak: result.weak };
    }
    return { ok: false, reason: result.reason };
  }
  return { ok: false, reason: 'no_integrity_metadata' };
}

async function isExtracted(key: string): Promise<boolean> {
  try {
    await access(join(extractDirPath(key), 'package.json'));
    return true;
  } catch {
    return false;
  }
}

/** Download (or load cached), verify SRI/shasum, store tarball, extract to isolated dir. */
export async function fetchNpmArtifact(
  name: string,
  version: string,
  versionDoc: NpmVersionDoc,
  fetchImpl: typeof fetch = fetch,
): Promise<NpmArtifactResult> {
  const key = artifactKey(name, version);
  let data = await readStoredTarball(key);

  if (!data) {
    data = await downloadTarball(versionDoc.dist.tarball, fetchImpl);
    await storeTarball(key, data);
  }

  const verified = verifyDistIntegrity(data, versionDoc.dist);
  if (!verified.ok) {
    const code =
      verified.reason === 'no_integrity_metadata'
        ? 'no_integrity_metadata'
        : 'integrity_verification_failed';
    throw new ArtifactError(
      `integrity verification failed for ${name}@${version}: ${verified.reason}`,
      code,
    );
  }

  const extractDir = extractDirPath(key);
  const storedPath = tarballPath(key);
  let extractedFiles: string[];

  if (await isExtracted(key)) {
    const inventory = await buildInventory(extractDir);
    extractedFiles = inventory.files.paths;
  } else {
    try {
      extractedFiles = await extractTarballFile(storedPath, extractDir);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ArtifactError(msg, 'extract_failed');
    }
  }

  return {
    name,
    version,
    url: versionDoc.dist.tarball,
    sha256: sha256Hex(data),
    integrity_verified: true,
    integrity_algorithm: verified.algorithm,
    integrity_weak: verified.weak,
    storage_path: storedPath,
    extract_dir: extractDir,
    extracted_file_count: extractedFiles.length,
    extracted_files: extractedFiles,
  };
}

export async function fetchNpmInventory(
  name: string,
  version: string,
  versionDoc: NpmVersionDoc,
  fetchImpl: typeof fetch = fetch,
): Promise<{ artifact: NpmArtifactResult; inventory: NpmInventory }> {
  const artifact = await fetchNpmArtifact(name, version, versionDoc, fetchImpl);
  const inventory = await buildInventory(artifact.extract_dir);
  return { artifact, inventory };
}
