import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { PulseAlert, PulseWatchlist } from '@nabuos/types';

function pulseRoot(): string {
  const base = process.env.NABU_ARTIFACT_DIR ?? join(process.cwd(), '.nabu-artifacts');
  return join(base, 'pulse');
}

function watchlistPath(id: string): string {
  return join(pulseRoot(), 'watchlists', `${id}.json`);
}

function alertPath(id: string): string {
  return join(pulseRoot(), 'alerts', `${id}.json`);
}

const watchlistMemory = new Map<string, PulseWatchlist>();
const alertMemory = new Map<string, PulseAlert>();

export function createWatchlistId(): string {
  return `wl_${randomBytes(12).toString('hex')}`;
}

export function createAlertId(): string {
  return `pal_${randomBytes(12).toString('hex')}`;
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    await access(path);
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function loadWatchlist(id: string): Promise<PulseWatchlist | null> {
  const cached = watchlistMemory.get(id);
  if (cached) return cached;
  const wl = await readJson<PulseWatchlist>(watchlistPath(id));
  if (wl) watchlistMemory.set(id, wl);
  return wl;
}

export async function saveWatchlist(wl: PulseWatchlist): Promise<void> {
  wl.updated_at = new Date().toISOString();
  watchlistMemory.set(wl.watchlist_id, wl);
  const dir = join(pulseRoot(), 'watchlists');
  await mkdir(dir, { recursive: true });
  await writeFile(watchlistPath(wl.watchlist_id), JSON.stringify(wl, null, 2));
}

export async function listWatchlists(): Promise<PulseWatchlist[]> {
  const dir = join(pulseRoot(), 'watchlists');
  try {
    await access(dir);
  } catch {
    return [];
  }
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  const lists: PulseWatchlist[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const wl = await readJson<PulseWatchlist>(join(dir, file));
    if (wl) lists.push(wl);
  }
  return lists.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function saveAlert(alert: PulseAlert): Promise<void> {
  alertMemory.set(alert.alert_id, alert);
  const dir = join(pulseRoot(), 'alerts');
  await mkdir(dir, { recursive: true });
  await writeFile(alertPath(alert.alert_id), JSON.stringify(alert, null, 2));
}

export async function listAlertsForWatchlist(watchlistId: string): Promise<PulseAlert[]> {
  const dir = join(pulseRoot(), 'alerts');
  try {
    await access(dir);
  } catch {
    return [];
  }
  const { readdir } = await import('node:fs/promises');
  const files = await readdir(dir);
  const alerts: PulseAlert[] = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const alert = await readJson<PulseAlert>(join(dir, file));
    if (alert?.watchlist_id === watchlistId) alerts.push(alert);
  }
  return alerts.sort((a, b) => b.created_at.localeCompare(a.created_at));
}
