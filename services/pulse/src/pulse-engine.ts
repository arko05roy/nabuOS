import type { PulseAlert, PulseWatchlist, PulseWatchPackage, Verdict } from '@nabuos/types';
import { ensureGuardAudit } from './guard-client.js';
import { runMindComparison } from './mind-client.js';
import { fetchLatestVersion } from './registry.js';
import { createAlertId, saveAlert, saveWatchlist } from './watchlist-store.js';
import { deliverWebhook } from './webhook.js';

export interface PulseCheckResult {
  watchlist_id: string;
  packages_checked: number;
  alerts_created: number;
  alerts: PulseAlert[];
}

const VERDICT_RANK: Record<Verdict, number> = { allow: 0, warn: 1, block: 2 };

function riskIncreased(
  previousScore: number | undefined,
  newScore: number,
  previousVerdict?: Verdict,
  newVerdict?: Verdict,
): boolean {
  if (previousScore != null && newScore < previousScore) return true;
  if (
    previousVerdict &&
    newVerdict &&
    VERDICT_RANK[newVerdict] > VERDICT_RANK[previousVerdict]
  ) {
    return true;
  }
  return false;
}

async function processPackage(
  wl: PulseWatchlist,
  pkg: PulseWatchPackage,
): Promise<PulseAlert | null> {
  const latest = await fetchLatestVersion(pkg.ecosystem, pkg.name);
  const now = new Date().toISOString();

  if (!pkg.last_seen_version) {
    const seedVersion = pkg.baseline_version ?? latest;
    const audit = await ensureGuardAudit(pkg.ecosystem, pkg.name, seedVersion);
    pkg.last_seen_version = seedVersion;
    pkg.last_audit_id = audit.audit_id;
    pkg.last_verdict = audit.verdict as Verdict;
    pkg.last_score = audit.score;
    pkg.last_checked_at = now;
    return null;
  }

  if (latest === pkg.last_seen_version) {
    pkg.last_checked_at = now;
    return null;
  }

  const previousVersion = pkg.last_seen_version;
  let prevScore = pkg.last_score;
  const previousVerdict = pkg.last_verdict;
  let prevAudit = pkg.last_audit_id;

  if (!prevAudit) {
    const prev = await ensureGuardAudit(pkg.ecosystem, pkg.name, previousVersion);
    prevAudit = prev.audit_id;
    prevScore ??= prev.score;
  }

  const newAudit = await ensureGuardAudit(pkg.ecosystem, pkg.name, latest);
  const increased = riskIncreased(
    prevScore,
    newAudit.score,
    previousVerdict,
    newAudit.verdict as Verdict,
  );

  pkg.last_seen_version = latest;
  pkg.last_audit_id = newAudit.audit_id;
  pkg.last_verdict = newAudit.verdict as Verdict;
  pkg.last_score = newAudit.score;
  pkg.last_checked_at = now;

  if (!increased) return null;

  const alert: PulseAlert = {
    alert_id: createAlertId(),
    watchlist_id: wl.watchlist_id,
    ecosystem: pkg.ecosystem,
    name: pkg.name,
    previous_version: previousVersion,
    new_version: latest,
    previous_audit_id: prevAudit,
    new_audit_id: newAudit.audit_id,
    previous_verdict: previousVerdict,
    new_verdict: newAudit.verdict as Verdict,
    previous_score: prevScore,
    new_score: newAudit.score,
    risk_increased: true,
    webhook_delivered: false,
    created_at: now,
  };

  if (prevAudit && newAudit.audit_id) {
    try {
      const mind = await runMindComparison({
        ecosystem: pkg.ecosystem,
        name: pkg.name,
        previousVersion,
        newVersion: latest,
        previousAuditId: prevAudit,
        newAuditId: newAudit.audit_id,
      });
      alert.mind_run_id = mind.mind_run_id;
      alert.mind_summary = mind.summary;
    } catch (err) {
      alert.mind_summary = err instanceof Error ? err.message : String(err);
    }
  }

  if (wl.webhook_url) {
    const delivery = await deliverWebhook(wl.webhook_url, alert);
    alert.webhook_delivered = delivery.delivered;
    alert.webhook_status = delivery.status;
  }

  return alert;
}

export async function runWatchlistCheck(wl: PulseWatchlist): Promise<PulseCheckResult> {
  const alerts: PulseAlert[] = [];

  for (const pkg of wl.packages) {
    const alert = await processPackage(wl, pkg);
    if (alert) {
      await saveAlert(alert);
      alerts.push(alert);
    }
  }

  await saveWatchlist(wl);

  return {
    watchlist_id: wl.watchlist_id,
    packages_checked: wl.packages.length,
    alerts_created: alerts.length,
    alerts,
  };
}

export async function pulseDependenciesReady(): Promise<{
  ready: boolean;
  checks: Record<string, 'ok' | 'fail' | 'unknown'>;
}> {
  const checks: Record<string, 'ok' | 'fail' | 'unknown'> = { process: 'ok' };
  const guardUrl = (process.env.GUARD_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
  const mindUrl = (process.env.MIND_URL ?? 'http://127.0.0.1:3002').replace(/\/$/, '');

  try {
    checks.guard = (await fetch(`${guardUrl}/healthz`)).ok ? 'ok' : 'fail';
  } catch {
    checks.guard = 'fail';
  }
  try {
    checks.mind = (await fetch(`${mindUrl}/healthz`)).ok ? 'ok' : 'fail';
  } catch {
    checks.mind = 'fail';
  }

  const ready = checks.guard === 'ok' && checks.mind === 'ok';
  return { ready, checks };
}
