import { useEffect, useMemo, useState } from 'react';
import { fetchVisits, markOwner, ownerKey } from '../services/visits.js';

// Hidden owner-only page: /#/owner?key=<owner key>. Not linked anywhere.
// Opening it once marks this device as the owner's, so your own visits are
// tagged and left out of the counts.

const TZ = 'America/Detroit';
const fmt = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const ROLE = { operator: 'Operator', dispatch: 'Central Dispatch', terminal: 'Terminal Supervisor', safety: 'Safety & Security', customer: 'Customer Service', maintenance: 'Maintenance', facilities: 'Facilities', admin: 'Management', presenter: 'Presenter Mode' };
const EV = { open: 'Opened app', login: 'Signed in', presenter: 'Presenter Mode' };
const place = (r) => [r.city, r.region].filter(Boolean).join(', ') || r.country || 'Unknown location';

function Stat({ n, label }) {
  return (
    <div className="panel" style={{ padding: 14, flex: '1 1 120px' }}>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{n}</div>
      <div className="small muted">{label}</div>
    </div>
  );
}

export default function Owner({ keyParam }) {
  const [key] = useState(() => {
    if (keyParam) markOwner(keyParam);
    return keyParam || ownerKey();
  });
  const [mine, setMine] = useState(false);
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!key) { setState({ error: 'Missing key' }); return; }
    let live = true;
    setState((s) => ({ ...s, loading: true }));
    fetchVisits(key, mine).then((r) => live && setState({ ...r, loading: false }));
    return () => { live = false; };
  }, [key, mine]);

  const rows = state.rows || [];
  const stats = useMemo(() => {
    const visitors = new Set(rows.map((r) => r.visitor).filter(Boolean));
    const byRole = {};
    rows.filter((r) => r.event !== 'open').forEach((r) => { const k = r.role || 'unknown'; byRole[k] = (byRole[k] || 0) + 1; });
    return {
      visitors: visitors.size,
      opens: rows.filter((r) => r.event === 'open').length,
      logins: rows.filter((r) => r.event !== 'open').length,
      byRole: Object.entries(byRole).sort((a, b) => b[1] - a[1]),
    };
  }, [rows]);

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 60px' }} className="stack">
      <div className="row between" style={{ gap: 8, flexWrap: 'wrap' }}>
        <div>
          <div className="eyebrow">Owner only</div>
          <h1 style={{ margin: '4px 0' }}>Who opened the demo</h1>
        </div>
        <a className="btn btn-sm" href="#/">Back to app</a>
      </div>

      {state.error && <div className="notice notice-warn">{state.error}</div>}
      {state.loading && <div className="muted">Loading…</div>}

      {!state.error && !state.loading && (
        <>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Stat n={stats.visitors} label="Different devices" />
            <Stat n={stats.opens} label="App opens" />
            <Stat n={stats.logins} label="Sign-ins" />
          </div>

          <label className="row small" style={{ gap: 8 }}>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            Include my own visits (this device is marked as yours)
          </label>

          {stats.byRole.length > 0 && (
            <div className="panel" style={{ padding: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 8 }}>Sign-ins by role</div>
              {stats.byRole.map(([r, n]) => (
                <div key={r} className="row between" style={{ padding: '4px 0' }}><span>{ROLE[r] || r}</span><b>{n}</b></div>
              ))}
            </div>
          )}

          <div className="panel" style={{ padding: 0 }}>
            <div className="eyebrow" style={{ padding: '12px 14px' }}>Every visit, newest first (Detroit time)</div>
            {rows.length === 0 && <div className="muted" style={{ padding: '0 14px 14px' }}>No visits yet.</div>}
            {rows.map((r) => (
              <div key={r.id} style={{ padding: '10px 14px', borderTop: '1px solid var(--line, rgba(0,0,0,.1))' }}>
                <div className="row between" style={{ gap: 8 }}>
                  <b>{EV[r.event] || r.event}{r.role ? ` · ${ROLE[r.role] || r.role}` : ''}</b>
                  <span className="small muted">{fmt(r.at)}</span>
                </div>
                <div className="small muted">
                  {r.device} · {r.browser} · {place(r)} · device #{(r.visitor || '').slice(0, 4) || '?'}{r.is_owner ? ' · you' : ''}
                </div>
              </div>
            ))}
          </div>
          <div className="small muted">Bots and email link scanners are not counted. Tracking started Nov 6, 2026; earlier visits aren't in this log.</div>
        </>
      )}
    </div>
  );
}
