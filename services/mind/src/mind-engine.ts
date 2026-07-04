import type { BtlResponseHeaders } from '@nabuos/types';
import { createBtlRuntime } from '@nabuos/btl-runtime';
import type { AuditJob, MindEvidence, MindRun, MindStep } from '@nabuos/types';
import {
  fetchGuardAudit,
  fetchGuardCheck,
  GuardClientError,
  parsePackageRef,
} from './guard-client.js';
import { createStepId, saveMindRun } from './run-store.js';

interface MindDecisionJson {
  decision: 'allow' | 'deny' | 'use_with_constraints' | 'investigate';
  confidence: number;
  summary: string;
  evidence: Array<{ type: string; ref: string; summary: string }>;
}

function now(): string {
  return new Date().toISOString();
}

function parseJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('{')
    ? trimmed
    : trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}

function auditEvidence(audit: AuditJob): MindEvidence[] {
  const refs: MindEvidence[] = [
    {
      type: 'guard_audit',
      ref: audit.audit_id,
      summary: `${audit.ecosystem}:${audit.name}@${audit.version} depth=${audit.depth}`,
    },
  ];

  const verdict = audit.depth === 'deep' && audit.deep_verdict ? audit.deep_verdict : audit.fast_verdict;
  if (verdict) {
    refs.push({
      type: 'guard_verdict',
      ref: `${audit.audit_id}:verdict`,
      summary: `verdict=${verdict.verdict} score=${verdict.score} (${verdict.scoring_version ?? 'unknown'})`,
    });
    for (const reason of verdict.reasons.slice(0, 12)) {
      refs.push({
        type: 'guard_reason',
        ref: `${audit.audit_id}:reason`,
        summary: reason,
      });
    }
  }

  if (audit.semgrep) {
    refs.push({
      type: 'semgrep_summary',
      ref: audit.semgrep.raw_path,
      summary: `${audit.semgrep.finding_count} semgrep findings`,
    });
    for (const f of audit.semgrep.findings.slice(0, 8)) {
      refs.push({
        type: 'semgrep_finding',
        ref: `${f.path}:${f.start_line}`,
        summary: `${f.severity}: ${f.message} (${f.rule_id})`,
      });
    }
  }

  if (audit.artifact) {
    refs.push({
      type: 'artifact',
      ref: audit.artifact.sha256,
      summary: `integrity_verified=${audit.artifact.integrity_verified}`,
    });
  }

  return refs;
}

async function resolveGuardAudits(
  contextRefs: MindRun['context_refs'],
): Promise<{ audits: AuditJob[]; evidence: MindEvidence[] }> {
  const audits: AuditJob[] = [];
  const evidence: MindEvidence[] = [];

  for (const ref of contextRefs ?? []) {
    if (ref.type === 'guard_audit') {
      const audit = await fetchGuardAudit(ref.id);
      audits.push(audit);
      evidence.push(...auditEvidence(audit));
      continue;
    }
    if (ref.type === 'package') {
      const parsed = parsePackageRef(ref.id);
      if (!parsed) {
        throw new GuardClientError(`invalid package ref: ${ref.id}`, 'audit_not_found');
      }
      const check = await fetchGuardCheck(parsed.ecosystem, parsed.name, parsed.version);
      const audit = await fetchGuardAudit(check.audit_id);
      audits.push(audit);
      evidence.push(...auditEvidence(audit));
    }
  }

  if (audits.length === 0) {
    throw new GuardClientError('context_refs must include guard_audit or package', 'audit_not_found');
  }

  return { audits, evidence };
}

function startStep(run: MindRun, type: MindStep['type']): MindStep {
  const step: MindStep = {
    step_id: createStepId(),
    type,
    status: 'running',
    evidence_refs: [],
    started_at: now(),
  };
  run.steps.push(step);
  return step;
}

function completeStep(step: MindStep, summary: string, evidenceRefs: MindEvidence[], btl?: BtlResponseHeaders): void {
  step.status = 'completed';
  step.summary = summary;
  step.evidence_refs = evidenceRefs;
  step.completed_at = now();
  if (btl?.request_id) step.btl_request_id = btl.request_id;
}

function failStep(step: MindStep, error: string): void {
  step.status = 'failed';
  step.error = error;
  step.completed_at = now();
}

function trackBtl(run: MindRun, headers: BtlResponseHeaders): void {
  if (headers.request_id) run.bt_runtime.request_ids.push(headers.request_id);
  if (headers.customer_charge != null) run.bt_runtime.total_charge += headers.customer_charge;
  if (headers.saved != null) run.bt_runtime.total_saved += headers.saved;
}

const PLAN_PROMPT = `You are nabu Mind. Plan how to answer the user's goal using ONLY Guard audit evidence provided later.
Output ONLY JSON: { "plan": string, "questions": string[] }`;

const CRITIQUE_PROMPT = `You are nabu Mind. Critique whether the Guard evidence is sufficient for a production decision.
Cite concrete audit fields (verdict, score, semgrep findings, artifact integrity). Never invent files or CVEs.
Output ONLY JSON: { "gaps": string[], "strengths": string[], "needs_more_evidence": boolean }`;

