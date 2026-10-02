import { useMemo, useState } from 'react';
import { useStore } from '../services/store.js';
import { fmtTime, fmtDateTime, MIN } from '../lib/time.js';
import { stopById, routeById } from '../services/maps.js';
import {
  createLostItem, demoLostItemDraft, directionsOf, stopsOnRoute, terminalName, LF_STAGES, ROUTE_LIST,
} from '../services/ops.js';
import DashShell from '../components/DashShell.jsx';
import { ServiceAlerts } from '../components/OpsWidgets.jsx';
import { CustodyChain } from '../components/OpsWidgets.jsx';
import { RouteBadge } from '../components/ui.jsx';

const CATS = ['Bag', 'Phone', 'Wallet', 'Keys', 'Clothing', 'Umbrella', 'Electronics', 'ID / Cards', 'Other'];
const toLocalTime = (ts) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const fromLocalTime = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime(); };

function blank() {
  return { item: '', category: 'Bag', route: '461', direction: directionsOf('461')[0], stopId: '382', time: toLocalTime(Date.now() - 30 * MIN), customer: '', contact: '' };
}

function MatchTable({ item }) {
  return (
    <div className="stack-sm">
      <div className="small">
        <b>How SMART Ops narrowed it down:</b> Route {item.route}{item.direction ? ` ${item.direction}` : ''}{item.stopId ? ` · ${stopById(item.stopId)?.name}` : ''} · around {fmtTime(item.approxAt)} → checked every bus scheduled through that stop within ±45 min, including corridor routes that share it.
      </div>
      {item.matches?.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bus</th><th>Trip</th><th>Passed stop</th><th>Δ</th><th>Likelihood</th><th>Driver</th></tr></thead>
            <tbody>
              {item.matches.map((m) => {
                const r = item.responses?.[m.bus];
                const alerted = (item.alerted || []).includes(m.bus);
                return (
                  <tr key={m.bus}>
                    <td className="mono"><b>{m.bus}</b></td>
                    <td>{m.trip}</td>
                    <td>{fmtTime(m.passAt)}</td>
                    <td>{m.diffMin ?? 0} min</td>
                    <td><span className={`lk lk-${m.likelihood.toLowerCase()}`}>{m.likelihood}</span></td>
                    <td>{r ? (r.found ? <b style={{ color: 'var(--ok)' }}>FOUND · {r.where || ''}</b> : 'Not on bus') : alerted ? 'Alerted · searching' : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="small muted">{item.category === 'Found on bus' ? 'Logged by the operator. Waiting for a matching customer report.' : 'No scheduled trips matched that time window.'}</div>}
      <div className="xs muted">Demo uses a simulated schedule. Production matches against SMART's GTFS stop_times plus AVL history for the exact vehicle on each trip.</div>
    </div>
  );
}

export default function LostFound() {
  const lost = useStore((s) => s.ops.lost);
  const [f, setF] = useState(blank);
  const [sel, setSel] = useState(null);
  const [filter, setFilter] = useState('open');
  const [q, setQ] = useState('');
  const dirs = directionsOf(f.route);
  const stops = useMemo(() => stopsOnRoute(f.route), [f.route]);

  const set = (k, v) => setF((x) => {
    const n = { ...x, [k]: v };
    if (k === 'route') { n.direction = directionsOf(v)[0]; n.stopId = stopsOnRoute(v)[0]?.id || ''; }
    return n;
  });

  function fillDemo() {
    const d = demoLostItemDraft();
    setF({ item: d.item, category: d.category, route: d.route, direction: d.direction, stopId: stopById(d.stopId)?.id || d.stopId, time: toLocalTime(d.approxAt), customer: d.customer, contact: d.contact });
  }

  function submit() {
    const rec = createLostItem({ item: f.item.trim(), category: f.category, route: f.route, direction: f.direction, stopId: f.stopId, approxAt: fromLocalTime(f.time), customer: f.customer.trim() || 'Customer', contact: f.contact.trim() });
    setSel(rec.id);
    setF(blank());
  }

  const list = lost.filter((l) => (filter === 'open' ? l.status !== 'Returned' : filter === 'returned' ? l.status === 'Returned' : true))
    .filter((l) => !q || `${l.id} ${l.item} ${l.route} ${l.customer}`.toLowerCase().includes(q.toLowerCase()));
  const cur = lost.find((l) => l.id === sel) || list[0];
  const counts = Object.fromEntries(LF_STAGES.map((s) => [s, lost.filter((l) => l.status === s).length]));

  return (
    <DashShell active="/lost-found">
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>Lost & Found</h1>
          <div className="small muted">Customer Service intake → AI trip matching → driver alert → terminal custody → returned</div>
        </div>
        <span className="demo-data">Demo data</span>
      </div>

      <ServiceAlerts audience="customer" />

      <div className="lf-pipeline">
        {LF_STAGES.map((s) => <div key={s}><span className="n num">{counts[s] || 0}</span><span className="l">{s}</span></div>)}
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-h"><h2>New lost-item report</h2><button className="btn btn-sm" onClick={fillDemo}>▶ Fill demo report</button></div>
          <div className="panel-b stack-sm">
            <div className="field"><label>Item description</label><input className="input" value={f.item} onChange={(e) => set('item', e.target.value)} placeholder="e.g. Blue backpack with laptop" /></div>
            <div className="calc-grid">
              <div className="field"><label>Category</label><select className="select" value={f.category} onChange={(e) => set('category', e.target.value)}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label>Route</label><select className="select" value={f.route} onChange={(e) => set('route', e.target.value)}>{ROUTE_LIST.map((r) => <option key={r.id} value={r.id}>{r.id} {r.name}</option>)}</select></div>
              <div className="field"><label>Direction</label><select className="select" value={f.direction} onChange={(e) => set('direction', e.target.value)}>{dirs.map((d) => <option key={d}>{d}</option>)}</select></div>
              <div className="field"><label>Boarding or exit stop</label><select className="select" value={f.stopId} onChange={(e) => set('stopId', e.target.value)}>{stops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
              <div className="field"><label>Approximate time</label><input className="input" type="time" value={f.time} onChange={(e) => set('time', e.target.value)} /></div>
              <div className="field"><label>Customer</label><input className="input" value={f.customer} onChange={(e) => set('customer', e.target.value)} placeholder="Name" /></div>
            </div>
            <div className="field"><label>Contact</label><input className="input" value={f.contact} onChange={(e) => set('contact', e.target.value)} placeholder="Phone or email" /></div>
            <button className="btn btn-primary btn-lg" disabled={f.item.trim().length < 3 || !f.stopId} onClick={submit}>Create report & alert drivers</button>
            <div className="xs muted">The customer gets the claim number right away. The likely buses are alerted at their next stop.</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2>Reports</h2>
            <div className="filters">
              {[['open', 'Open'], ['returned', 'Returned'], ['all', 'All']].map(([k, l]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>)}
            </div>
          </div>
          <div className="panel-b stack-sm">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search claim #, item, route…" />
            <ul className="lf-list">
              {list.map((l) => (
                <li key={l.id} className={cur?.id === l.id ? 'on' : ''} onClick={() => setSel(l.id)}>
                  <div className="row between"><b>{l.item}</b><span className={`lfst lf-${l.status.replace(/\s/g, '').toLowerCase()}`}>{l.status}</span></div>
                  <div className="xs muted"><span className="mono">{l.id}</span> · Route {l.route} · {fmtDateTime(l.createdAt)}{l.terminal ? ` · ${terminalName(l.terminal)}` : ''}</div>
                </li>
              ))}
              {list.length === 0 && <li className="small muted">No reports.</li>}
            </ul>
          </div>
        </section>
      </div>

      {cur && (
        <section className="panel">
          <div className="panel-h" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2>{cur.item}</h2>
            <span className="row" style={{ gap: 8 }}><RouteBadge id={cur.route} /><span className="mono small">Claim {cur.id}</span></span>
          </div>
          <div className="panel-b split2">
            <div className="stack-sm">
              <dl className="kv">
                <dt>Customer</dt><dd>{cur.customer}{cur.contact ? ` · ${cur.contact}` : ''}</dd>
                <dt>Trip</dt><dd>Route {cur.route} {routeById(cur.route)?.name}{cur.direction ? ` · ${cur.direction}` : ''}</dd>
                <dt>Stop</dt><dd>{cur.stopId ? stopById(cur.stopId)?.name : '—'}</dd>
                <dt>Time</dt><dd>around {fmtTime(cur.approxAt)}</dd>
                {cur.foundBy && <><dt>Found</dt><dd>Bus {cur.foundBy} · {cur.foundWhere}</dd></>}
                {cur.terminal && <><dt>Custody</dt><dd>{terminalName(cur.terminal)}{cur.shelf ? ` · ${cur.shelf}` : ' · in transit'}</dd></>}
              </dl>
              {cur.photo && <img src={cur.photo} alt="Found item photo from operator" className="photo-thumb" style={{ maxWidth: 200 }} />}
              <MatchTable item={cur} />
            </div>
            <div>
              <div className="eyebrow">Chain of custody</div>
              <CustodyChain item={cur} />
            </div>
          </div>
        </section>
      )}
    </DashShell>
  );
}
