import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore } from '../services/store.js';
import { fmtTime, ago, startOfDay } from '../lib/time.js';
import { stopById, ROUTES } from '../services/maps.js';
import {
  fleetStatus, DETOUR_TEMPLATES, publishDetour, clearDetour, sendMessage, ackMessage, ackProgress, TERMINALS, terminalName,
  setFieldStatus, FIELD_KINDS, suggestDetour, RELIEF, reliefStatus,
} from '../services/ops.js';
import DashShell from '../components/DashShell.jsx';
import OpsMap from '../components/OpsMap.jsx';
import DispatchSearch from '../components/DispatchSearch.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { Modal, RouteBadge } from '../components/ui.jsx';
import { StatCard } from '../components/Widgets.jsx';

const LAYERS = [['buses', 'Buses'], ['field', 'Operator reports'], ['relief', 'Relief points'], ['terminals', 'Terminals']];
const ROUTE_IDS = ROUTES.filter((r) => r.path?.length > 1 || r.sharesPathWith).map((r) => r.id);

export function DetourReview({ tpl, fromReport, onClose }) {
  const recipients = [...new Set(tpl.routes)];
  return (
    <Modal
      title={`Review detour · Routes ${tpl.routes.join('/')}`}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => { publishDetour(tpl.id, { fromReport }); onClose(); }}>Publish detour</button>
      </>}
    >
      <div className="notice notice-warn"><b>{tpl.closure}</b> · {tpl.direction}</div>
      <OpsMap routes={recipients} detours={[tpl]} fit={[...tpl.detourPath, ...tpl.closedPath]} height={240} label="Detour preview" />
      <div className="split2">
        <div>
          <div className="eyebrow">Recommended routing</div>
          <ol className="detour-steps light">
            {tpl.steps.map((s, i) => <li key={i}><b>{s.text}</b><span>{s.at}</span></li>)}
          </ol>
        </div>
        <div className="stack-sm">
          <div><div className="eyebrow">Stops bypassed ({tpl.bypassed.length})</div>{tpl.bypassed.map((b) => <div key={b} className="small">✕ {b}</div>)}</div>
          <div><div className="eyebrow">Temporary stops ({tpl.temporary.length})</div>{tpl.temporary.map((b) => <div key={b} className="small">+ {b}</div>)}</div>
          <div className="small">Rejoin at <b>Stop {stopById(tpl.rejoinStop)?.id} · {stopById(tpl.rejoinStop)?.name}</b> · est. delay <b>{tpl.delayMin} min</b></div>
        </div>
      </div>
      <div className="small muted">Publishing sends the same detour to every affected operator, their terminals, Customer Service and the Command Center. Rider-facing alerts are Phase 2. In production the detour also goes to SMART's CAD/AVL so onboard systems stay in sync. Bypassed and temporary stops shown are simulated.</div>
    </Modal>
  );
}

