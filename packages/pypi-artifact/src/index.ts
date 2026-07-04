import { access } from 'node:fs/promises';
import type { PypiReleaseFile } from '@nabuos/pypi-registry';
import { downloadArtifact, PypiArtifactError } from './download.js';
import { extractDistribution } from './extract.js';
import { sha256Hex, verifySha256 } from './integrity.js';
import { buildPypiInventory, type PypiInventory } from './inventory.js';
import { selectPypiArtifact } from './select.js';
import {
  artifactKey,
  artifactPath,
  extractDirPath,
  listExtractedFiles,
  readStoredArtifact,
  storeArtifact,
} from './storage.js';

export { PypiArtifactError } from './download.js';
export { sha256Hex, verifySha256 } from './integrity.js';
export { selectPypiArtifact } from './select.js';
export {
  buildPypiInventory,
  parseMetadata,
  parseEntryPoints,
  parseSetupPy,
  parseSetupCfg,
  type PypiInventory,
  type PypiFileStats,
} from './inventory.js';

export interface PypiArtifactResult {
  name: string;
  version: string;
  filename: string;
  url: string;
  packagetype: string;
  sha256: string;
  digest_verified: boolean;
  yanked: boolean;
  storage_path: string;
  extract_dir: string;
  extracted_file_count: number;
  extracted_files: string[];
}

async function isExtracted(dir: string): Promise<boolean> {
  try {
    await access(dir);
    const files = await listExtractedFiles(dir);
    return files.length > 0;
  } catch {
    return false;
  }
}

export async function fetchPypiArtifact(
  name: string,
  version: string,
  urls: PypiReleaseFile[],
  fetchImpl: typeof fetch = fetch,
): Promise<PypiArtifactResult> {
  const dist = selectPypiArtifact(urls);
  const digest = dist.digests.sha256;
  if (!digest) {
    throw new PypiArtifactError(
      `no sha256 digest for ${dist.filename}`,
      'no_digest_metadata',
    );
  }

  const key = artifactKey(name, version);
  let data = await readStoredArtifact(key, dist.filename);

  if (!data) {
    data = await downloadArtifact(dist.url, fetchImpl);
    await storeArtifact(key, dist.filename, data);
  }

  const verified = verifySha256(data, digest);
  if (!verified.ok) {
    throw new PypiArtifactError(
      `integrity verification failed for ${name}==${version}: ${verified.reason}`,
      'integrity_verification_failed',
    );
  }

  const extractDir = extractDirPath(key);
  const storedPath = artifactPath(key, dist.filename);
  let extractedFiles: string[];

  if (await isExtracted(extractDir)) {
    extractedFiles = await listExtractedFiles(extractDir);
  } else {
    await extractDistribution(storedPath, extractDir, dist.packagetype);
    extractedFiles = await listExtractedFiles(extractDir);
  }

  return {
    name,
    version,
    filename: dist.filename,
    url: dist.url,
    packagetype: dist.packagetype,
    sha256: sha256Hex(data),
    digest_verified: true,
    yanked: dist.yanked,
    storage_path: storedPath,
    extract_dir: extractDir,
    extracted_file_count: extractedFiles.length,
    extracted_files: extractedFiles,
  };
}

export async function fetchPypiInventory(
  name: string,
  version: string,
  urls: PypiReleaseFile[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ artifact: PypiArtifactResult; inventory: PypiInventory }> {
  const artifact = await fetchPypiArtifact(name, version, urls, fetchImpl);
  const inventory = await buildPypiInventory(artifact.extract_dir);
  return { artifact, inventory };
}
