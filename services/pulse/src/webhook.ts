import type { PulseAlert } from '@nabuos/types';

export async function deliverWebhook(
  url: string,
  alert: PulseAlert,
): Promise<{ delivered: boolean; status?: number }> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'nabuOS-Pulse/0.1' },
      body: JSON.stringify({
        event: 'pulse.risk_increased',
        alert_id: alert.alert_id,
        watchlist_id: alert.watchlist_id,
        package: `${alert.ecosystem}:${alert.name}`,
        previous_version: alert.previous_version,
        new_version: alert.new_version,
        previous_score: alert.previous_score,
        new_score: alert.new_score,
        previous_verdict: alert.previous_verdict,
        new_verdict: alert.new_verdict,
        mind_summary: alert.mind_summary,
        created_at: alert.created_at,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { delivered: false };
  }
  return { delivered: res.ok, status: res.status };
}