export default function DispatchHub() {
  const { go } = useNav();
  const ops = useStore((s) => s.ops);
  const now = useNow(10000);
  const fleet = useMemo(() => fleetStatus(now), [now, ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layers, setLayers] = useState({ buses: true, field: true, relief: false, terminals: true });
  const [review, setReview] = useState(null);
  const [to, setTo] = useState({ kind: 'all' });
  const [text, setText] = useState('');
  const [prio, setPrio] = useState('normal');
  const [focus, setFocus] = useState(null);
  const [note, setNote] = useState(null);

  const today = startOfDay(now);
  const field = ops.field.filter((f) => f.at >= today);
  const activeDetours = ops.detours.filter((d) => d.active);
  const inbox = ops.messages.filter((m) => m.recipients.includes('DISPATCH'));
  const sent = ops.messages.filter((m) => m.fromKind === 'dispatch');
  const unacked = sent.reduce((n, m) => n + ackProgress(m).pending.length, 0);
  const openLost = ops.lost.filter((l) => l.status !== 'Returned').length;
  const late = fleet.filter((b) => b.status === 'Late').length;
  const noPing = fleet.filter((b) => b.status === 'No AVL ping').length;
  const newReports = field.filter((f) => f.status === 'Open').length;
  const relief = RELIEF.map((r) => ({ ...r, status: reliefStatus(r, ops, now) }));

  const fit = focus ? [[focus.lat + 0.03, focus.lng - 0.04], [focus.lat - 0.03, focus.lng + 0.04]] : null;

  function send() {
    const m = sendMessage({ to, text: text.trim(), priority: prio });
    setText('');
    setNote(`${m.id} sent to ${m.to.label} · waiting on ${m.recipients.length} acknowledgement${m.recipients.length > 1 ? 's' : ''}.`);
  }

  const sortedField = [...field].sort((a, b) => (a.status === 'Open' ? 0 : 1) - (b.status === 'Open' ? 0 : 1) || (a.kind === 'road_blocked' ? -1 : 0) - (b.kind === 'road_blocked' ? -1 : 0) || b.at - a.at);

  return (
    <DashShell active="/dispatch">
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>Central Dispatch Hub</h1>
          <div className="small muted">Operators · Buses · Terminals · Maintenance · Facilities · Customer Service, on one screen</div>
        </div>
        <span className="demo-data">Simulated positions</span>
      </div>

      <DispatchSearch onFocus={setFocus} />

      <div className="stat-row">
        <StatCard n={fleet.length - fleet.filter((b) => b.status === 'Held').length} label="Buses in service" lead />
        <StatCard n={late} label="Running late" stripe="var(--med)" />
        <StatCard n={noPing} label="No AVL ping" stripe="var(--muted)" />
        <StatCard n={newReports} label="New operator reports" stripe="var(--high)" />
        <StatCard n={activeDetours.length} label="Active detours" stripe="var(--flag)" />
      </div>
      <div className="kpi-row">
        <div className="kpi"><span className="n">{unacked}</span><span className="l">Unacknowledged messages</span></div>
        <div className="kpi"><span className="n">{inbox.filter((m) => !m.acks?.DISPATCH).length}</span><span className="l">Operator requests waiting</span></div>
        <button className="kpi kpi-btn" onClick={() => go('/lost-found')}><span className="n">{openLost}</span><span className="l">Open lost items →</span></button>
        <div className="kpi"><span className="n">{relief.filter((r) => r.status.code === 'closed').length}</span><span className="l">Relief points reported closed</span></div>
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-h" style={{ flexWrap: 'wrap', gap: 8 }}>
            <h2>Operations Map</h2>
            <div className="filters">
              {LAYERS.map(([k, l]) => <button key={k} className={layers[k] ? 'on' : ''} onClick={() => setLayers((x) => ({ ...x, [k]: !x[k] }))}>{l}</button>)}
              {focus && <button onClick={() => setFocus(null)}>Show all ✕</button>}
            </div>
          </div>
          <OpsMap
            buses={layers.buses ? fleet : []} field={layers.field ? field : []} relief={layers.relief ? relief : null}
            detours={activeDetours} showTerminals={layers.terminals} fit={fit} height={460} label="Central dispatch operations map"
          />
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Operator Reports</h2><span className="tag">{newReports} new</span></div>
          <div className="panel-b stack-sm" style={{ maxHeight: 520, overflow: 'auto' }}>
            {sortedField.length === 0 && <div className="small muted">No operator location reports today.</div>}
            {sortedField.map((f) => {
              const tpl = f.kind === 'road_blocked' ? DETOUR_TEMPLATES.find((d) => d.id === f.suggestedDetour) || suggestDetour(f.text, f.route) : null;
              const published = activeDetours.some((d) => d.fromReport === f.id);
              return (
                <div key={f.id} className={`fr fr-${f.sev} ${f.status === 'Open' ? 'fresh' : ''}`}>
                  <div className="row between">
                    <span className="eyebrow">{FIELD_KINDS[f.kind]?.label} · Bus {f.bus} · Rt {f.route}</span>
                    <span className="xs muted">{fmtTime(f.at)}</span>
                  </div>
                  <div className="small" style={{ fontWeight: 600 }}>“{f.text}”</div>
                  <div className="xs muted">AI routed to {f.routedTo} · {Math.round((f.confidence || 0.9) * 100)}% confidence · {f.status}</div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                    <button className="btn btn-sm" onClick={() => setFocus({ lat: f.lat, lng: f.lng })}>Locate</button>
                    {tpl && !published && f.status !== 'Detour published' && <button className="btn btn-sm btn-primary" onClick={() => setReview({ tpl, fromReport: f.id })}>Review recommended detour</button>}
                    {published && <span className="tag" style={{ background: 'var(--flag)', color: 'var(--flag-ink)' }}>Detour published</span>}
                    {f.status === 'Open' && <button className="btn btn-sm" onClick={() => setFieldStatus(f.id, 'Reviewed')}>Mark reviewed</button>}
                    {f.status === 'Open' && <button className="btn btn-sm" onClick={() => { sendMessage({ to: { kind: 'route', id: f.route }, text: `Heads up: ${FIELD_KINDS[f.kind]?.label.toLowerCase()} reported by Bus ${f.bus}. “${f.text}”` }); setFieldStatus(f.id, 'Route alerted'); }}>Alert route</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="main-grid">
        <section className="panel">
          <div className="panel-h"><h2>Message operators & terminals</h2></div>
          <div className="panel-b stack-sm">
            {note && <div className="notice notice-ok" role="status">{note}</div>}
            <div className="row wrap" style={{ gap: 8 }}>
              <select className="select" value={`${to.kind}:${to.id || ''}`} onChange={(e) => { const [kind, id] = e.target.value.split(':'); setTo(id ? { kind, id } : { kind }); }}>
                <option value="all:">Entire system · all operators</option>
                <option value="terminals:">All terminals</option>
                {TERMINALS.map((t) => <option key={t.id} value={`terminal:${t.id}`}>{t.name}</option>)}
                {ROUTE_IDS.map((r) => <option key={r} value={`route:${r}`}>Route {r} operators</option>)}
                {fleet.map((b) => <option key={b.bus} value={`bus:${b.bus}`}>Bus {b.bus} (Route {b.route})</option>)}
              </select>
              <div className="seg">
                <button className={prio === 'normal' ? 'on-ok' : ''} onClick={() => setPrio('normal')}>Normal</button>
                <button className={prio === 'high' ? 'on-bad' : ''} onClick={() => setPrio('high')}>Urgent</button>
              </div>
            </div>
            <div className="script-chips">
              {['Hold at next timepoint for transfer connection.', 'Severe weather: reduce speed, report flooded roads in SMART Ops.', 'Supervisor en route to your location.'].map((t) => <button key={t} className="chip" onClick={() => setText(t)}>{t}</button>)}
            </div>
            <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="Instruction to send…" />
            <button className="btn btn-primary" disabled={!text.trim()} onClick={send}>Send · require acknowledgement</button>
          </div>
          <div className="panel-h" style={{ borderTop: '1px solid var(--line)' }}><h2>Sent · acknowledgement status</h2></div>
          <ul className="ack-list">
            {sent.map((m) => {
              const p = ackProgress(m);
              return (
                <li key={m.id}>
                  <div className="row between"><span className="small" style={{ fontWeight: 700 }}>{m.to.label}{m.priority === 'high' ? ' · URGENT' : ''}</span><span className="xs muted">{fmtTime(m.at)}</span></div>
                  <div className="small">{m.text}</div>
                  <div className="ackbar"><span style={{ width: `${(p.a / Math.max(1, p.n)) * 100}%` }} /></div>
                  <div className="xs muted">{p.a}/{p.n} acknowledged{p.pending.length ? ` · waiting on ${p.pending.map((x) => (x.startsWith('T:') ? terminalName(x.slice(2)) : `Bus ${x}`)).join(', ')}` : ' · complete'}</div>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Active Detours</h2><span className="tag">{activeDetours.length}</span></div>
            <div className="panel-b stack-sm">
              {activeDetours.length === 0 && (
                <>
                  <div className="small muted">No active detours. Approve one from an operator road report, or publish a planned detour:</div>
                  <div className="row wrap" style={{ gap: 6 }}>{DETOUR_TEMPLATES.map((t) => <button key={t.id} className="btn btn-sm" onClick={() => setReview({ tpl: t, fromReport: null })}>{t.closure}</button>)}</div>
                </>
              )}
              {activeDetours.map((d) => {
                const a = Object.keys(d.acks || {}).length;
                return (
                  <div key={d.id} className="detour compact">
                    <div className="detour-h"><span className="detour-tag">DETOUR ACTIVE</span><span className="mono xs">{d.id} · {ago(d.at, now)}</span></div>
                    <div className="detour-t">Routes {d.routes.join('/')} {d.direction}</div>
                    <div className="detour-why">{d.closure}</div>
                    <div className="ackbar"><span style={{ width: `${(a / Math.max(1, d.recipients.length)) * 100}%` }} /></div>
                    <div className="xs">{a}/{d.recipients.length} operators acknowledged · terminals notified: {d.terminals.map(terminalName).join(', ')}</div>
                    <button className="btn btn-sm" style={{ marginTop: 6 }} onClick={() => clearDetour(d.id)}>Clear detour · restore normal route</button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Requests from operators & terminals</h2></div>
            <ul className="ack-list">
              {inbox.length === 0 && <li className="small muted">Nothing waiting.</li>}
              {inbox.map((m) => (
                <li key={m.id}>
                  <div className="row between"><span className="small" style={{ fontWeight: 700 }}>{m.from}</span><span className="xs muted">{fmtTime(m.at)}</span></div>
                  <div className="small">{m.text}</div>
                  <div className="row wrap" style={{ gap: 6, marginTop: 4 }}>
                    {m.acks?.DISPATCH ? <span className="tag tag-ok">✓ Handled {fmtTime(m.acks.DISPATCH.at)}</span> : <button className="btn btn-sm btn-primary" onClick={() => ackMessage(m.id, 'DISPATCH', 'Central Dispatch')}>Acknowledge</button>}
                    {m.fromBus && <button className="btn btn-sm" onClick={() => { setTo({ kind: 'bus', id: m.fromBus }); setText(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Reply to Bus {m.fromBus}</button>}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-h"><h2>Fleet Board</h2><span className="small muted">Simulated AVL · production reads SMART's existing AVL</span></div>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Bus</th><th>Route</th><th>Direction</th><th>Status</th><th>Schedule</th><th>Terminal</th><th>Check-in</th><th>Open issues</th></tr></thead>
            <tbody>
              {fleet.map((b) => (
                <tr key={b.bus} onClick={() => setFocus({ lat: b.lat, lng: b.lng })} style={{ cursor: 'pointer' }}>
                  <td className="mono"><b>{b.bus}</b></td>
                  <td><RouteBadge id={b.route} /></td>
                  <td>{b.dir}{b.layover ? ' · layover' : ''}</td>
                  <td><span className={`busst bs-${b.status.replace(/\s/g, '').toLowerCase()}`}>{b.status}</span></td>
                  <td>{b.status === 'Held' ? '—' : b.noPingMin ? `Last ping ${b.noPingMin} min ago` : b.late > 0 ? `${b.late} min late` : b.late < 0 ? `${-b.late} min early` : 'On schedule'}</td>
                  <td>{terminalName(b.garage)}</td>
                  <td>{fmtTime(b.checkIn)}</td>
                  <td>{b.openIssues || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {review && <DetourReview tpl={review.tpl} fromReport={review.fromReport} onClose={() => setReview(null)} />}
    </DashShell>
  );
}
