import { useCallback, useEffect, useState } from 'react';
import type { PulseAlert, PulseWatchlist } from '@nabuos/types';
import * as api from './api';

function verdictClass(v: string): string {
  if (v === 'block') return 'text-[var(--color-danger)]';
  if (v === 'warn') return 'text-[var(--color-warn)]';
  return 'text-[var(--color-safe)]';
}

export default function App() {
  const [watchlists, setWatchlists] = useState<PulseWatchlist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PulseAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [webhook, setWebhook] = useState('');
  const [pkgEcosystem, setPkgEcosystem] = useState<'npm' | 'pypi'>('npm');
  const [pkgName, setPkgName] = useState('');
  const [baseline, setBaseline] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { watchlists: lists } = await api.listWatchlists();
      setWatchlists(lists);
      if (!selectedId && lists[0]) setSelectedId(lists[0].watchlist_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) return;
    void api.listAlerts(selectedId).then((r) => setAlerts(r.alerts)).catch(() => setAlerts([]));
  }, [selectedId, checking]);

  const selected = watchlists.find((w) => w.watchlist_id === selectedId) ?? null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !pkgName.trim()) return;
    setError(null);
    try {
      const wl = await api.createWatchlist({
        name: name.trim(),
        webhook_url: webhook.trim() || undefined,
        packages: [
          {
            ecosystem: pkgEcosystem,
            name: pkgName.trim(),
            baseline_version: baseline.trim() || undefined,
          },
        ],
      });
      setName('');
      setPkgName('');
      setBaseline('');
      setSelectedId(wl.watchlist_id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleCheck() {
    if (!selectedId) return;
    setChecking(true);
    setError(null);
    try {
      await api.runCheck(selectedId);
      await refresh();
      const { alerts: fresh } = await api.listAlerts(selectedId);
      setAlerts(fresh);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-10 border-b border-[var(--color-line)] pb-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.2em] text-[var(--color-pulse)]">
          nabu Apps
        </p>
        <h1
          className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight md:text-5xl"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Pulse
        </h1>
        <p className="mt-3 max-w-xl text-[var(--color-muted)]">
          Watch npm and PyPI packages. Real registry versions, Guard audits, Mind comparisons —
          alerts when risk rises.
        </p>
      </header>

      {error && (
        <div
          className="mb-6 rounded border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-4 py-3 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-6">
          <section className="rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              New watchlist
            </h2>
            <form onSubmit={handleCreate} className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--color-muted)]">Name</span>
                <input
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pulse)] focus:ring-1 focus:ring-[var(--color-pulse)]"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="prod dependencies"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--color-muted)]">Webhook URL</span>
                <input
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm outline-none focus:border-[var(--color-pulse)]"
                  value={webhook}
                  onChange={(e) => setWebhook(e.target.value)}
                  placeholder="https://..."
                  type="url"
                />
              </label>
              <div className="flex gap-2">
                <select
                  className="rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-2 py-2 text-sm"
                  value={pkgEcosystem}
                  onChange={(e) => setPkgEcosystem(e.target.value as 'npm' | 'pypi')}
                >
                  <option value="npm">npm</option>
                  <option value="pypi">pypi</option>
                </select>
                <input
                  className="min-w-0 flex-1 rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm"
                  value={pkgName}
                  onChange={(e) => setPkgName(e.target.value)}
                  placeholder="package name"
                  required
                />
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[var(--color-muted)]">Baseline version (optional)</span>
                <input
                  className="w-full rounded border border-[var(--color-line)] bg-[var(--color-panel)] px-3 py-2 text-sm"
                  value={baseline}
                  onChange={(e) => setBaseline(e.target.value)}
                  placeholder="pin known version for drift detect"
                />
              </label>
              <button
                type="submit"
                className="w-full rounded bg-[var(--color-pulse)] px-4 py-2.5 text-sm font-semibold text-[var(--color-void)] transition hover:brightness-110"
              >
                Create watchlist
              </button>
            </form>
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[var(--color-muted)]">
              Watchlists
            </h2>
            {loading && <p className="text-sm text-[var(--color-muted)]">Loading…</p>}
            <ul className="space-y-1">
              {watchlists.map((wl) => (
                <li key={wl.watchlist_id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(wl.watchlist_id)}
                    className={`w-full rounded px-3 py-2 text-left text-sm transition ${
                      selectedId === wl.watchlist_id
                        ? 'bg-[var(--color-panel)] text-[var(--color-text)]'
                        : 'text-[var(--color-muted)] hover:bg-[var(--color-surface)]'
                    }`}
                  >
                    {wl.name}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="space-y-6">
          {selected ? (
            <>
              <div className="relative overflow-hidden rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-6">
                {checking && <div className="pulse-scan absolute inset-0 rounded-lg" aria-hidden />}
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2
                      className="text-2xl font-bold"
                      style={{ fontFamily: 'var(--font-display)' }}
                    >
                      {selected.name}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-muted)]">
                      {selected.packages.length} package
                      {selected.packages.length === 1 ? '' : 's'}
                      {selected.webhook_url ? ' · webhook configured' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCheck}
                    disabled={checking}
                    className="rounded border border-[var(--color-pulse)] px-5 py-2.5 text-sm font-semibold text-[var(--color-pulse)] transition hover:bg-[var(--color-pulse)]/10 disabled:opacity-50"
                  >
                    {checking ? 'Checking…' : 'Check now'}
                  </button>
                </div>

                <div className="relative mt-6 overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-[var(--color-line)] text-[var(--color-muted)]">
                        <th className="pb-2 pr-4 font-medium">Package</th>
                        <th className="pb-2 pr-4 font-medium">Seen</th>
                        <th className="pb-2 pr-4 font-medium">Score</th>
                        <th className="pb-2 font-medium">Verdict</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.packages.map((p) => (
                        <tr
                          key={`${p.ecosystem}:${p.name}`}
                          className="border-b border-[var(--color-line)]/60"
                        >
                          <td className="py-3 pr-4 font-mono text-xs">
                            {p.ecosystem}:{p.name}
                          </td>
                          <td className="py-3 pr-4">{p.last_seen_version ?? '—'}</td>
                          <td className="py-3 pr-4">{p.last_score ?? '—'}</td>
                          <td className={`py-3 font-medium ${verdictClass(p.last_verdict ?? '')}`}>
                            {p.last_verdict ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <section>
                <h3
                  className="mb-4 text-lg font-bold"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  Alerts
                </h3>
                {alerts.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-muted)]">
                    No risk-increase alerts yet. Run a check after a new version ships, or set a
                    baseline version behind registry latest.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {alerts.map((a) => (
                      <li
                        key={a.alert_id}
                        className="rounded-lg border border-[var(--color-line)] bg-[var(--color-panel)] p-4"
                      >
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="font-mono text-sm">
                            {a.ecosystem}:{a.name}
                          </span>
                          <span className="text-xs text-[var(--color-muted)]">
                            {new Date(a.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="mt-2 text-sm">
                          {a.previous_version} → {a.new_version} · score {a.previous_score} →{' '}
                          <span className={verdictClass(a.new_verdict)}>{a.new_score}</span>
                        </p>
                        {a.mind_summary && (
                          <p className="mt-2 text-sm text-[var(--color-muted)]">{a.mind_summary}</p>
                        )}
                        {a.webhook_delivered !== undefined && (
                          <p className="mt-2 text-xs text-[var(--color-muted)]">
                            Webhook{' '}
                            {a.webhook_delivered
                              ? `delivered (${a.webhook_status ?? 'ok'})`
                              : 'not delivered'}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          ) : (
            <p className="text-[var(--color-muted)]">Create or select a watchlist.</p>
          )}
        </main>
      </div>
    </div>
  );
}
