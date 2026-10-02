import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore, isOpen } from '../services/store.js';
import { fmtTime, startOfDay } from '../lib/time.js';
import {
  TERMINALS, terminalById, fleetStatus, inboxFor, sendMessage, terminalCheckIn, customerVerified, returnItem, FIELD_KINDS, vehicleOf,
} from '../services/ops.js';
import DashShell from '../components/DashShell.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { MessageCard, CustodyChain } from '../components/OpsWidgets.jsx';
import { StatCard } from '../components/Widgets.jsx';
import { PriorityPill, StatusPill, RouteBadge } from '../components/ui.jsx';
import OpsMap from '../components/OpsMap.jsx';
import { catShort } from '../lib/config.js';

export default function Terminal({ id = 'oakland', view = 'overview' }) {
  const { go } = useNav();
  const term = terminalById(id) || TERMINALS[0];
  const ops = useStore((s) => s.ops);
  const tickets = useStore((s) => s.tickets);
  const now = useNow(10000);
  const fleet = useMemo(() => fleetStatus(now).filter((b) => b.garage === term.id), [now, term.id, ops, tickets]); // eslint-disable-line react-hooks/exhaustive-deps
  const recipient = `T:${term.id}`;
  const inbox = inboxFor(ops, recipient).concat(ops.messages.filter((m) => m.to.kind === 'all' && !m.recipients.includes(recipient))).sort((a, b) => b.at - a.at);
  const busesHere = new Set(fleet.map((b) => b.bus));
  const incidents = tickets.filter((t) => isOpen(t) && busesHere.has(t.vehicle) && t.ai.category !== 'facilities').sort((a, b) => b.createdAt - a.createdAt);
  const detours = ops.detours.filter((d) => d.active && d.routes.some((r) => term.routes.includes(r)));
  const today = startOfDay(now);
  const road = ops.field.filter((f) => f.at >= today && term.routes.includes(f.route));
  const lost = ops.lost.filter((l) => l.terminal === term.id && l.status !== 'Returned');
  const [shelf, setShelf] = useState({});
  const [text, setText] = useState('');
  const [note, setNote] = useState(null);
  const supervisor = term.supervisor;

  return (
    <DashShell>
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>{term.name}</h1>
          <div className="small muted">Terminal dashboard · {supervisor} · Routes {term.routes.join(', ')}</div>
        </div>
        <div className="filters">
          {TERMINALS.map((t) => <button key={t.id} className={t.id === term.id ? 'on' : ''} onClick={() => go(`/terminal/${t.id}${view === 'overview' ? '' : `/${view}`}`)}>{t.name}</button>)}
        </div>
      </div>

      {detours.map((d) => (
        <div key={d.id} className="detour compact">
          <div className="detour-h"><span className="detour-tag">SERVICE ALERT · DETOUR</span><span className="mono xs">{d.id}</span></div>
          <div className="detour-t">Routes {d.routes.join('/')} {d.direction}: {d.closure}</div>
          <div className="xs">{Object.keys(d.acks).length}/{d.recipients.length} operators acknowledged · est. delay {d.delayMin} min</div>
        </div>
      ))}

      {view === 'overview' && (
        <>
      <div className="stat-row">
        <StatCard n={fleet.filter((b) => b.status !== 'Held').length} label="Buses out" lead />
        <StatCard n={fleet.filter((b) => b.status === 'Late').length} label="Running late" stripe="var(--med)" />
        <StatCard n={fleet.filter((b) => b.status === 'Held' || b.status === 'No AVL ping').length} label="Held / no ping" stripe="var(--high)" />
        <StatCard n={incidents.length} label="Open incidents" stripe="var(--accent)" />
        <StatCard n={lost.length} label="Lost & found here" stripe="var(--ok)" />
      </div>
          <div className="main-grid">
            <section className="panel">
              <div className="panel-h"><h2>{term.name} routes</h2><span className="small muted">Simulated AVL</span></div>
              <OpsMap routes={term.routes} buses={fleet} field={road} detours={detours} showTerminals height={320} label={`${term.name} routes map`} />
            </section>
            <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Road & service reports</h2><span className="tag">{road.length}</span></div>
            <ul className="ack-list">
              {road.length === 0 && <li className="small muted">None today on this terminal's routes.</li>}
              {road.map((f) => <li key={f.id}><div className="small" style={{ fontWeight: 700 }}>{FIELD_KINDS[f.kind]?.label} · Bus {f.bus} · {fmtTime(f.at)}</div><div className="small">“{f.text}”</div><div className="xs muted">{f.status}</div></li>)}
            </ul>
          </section>
            </div>
          </div>
        </>
      )}

      {view === 'buses' && (
        <section className="panel">
          <div className="panel-h"><h2>Active buses & operator check-ins</h2><span className="small muted">Simulated AVL</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Bus</th><th>Route</th><th>Operator</th><th>Checked in</th><th>Status</th><th>Issues</th></tr></thead>
              <tbody>
                {fleet.map((b) => (
                  <tr key={b.bus} onClick={() => go(`/fleet/${b.bus}`)} style={{ cursor: 'pointer' }}>
                    <td className="mono"><b>{b.bus}</b></td>
                    <td><RouteBadge id={b.route} /> {b.dir}</td>
                    <td className="mono small">{b.operatorId || '—'}</td>
                    <td>{fmtTime(b.checkIn)}</td>
                    <td><span className={`busst bs-${b.status.replace(/\s/g, '').toLowerCase()}`}>{b.status}</span>{b.status === 'Late' ? ` +${b.late}m` : ''}</td>
                    <td>{b.openIssues || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
        </section>
      )}

      {view === 'incidents' && (
        <section className="panel">
          <div className="panel-h"><h2>Incidents & maintenance problems</h2><span className="tag">{incidents.length}</span></div>
          <ul className="ack-list">
            {incidents.length === 0 && <li className="small muted">No open incidents for this terminal's buses.</li>}
            {incidents.slice(0, 8).map((t) => (
              <li key={t.id} onClick={() => go(`/ticket/${t.id}`)} style={{ cursor: 'pointer' }}>
                <div className="row between"><span className="small" style={{ fontWeight: 700 }}>Bus {t.vehicle} · {t.ai.title}</span><PriorityPill p={t.priority} /></div>
                <div className="row" style={{ gap: 6 }}><span className="xs muted">{catShort(t.ai.category)} · {fmtTime(t.createdAt)}</span><StatusPill s={t.status} /></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {view === 'lost' && (
        <section className="panel">
          <div className="panel-h"><h2>Lost & Found at this terminal</h2><span className="tag">{lost.length}</span></div>
          <div className="panel-b stack">
            {lost.length === 0 && <div className="small muted">Nothing in custody here.</div>}
            {lost.map((l) => (
              <div key={l.id} className="lf-card">
                <div className="row between"><b>{l.item}</b><span className="mono xs">{l.id}</span></div>
                <div className="small muted">Found on Bus {l.foundBy} ({vehicleOf(l.foundBy)?.route ? `Route ${vehicleOf(l.foundBy).route}` : ''}) · {l.foundWhere}</div>
                {l.status === 'Found' && (
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    <input className="input" style={{ maxWidth: 140 }} placeholder="Shelf e.g. A-3" value={shelf[l.id] || ''} onChange={(e) => setShelf((s) => ({ ...s, [l.id]: e.target.value }))} />
                    <button className="btn btn-sm btn-primary" onClick={() => terminalCheckIn(l.id, term.id, `Shelf ${(shelf[l.id] || 'A-1').replace(/^shelf\s*/i, '')}`, `${term.name} · ${supervisor}`)}>Scan & check in</button>
                  </div>
                )}
                {l.status === 'At Terminal' && <button className="btn btn-sm btn-primary" style={{ marginTop: 6 }} onClick={() => customerVerified(l.id, `${term.name} · ID checked by ${supervisor}`)}>Customer here · verify ID</button>}
                {l.status === 'Customer Verified' && <button className="btn btn-sm btn-ok" style={{ marginTop: 6 }} onClick={() => returnItem(l.id, `${term.name} · ${supervisor}`)}>Return to customer</button>}
                <CustodyChain item={l} />
              </div>
            ))}
          </div>
        </section>
      )}

      {view === 'messages' && (
          <section className="panel">
            <div className="panel-h"><h2>Central Dispatch</h2></div>
            <div className="panel-b stack-sm">
              {note && <div className="notice notice-ok">{note}</div>}
              {inbox.slice(0, 4).map((m) => <MessageCard key={m.id} m={m} recipient={m.recipients.includes(recipient) ? recipient : null} by={supervisor} />)}
              <textarea className="textarea" style={{ minHeight: 64 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message Central Dispatch…" />
              <button className="btn btn-primary" disabled={!text.trim()} onClick={() => { sendMessage({ to: { kind: 'dispatch' }, from: term.name, fromKind: 'terminal', text: text.trim() }); setText(''); setNote('Sent to Central Dispatch.'); }}>Send to Dispatch</button>
            </div>
          </section>
      )}
      <p className="xs muted">Terminal names, supervisors and shelf locations are demo placeholders. Verify real garage and terminal names with SMART.</p>
    </DashShell>
  );
}
