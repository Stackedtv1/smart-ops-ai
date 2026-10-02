import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore, isOpen } from '../services/store.js';
import { fmtTime, ago, startOfDay } from '../lib/time.js';
import { ROUTES } from '../services/maps.js';
import {
  fleetStatus, clearDetour, sendMessage, ackMessage, ackProgress, TERMINALS, terminalName,
  setFieldStatus, FIELD_KINDS, RELIEF, reliefStatus, riderAlertText,
} from '../services/ops.js';
import DetourPlanner from '../components/DetourPlanner.jsx';
import { deptLabel } from '../lib/config.js';
import DashShell from '../components/DashShell.jsx';
import OpsMap from '../components/OpsMap.jsx';
import DispatchSearch from '../components/DispatchSearch.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { RouteBadge } from '../components/ui.jsx';
import { StatCard } from '../components/Widgets.jsx';

const LAYERS = [['buses', 'Buses'], ['field', 'Operator reports'], ['relief', 'Relief points'], ['terminals', 'Terminals']];
const ROUTE_IDS = ROUTES.filter((r) => r.path?.length > 1 || r.sharesPathWith).map((r) => r.id);

export default function DispatchHub() {
  const { go } = useNav();
  const ops = useStore((s) => s.ops);
  const now = useNow(10000);
  const fleet = useMemo(() => fleetStatus(now), [now, ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const [layers, setLayers] = useState({ buses: true, field: true, relief: false, terminals: true });
  const [planner, setPlanner] = useState(null);
  const tickets = useStore((s) => s.tickets);
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

  // Needs attention now: the few things a dispatcher should act on, each with the recommended action.
  const attn = [];
  field.filter((f) => f.kind === 'road_blocked' && f.status === 'Open').forEach((f) => attn.push({
    id: f.id, level: 'critical', title: `Road closure reported · Bus ${f.bus}`,
    why: `“${f.text}”${f.affectedRoutes?.length ? ` · Guardian: affects Route${f.affectedRoutes.length > 1 ? 's' : ''} ${f.affectedRoutes.join(', ')}` : ''}`,
    action: 'Plan detour', run: () => setPlanner({ report: f }),
  }));
  inbox.filter((m) => !m.acks?.DISPATCH && m.priority === 'emergency').forEach((m) => attn.push({
    id: m.id, level: 'critical', title: `Operator emergency · ${m.from}`, why: m.text, action: 'Acknowledge', run: () => ackMessage(m.id, 'DISPATCH', 'Central Dispatch'),
  }));
  activeDetours.forEach((d) => {
    const pend = d.recipients.filter((b) => !d.acks?.[b]);
    if (pend.length) attn.push({ id: d.id, level: 'warn', title: `Detour ${d.id}: ${pend.length} operator${pend.length > 1 ? 's' : ''} haven't acknowledged`, why: `Waiting on Bus ${pend.join(', ')}`, action: 'Resend to them', run: () => sendMessage({ to: pend.length === 1 ? { kind: 'bus', id: pend[0] } : { kind: 'route', id: d.routes[0] }, priority: 'high', text: `DETOUR ACTIVE: ${d.closure}. Open SMART Ops and acknowledge.` }) });
  });
  tickets.filter((t) => isOpen(t) && t.priority === 'high' && (t.ai.category === 'vehicle_defect' || t.ai.category === 'safety') && !t.assignee).slice(0, 2).forEach((t) => attn.push({
    id: t.id, level: t.ai.category === 'safety' ? 'critical' : 'warn', title: `${t.ai.category === 'safety' ? 'Safety' : 'Vehicle'}: ${t.vehicle ? `Bus ${t.vehicle} · ` : ''}${t.ai.title}`, why: `High priority, no one assigned · routed to ${deptLabel(t.department)}`, action: 'Open ticket', run: () => go(`/ticket/${t.id}`),
  }));
  inbox.filter((m) => !m.acks?.DISPATCH && m.priority !== 'emergency').slice(0, 2).forEach((m) => attn.push({
    id: m.id, level: 'info', title: `Request from ${m.from}`, why: m.text, action: 'Acknowledge', run: () => ackMessage(m.id, 'DISPATCH', 'Central Dispatch'),
  }));
  sent.filter((m) => ackProgress(m).pending.length && now - m.at > 30 * 60000).slice(0, 1).forEach((m) => attn.push({
    id: `ack-${m.id}`, level: 'info', title: `${ackProgress(m).pending.length} buses never acknowledged ${m.id}`, why: m.text, action: 'Resend', run: () => sendMessage({ to: { kind: 'all' }, text: m.text }),
  }));

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

      <section className="panel">
        <div className="panel-h"><h2>Needs attention now</h2><span className="tag">{attn.length}</span></div>
        <div className="panel-b attn">
          {attn.length === 0 && <div className="small muted">Nothing needs a dispatcher right now.</div>}
          {attn.slice(0, 6).map((a) => (
            <div key={a.id} className={`attn-item ${a.level}`}>
              <span className="bar" />
              <span style={{ minWidth: 0 }}><span className="t" style={{ display: 'block' }}>{a.title}</span><span className="w">{a.why}</span></span>
              <button className={`btn btn-sm ${a.level === 'critical' ? 'btn-primary' : ''}`} onClick={a.run}>{a.action}</button>
            </div>
          ))}
          <div className="row wrap" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={() => setPlanner({ report: null })}>+ Road closure called in · plan a detour</button>
          </div>
        </div>
      </section>

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
              const canPlan = f.kind === 'road_blocked';
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
                    {canPlan && !published && f.status !== 'Detour published' && <button className="btn btn-sm btn-primary" onClick={() => setPlanner({ report: f })}>Plan detour</button>}
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
                  <div className="small muted">No active detours.</div>
                  <button className="btn btn-sm" onClick={() => setPlanner({ report: null })}>Plan a detour</button>
                </>
              )}
              {activeDetours.map((d) => {
                const a = Object.keys(d.acks || {}).length;
                return (
                  <div key={d.id} className="detour compact">
                    <div className="detour-h"><span className="detour-tag">DETOUR ACTIVE</span><span className="mono xs">{d.id} · {ago(d.at, now)}</span></div>
                    <div className="detour-t">Routes {d.routes.join('/')} {d.direction}</div>
                    <div className="detour-why">{d.closure}</div>
                    <div className="detour-meta"><span><b>{d.bypassed.length}</b> stops bypassed</span><span><b>{d.temporary.length}</b> temporary</span><span><b>+{d.delayMin} min</b></span></div>
                    <div className="ackbar"><span style={{ width: `${(a / Math.max(1, d.recipients.length)) * 100}%` }} /></div>
                    <div className="xs">{a}/{d.recipients.length} operators acknowledged · terminals notified: {d.terminals.map(terminalName).join(', ')}</div>
                    <details style={{ marginTop: 4 }}><summary className="xs" style={{ cursor: 'pointer', fontWeight: 700 }}>Rider alert preview</summary><div className="rider-alert" style={{ color: 'var(--ink)', marginTop: 6 }}>{riderAlertText(d)}</div></details>
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

      {planner && <DetourPlanner report={planner.report} onClose={() => setPlanner(null)} />}
    </DashShell>
  );
}
