import type { PulseAlert, PulseWatchlist } from '@nabuos/types';

const base = import.meta.env.VITE_PULSE_API ?? '/api/pulse';

async function pulseFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export function listWatchlists(): Promise<{ watchlists: PulseWatchlist[] }> {
  return pulseFetch('/watchlists');
}

export function createWatchlist(input: {
  name: string;
  webhook_url?: string;
  packages: Array<{ ecosystem: 'npm' | 'pypi'; name: string; baseline_version?: string }>;
}): Promise<PulseWatchlist> {
  return pulseFetch('/watchlists', { method: 'POST', body: JSON.stringify(input) });
}

export function getWatchlist(id: string): Promise<PulseWatchlist> {
  return pulseFetch(`/watchlists/${id}`);
}

export function listAlerts(id: string): Promise<{ alerts: PulseAlert[] }> {
  return pulseFetch(`/watchlists/${id}/alerts`);
}

export function runCheck(id: string): Promise<{
  watchlist_id: string;
  packages_checked: number;
  alerts_created: number;
  alerts: PulseAlert[];
}> {
  return pulseFetch(`/watchlists/${id}/check`, { method: 'POST' });
}
