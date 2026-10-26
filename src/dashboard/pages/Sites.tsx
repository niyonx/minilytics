import { useEffect, useState } from 'react';
import { navigate } from '../App';
import { Favicon } from '../components/Icons';
import { Logo } from '../components/Logo';
import { Modal } from '../components/Modal';
import { Sparkline } from '../components/Sparkline';
import { api, type Site } from '../lib/api';
import { fmtMoney, fmtNumber } from '../lib/format';

export function Sites() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    api<Site[]>('/api/sites').then((s) => {
      setSites(s);
      if (!s.length) setAdding(true);
    });
  }, []);

  // Shared across cards so a payment's bar height compares between sites.
  const maxPayment = Math.max(1, ...(sites ?? []).flatMap((s) => (s.payments24h ?? []).map((p) => p.amount)));

  async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('ml:logout'));
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Logo />
        <div className="flex gap-2">
          <button className="btn" onClick={logout}>
            Log out
          </button>
          <button className="btn-dark" onClick={() => setAdding(true)}>
            + Add website
          </button>
        </div>
      </div>

      <Summary sites={sites} />
      <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sites?.map((s) => {
          const money = (minor: number) => fmtMoney(minor, s.currency, s.decimals ?? 2, true);
          return (
            <button key={s.id} onClick={() => navigate(`/site/${s.id}`)} className="card p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Favicon domain={s.domain} size={22} />
                  <div className="truncate font-semibold">{s.domain}</div>
                </div>
                {!!s.online && (
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-stone-500">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                    {s.online} online
                  </div>
                )}
              </div>
              <div className="mt-4">
                <Sparkline id={s.id} series={s.series24h ?? []} payments={s.payments24h ?? []} maxAmount={maxPayment} money={money} />
              </div>
              <div className="mt-3 text-sm text-stone-600">
                <b className="font-semibold text-ink">{fmtNumber(s.visitors24h ?? 0)}</b> visitors
                {!!s.revenue24h && (
                  <>
                    {' '}
                    · <b className="font-semibold text-ink">{money(s.revenue24h)}</b> revenue
                  </>
                )}
              </div>
            </button>
          );
        })}
        {sites && !sites.length && (
          <div className="card col-span-full p-10 text-center text-stone-500">No websites yet. Add your first one to get a tracking snippet.</div>
        )}
      </div>
      <AddSite open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Summary({ sites }: { sites: Site[] | null }) {
  if (!sites?.length) return <h1 className="mt-10 text-2xl font-semibold">Your websites</h1>;
  const visitors = sites.reduce((n, s) => n + (s.visitors24h ?? 0), 0);
  // Revenue is only added up across sites that share a currency; otherwise it is left to each card.
  const currencies = [...new Set(sites.map((s) => s.currency))];
  const revenue = sites.reduce((n, s) => n + (s.revenue24h ?? 0), 0);
  return (
    <p className="mt-10 text-lg text-stone-600">
      You got <b className="font-semibold text-ink">{fmtNumber(visitors)}</b> visitors
      {currencies.length === 1 && (
        <>
          {' '}
          and made <b className="font-semibold text-ink">{fmtMoney(revenue, currencies[0], sites[0].decimals ?? 2, true)}</b>
        </>
      )}{' '}
      in the last 24 hours.
    </p>
  );
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'SGD', 'JPY', 'BRL'];

function AddSite({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [currency, setCurrency] = useState('USD');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const site = await api<Site>('/api/sites', { method: 'POST', json: { domain, name, timezone, currency } });
      navigate(`/site/${site.id}/settings`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a website" width="max-w-md">
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Domain</label>
          <input className="input" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} autoFocus />
          <p className="mt-1 text-xs text-stone-500">Subdomains (app.example.com) are tracked under the same site.</p>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" placeholder="My SaaS" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Timezone</label>
            <input className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div>
            <label className="label">Revenue currency</label>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="btn-dark w-full" disabled={!domain}>
          Add website
        </button>
      </form>
    </Modal>
  );
}