const DECIDE_PROMPT = `You are nabu Mind. Decide if the package should be used given the goal and Guard evidence.
Rules:
- Cite guard_audit id, verdict, score, and specific findings in evidence refs.
- Never invent vulnerabilities or files not in the evidence.
Output ONLY JSON:
{
  "decision": "allow" | "deny" | "use_with_constraints" | "investigate",
  "confidence": <number 0-1>,
  "summary": string,
  "evidence": [{ "type": string, "ref": string, "summary": string }]
}`;

export async function runMindEngine(run: MindRun): Promise<void> {
  const apiKey = process.env.GATEWAY_API_KEY;
  if (!apiKey) {
    run.status = 'failed';
    await saveMindRun(run);
    throw new Error('GATEWAY_API_KEY not configured');
  }

  const model = process.env.BTL_MIND_MODEL ?? 'btl-2';
  const btl = createBtlRuntime({ apiKey });

  run.status = 'running';
  await saveMindRun(run);

  try {
    const { audits, evidence: guardEvidence } = await resolveGuardAudits(run.context_refs);
    const auditPayload = JSON.stringify({
      goal: run.goal,
      mode: run.mode,
      audits: audits.map((a) => ({
        audit_id: a.audit_id,
        package: `${a.ecosystem}:${a.name}@${a.version}`,
        depth: a.depth,
        fast_verdict: a.fast_verdict,
        deep_verdict: a.deep_verdict,
        semgrep_finding_count: a.semgrep?.finding_count ?? 0,
        semgrep_findings: a.semgrep?.findings?.slice(0, 20) ?? [],
        artifact: a.artifact,
        phases: a.phases,
      })),
    });

    const planStep = startStep(run, 'plan');
    await saveMindRun(run);
    const planResult = await btl.chatCompletion({
      model,
      messages: [
        { role: 'system', content: PLAN_PROMPT },
        { role: 'user', content: `Goal: ${run.goal}\nMode: ${run.mode}` },
      ],
    });
    trackBtl(run, planResult.headers);
    completeStep(planStep, planResult.content?.slice(0, 500) ?? 'plan complete', [], planResult.headers);
    await saveMindRun(run);

    const gatherStep = startStep(run, 'gather');
    run.evidence = guardEvidence;
    completeStep(gatherStep, `gathered ${guardEvidence.length} evidence refs from ${audits.length} audit(s)`, guardEvidence);
    await saveMindRun(run);

    const critiqueStep = startStep(run, 'critique');
    await saveMindRun(run);
    const critiqueResult = await btl.chatCompletion({
      model,
      messages: [
        { role: 'system', content: CRITIQUE_PROMPT },
        { role: 'user', content: auditPayload },
      ],
    });
    trackBtl(run, critiqueResult.headers);
    completeStep(
      critiqueStep,
      critiqueResult.content?.slice(0, 800) ?? 'critique complete',
      guardEvidence.slice(0, 5),
      critiqueResult.headers,
    );
    await saveMindRun(run);

    const decideStep = startStep(run, 'decide');
    await saveMindRun(run);
    let decideResult = await btl.chatCompletion({
      model,
      messages: [
        { role: 'system', content: DECIDE_PROMPT },
        { role: 'user', content: `${auditPayload}\n\nGoal: ${run.goal}` },
      ],
    });
    trackBtl(run, decideResult.headers);

    let decision = decideResult.content ? parseJson<MindDecisionJson>(decideResult.content) : null;
    if (!decision) {
      const repair = await btl.chatCompletion({
        model,
        messages: [
          { role: 'system', content: DECIDE_PROMPT },
          { role: 'user', content: `${auditPayload}\n\nGoal: ${run.goal}` },
          { role: 'assistant', content: decideResult.content ?? '' },
          { role: 'user', content: 'Reply with ONLY valid JSON matching the schema.' },
        ],
      });
      trackBtl(run, repair.headers);
      decideResult = repair;
      decision = repair.content ? parseJson<MindDecisionJson>(repair.content) : null;
    }

    if (!decision) {
      failStep(decideStep, 'BTL returned invalid decision JSON');
      run.status = 'failed';
      await saveMindRun(run);
      return;
    }

    run.decision = decision.decision;
    run.confidence = decision.confidence;
    run.summary = decision.summary;
    if (Array.isArray(decision.evidence) && decision.evidence.length > 0) {
      run.evidence = [...run.evidence, ...decision.evidence];
    }

    completeStep(decideStep, decision.summary, run.evidence.slice(0, 10), decideResult.headers);
    await saveMindRun(run);

    const reportStep = startStep(run, 'report');
    completeStep(reportStep, decision.summary, run.evidence.slice(0, 15));
    run.status = 'completed';
    await saveMindRun(run);
  } catch (err) {
    run.status = 'failed';
    await saveMindRun(run);
    throw err;
  }
}
