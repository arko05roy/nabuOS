import type { BtlResponseHeaders } from '@nabuos/types';
import { createBtlRuntime, type BtlRuntimeError } from '@nabuos/btl-runtime';
import type { NpmInventory } from '@nabuos/npm-artifact';
import type { DependencyGraph } from '@nabuos/deps-dev';
import type { VulnerabilityReport } from '@nabuos/osv';

export class GuardTriageError extends Error {
  constructor(
    message: string,
    readonly code: 'btl_unconfigured' | 'btl_error' | 'invalid_json',
  ) {
    super(message);
    this.name = 'GuardTriageError';
  }
}

export type TriageVerdict = 'allow' | 'warn' | 'block';
export type TriageNextPhase = 'none' | 'deep' | 'sandbox';

export interface GuardTriageFinding {
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  /** Concrete metadata field or file path from input evidence */
  citation: string;
}

export interface GuardTriageResult {
  risk_score: number;
  verdict_recommendation: TriageVerdict;
  findings: GuardTriageFinding[];
  uncertainties: string[];
  required_next_phase: TriageNextPhase;
  scoring_version: 'guard-triage-v0.1';
  btl_runtime: BtlResponseHeaders & { model: string };
}

export interface GuardTriageInput {
  name: string;
  version: string;
  metadata: {
    dist: { integrity?: string; tarball: string };
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  inventory: NpmInventory;
  dependency_graph: DependencyGraph;
  vulnerabilities: VulnerabilityReport;
}

const SYSTEM_PROMPT = `You are nabu Guard triage. Classify npm package risk using ONLY the JSON evidence provided.

Rules:
- Never invent files, dependencies, or vulnerabilities not present in the input.
- Every finding MUST include a citation: a metadata field path (e.g. "scripts.postinstall") or an inventory file path (e.g. "package.json").
- OSV entries are deterministic signals; cite vuln id and affected package@version.
- Output ONLY valid JSON matching this schema:
{
  "risk_score": <integer 0-100>,
  "verdict_recommendation": "allow" | "warn" | "block",
  "findings": [{ "severity": "low"|"medium"|"high"|"critical", "message": string, "citation": string }],
  "uncertainties": [string],
  "required_next_phase": "none" | "deep" | "sandbox"
}`;

function buildEvidencePayload(input: GuardTriageInput): string {
  const osvSummary = input.vulnerabilities.packages
    .filter((p) => p.vuln_ids.length > 0)
    .map((p) => ({
      package: `${p.package.name}@${p.package.version}`,
      vuln_count: p.vuln_ids.length,
      vulns: p.vulns.map((v) => ({
        id: v.id,
        summary: v.summary,
        severity: v.severity,
      })),
    }));

  return JSON.stringify({
    package: `${input.name}@${input.version}`,
    metadata: {
      tarball: input.metadata.dist.tarball,
      integrity: input.metadata.dist.integrity,
      scripts: input.metadata.scripts,
      dependencies: input.metadata.dependencies,
      devDependencies: input.metadata.devDependencies ?? {},
    },
    inventory: {
      scripts: input.inventory.scripts,
      dependencies: input.inventory.dependencies,
      entrypoints: input.inventory.entrypoints,
      file_count: input.inventory.files.count,
      sample_paths: input.inventory.files.paths.slice(0, 40),
    },
    dependency_graph: {
      node_count: input.dependency_graph.nodes.length,
      degraded: input.dependency_graph.degraded,
      relations: input.dependency_graph.nodes.map((n) => ({
        name: n.versionKey.name,
        version: n.versionKey.version,
        relation: n.relation,
      })),
    },
    osv_summary: osvSummary,
  });
}

function parseTriageJson(text: string): GuardTriageResult | null {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? trimmed;

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (
      typeof parsed.risk_score !== 'number' ||
      typeof parsed.verdict_recommendation !== 'string' ||
      !Array.isArray(parsed.findings) ||
      !Array.isArray(parsed.uncertainties) ||
      typeof parsed.required_next_phase !== 'string'
    ) {
      return null;
    }
    return {
      risk_score: Math.round(parsed.risk_score),
      verdict_recommendation: parsed.verdict_recommendation as TriageVerdict,
      findings: parsed.findings as GuardTriageFinding[],
      uncertainties: parsed.uncertainties as string[],
      required_next_phase: parsed.required_next_phase as TriageNextPhase,
      scoring_version: 'guard-triage-v0.1',
      btl_runtime: { model: '' },
    };
  } catch {
    return null;
  }
}

export async function runGuardTriage(
  input: GuardTriageInput,
  options?: { apiKey?: string; model?: string },
): Promise<GuardTriageResult> {
  const apiKey = options?.apiKey ?? process.env.GATEWAY_API_KEY;
  if (!apiKey) {
    throw new GuardTriageError('GATEWAY_API_KEY not configured', 'btl_unconfigured');
  }

  const model = options?.model ?? process.env.BTL_TRIAGE_MODEL ?? 'btl-2';
  const btl = createBtlRuntime({ apiKey });
  const evidence = buildEvidencePayload(input);

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: evidence },
  ];

  let completion;
  try {
    completion = await btl.chatCompletion({ model, messages });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GuardTriageError(`BTL triage failed: ${msg}`, 'btl_error');
  }

  let parsed = completion.content ? parseTriageJson(completion.content) : null;

  if (!parsed) {
    const repair = await btl.chatCompletion({
      model,
      messages: [
        ...messages,
        { role: 'assistant', content: completion.content ?? '' },
        {
          role: 'user',
          content:
            'Your previous response was not valid JSON. Reply with ONLY the JSON object matching the schema. No markdown.',
        },
      ],
    });
    parsed = repair.content ? parseTriageJson(repair.content) : null;
    if (parsed) {
      completion = repair;
    }
  }

  if (!parsed) {
    throw new GuardTriageError('BTL triage returned invalid JSON after repair', 'invalid_json');
  }

  parsed.btl_runtime = {
    model: completion.model,
    ...completion.headers,
  };

  return parsed;
}

export {
  enrichNpmPackage,
  enrichPypiPackage,
  type NpmEnrichmentResult,
  type EnrichmentPhase,
} from './enrichment.js';
