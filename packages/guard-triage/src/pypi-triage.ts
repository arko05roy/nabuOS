import type { DependencyGraph } from '@nabuos/deps-dev';
import type { VulnerabilityReport } from '@nabuos/osv';
import {
  GuardTriageError,
  type GuardTriageFinding,
  type GuardTriageResult,
  type TriageNextPhase,
  type TriageVerdict,
} from './errors.js';
import { createBtlRuntime } from '@nabuos/btl-runtime';

const PYPI_SYSTEM_PROMPT = `You are nabu Guard triage. Classify PyPI package risk using ONLY the JSON evidence provided.

Rules:
- Never invent files, dependencies, or vulnerabilities not present in the input.
- Every finding MUST include a citation: a metadata field path (e.g. "requires_dist") or an inventory file path.
- OSV entries are deterministic signals; cite vuln id and affected package@version.
- Yanked releases are a risk signal when present in metadata.
- Output ONLY valid JSON matching this schema:
{
  "risk_score": <integer 0-100>,
  "verdict_recommendation": "allow" | "warn" | "block",
  "findings": [{ "severity": "low"|"medium"|"high"|"critical", "message": string, "citation": string }],
  "uncertainties": [string],
  "required_next_phase": "none" | "deep" | "sandbox"
}`;

export interface PypiGuardTriageInput {
  name: string;
  version: string;
  yanked: boolean;
  inventory: {
    requires_python?: string;
    requires_dist: string[];
    console_scripts: Record<string, string>;
    native_extensions: string[];
    metadata_source: string;
    files: { count: number; paths: string[] };
  };
  dependency_graph: DependencyGraph;
  vulnerabilities: VulnerabilityReport;
}

function buildPypiEvidence(input: PypiGuardTriageInput): string {
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
    yanked: input.yanked,
    inventory: {
      requires_python: input.inventory.requires_python,
      requires_dist: input.inventory.requires_dist,
      console_scripts: input.inventory.console_scripts,
      native_extensions: input.inventory.native_extensions,
      metadata_source: input.inventory.metadata_source,
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

export async function runPypiGuardTriage(
  input: PypiGuardTriageInput,
  options?: { apiKey?: string; model?: string },
): Promise<GuardTriageResult> {
  const apiKey = options?.apiKey ?? process.env.GATEWAY_API_KEY;
  if (!apiKey) {
    throw new GuardTriageError('GATEWAY_API_KEY not configured', 'btl_unconfigured');
  }

  const model = options?.model ?? process.env.BTL_TRIAGE_MODEL ?? 'btl-2';
  const btl = createBtlRuntime({ apiKey });
  const evidence = buildPypiEvidence(input);

  const messages = [
    { role: 'system', content: PYPI_SYSTEM_PROMPT },
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
    if (parsed) completion = repair;
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
