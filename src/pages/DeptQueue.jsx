import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { recommendedAction } from '../services/ai.js';
import { useStore, startWork, isOpen, assignTicket, addNote } from '../services/store.js';
import { DEPARTMENTS, deptLabel } from '../lib/config.js';
import { routeLabel, stopById } from '../services/maps.js';
import { fmtTime, ago, startOfDay, durationLabel } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { PriorityPill, StatusPill, RouteBadge, PRIORITY_COLOR } from '../components/ui.jsx';
import { sortQueue, useNow } from '../components/TicketTable.jsx';
import { ResolveModal } from './TicketDetail.jsx';
import { checkSoon } from '../services/guardian.js';

const CONFIG = {
  maintenance: {
    title: 'MAINTENANCE QUEUE', deps: ['maintenance'], tech: 'Tech D. Alvarez', accept: 'Accept Job', complete: 'Complete Repair & Close', steps: ['New', 'Accepted · In Progress', 'Repaired · Resolved'], notePh: 'e.g. Parts ordered, bus moved to bay 3.',
    scope: ['Doors', 'Brakes', 'Tires', 'Warning lights', 'Wheelchair equipment', 'Mirrors', 'HVAC', 'Lighting'],
  },
  facilities: {
    title: 'FACILITIES QUEUE', deps: ['facilities'], tech: 'Shelter Crew 1', accept: 'Accept Job', complete: 'Complete Job & Close', steps: ['New', 'Crew en route · In Progress', 'Completed · Closed'], notePh: 'e.g. Glass vendor scheduled for Thursday.',
    scope: ['Shelters', 'Trash', 'Signs', 'Graffiti', 'Broken glass', 'Lighting', 'Stop damage'],
  },
  safety: {
    title: 'SAFETY / SUPERVISOR QUEUE', deps: ['supervisor', 'safety'], tech: 'Road Supervisor 12', accept: 'Acknowledge & Respond', complete: 'Close Incident', steps: ['New', 'Responding', 'Closed'], notePh: 'e.g. Supervisor on scene at 2:14 PM.',
    scope: ['Passenger conduct', 'Medical', 'Slip hazards', 'Stop security', 'Fire / smoke'],
  },
};

export default function DeptQueue({ dept }) {
  const { go } = useNav();
  const c = CONFIG[dept];
  const tickets = useStore((s) => s.tickets);
  const now = useNow();
  const mine = useMemo(() => tickets.filter((t) => c.deps.includes(t.department)), [tickets, c]);
  const open = sortQueue(mine.filter(isOpen));
  const doneToday = sortQueue(mine.filter((t) => t.status === 'Resolved' && t.resolution?.at >= startOfDay(now)));
  const [selId, setSelId] = useState(null);
  const [resolving, setResolving] = useState(false);
  const [noteText, setNoteText] = useState('');
  const crews = DEPARTMENTS[c.deps[0]]?.crews || [];
  const sel = mine.find((t) => t.id === selId) || open[0] || null;
  const count = (p) => open.filter((t) => t.priority === p).length;

  return (
    <DashShell active={`/${dept}`}>
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.04em' }}>{c.title}</h1>
          <div className="small muted">Only {deptLabel(c.deps[0]).toLowerCase()} work routes here. Signed in as {c.tech} (demo).</div>
        </div>
        <div className="scope">{c.scope.map((s) => <span key={s} className="tag">{s}</span>)}</div>
      </div>

      <div className="count-row">
        <div className="stat"><span className="stripe" style={{ background: 'var(--high)' }} /><div className="n">{count('high')}</div><div className="l">High Priority</div></div>
        <div className="stat"><span className="stripe" style={{ background: 'var(--med)' }} /><div className="n">{count('medium')}</div><div className="l">Medium</div></div>
        <div className="stat"><span className="stripe" style={{ background: 'var(--low)' }} /><div className="n">{count('low')}</div><div className="l">Low</div></div>
      </div>

      <div className="queue-grid">
        <section className="panel">
          <div className="panel-h"><h2>Open jobs</h2><span className="tag">{open.length}</span></div>
          <div>
            {open.map((t) => (
              <button key={t.id} className={`job ${sel?.id === t.id ? 'sel' : ''}`} onClick={() => setSelId(t.id)}>
                <span className="sev" style={{ background: PRIORITY_COLOR[t.priority] }} />
                <span className="grow">
                  <span className="row between" style={{ alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: 800 }}>{t.ai.title}{now - t.createdAt < 120000 && t.live && <span className="new-badge">NEW</span>}</span>
                    <StatusPill s={t.status} />
                  </span>
                  <span className="small muted" style={{ display: 'block' }}>
                    {t.ai.category === 'facilities' ? `Stop ${t.stopId} · ${stopById(t.stopId)?.name}` : `Bus ${t.vehicle} · Route ${t.route}`} · {ago(t.createdAt, now)}
                  </span>
                </span>
              </button>
            ))}
            {!open.length && <div className="panel-b muted">Queue clear.</div>}
          </div>
        </section>

        <section className="panel">
          {sel ? (
            <>
              <div className="panel-h">
                <div>
                  <div className="mono small muted">{sel.id}</div>
                  <h2 style={{ fontSize: 19 }}>{sel.ai.title}</h2>
                </div>
                <PriorityPill p={sel.priority} resolved={sel.status === 'Resolved'} />
              </div>
              <div className="panel-b stack">
                <dl className="kv">
                  {sel.ai.category === 'facilities'
                    ? (<><dt>Stop</dt><dd>{sel.stopId} · {stopById(sel.stopId)?.name}</dd></>)
                    : (<><dt>Vehicle</dt><dd className="mono">{sel.vehicle}</dd></>)}
                  <dt>Route</dt><dd className="row" style={{ gap: 6 }}><RouteBadge id={sel.route} /> {routeLabel(sel.route)}</dd>
                  <dt>Reported</dt><dd>{fmtTime(sel.createdAt)} by {sel.operatorName}</dd>
                  <dt>Status</dt><dd><StatusPill s={sel.status} /> {sel.assignee && <span className="small muted"> · {sel.assignee}</span>}</dd>
                </dl>
                <blockquote className="quote" style={{ fontSize: 15 }}>“{sel.originalText}”</blockquote>
                <div className="small"><b>AI summary:</b> {sel.ai.summary}</div>
                <div className="rec"><b style={{ flex: 'none' }}>Next step</b><span>{recommendedAction({ ...sel.ai, priority: sel.priority })}</span></div>
                {sel.photo && <div className="ev-photo"><img src={sel.photo} alt="Operator photo" /></div>}

                <div className="stack-sm">
                  <span className="eyebrow">Workflow</span>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {c.steps.map((st, i) => {
                      const idx = sel.status === 'Resolved' ? 2 : sel.status === 'In Progress' ? 1 : 0;
                      return <span key={st} className="tag" style={i <= idx ? { background: i === 2 ? 'var(--ok)' : 'var(--accent)', color: 'var(--accent-ink)' } : {}}>{i + 1}. {st}</span>;
                    })}
                  </div>
                </div>

                {sel.status !== 'Resolved' && (
                  <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
                    <label className="small" htmlFor="crew" style={{ fontWeight: 700 }}>Assigned crew</label>
                    <select id="crew" className="select" style={{ width: 'auto', minWidth: 180 }} value={sel.assignee || ''} onChange={(e) => e.target.value && assignTicket(sel.id, e.target.value, `${deptLabel(c.deps[0])} lead`)}>
                      <option value="">Unassigned</option>
                      {crews.map((cr) => <option key={cr}>{cr}</option>)}
                    </select>
                  </div>
                )}

                {sel.status === 'New' || sel.status === 'Assigned' ? (
                  <button className="btn btn-primary btn-lg" onClick={() => { startWork(sel.id, sel.assignee || c.tech); checkSoon(sel.id); }}>{c.accept}</button>
                ) : sel.status === 'In Progress' ? (
                  <button className="btn btn-ok btn-lg" onClick={() => setResolving(true)}>{c.complete}</button>
                ) : (
                  <div className="notice notice-ok stack-sm" style={{ gap: 6 }}>
                    <b>✓ {sel.department === 'facilities' ? 'Completed and closed' : 'Resolved'} by {sel.resolution?.by} at {fmtTime(sel.resolution?.at)} · {durationLabel((sel.resolution?.at || 0) - sel.createdAt)} from report</b>
                    <span>{sel.resolution?.note}</span>
                    {sel.resolution?.photo && <div className="ev-photo" style={{ maxWidth: 260 }}><img src={sel.resolution.photo} alt="Completion photo" /></div>}
                    <span className="small muted">Supervisors see this on the Command dashboard; the operator sees it in My Reports.</span>
                  </div>
                )}

                {sel.status !== 'Resolved' && (
                  <div className="row" style={{ gap: 8 }}>
                    <input className="input grow" value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder={c.notePh} aria-label="Add a note" onKeyDown={(e) => { if (e.key === 'Enter' && noteText.trim()) { addNote(sel.id, noteText.trim(), sel.assignee || c.tech); setNoteText(''); } }} />
                    <button className="btn" disabled={!noteText.trim()} onClick={() => { addNote(sel.id, noteText.trim(), sel.assignee || c.tech); setNoteText(''); }}>Add note</button>
                  </div>
                )}
                {sel.notes?.length > 0 && (
                  <div className="stack-sm">
                    {sel.notes.slice(-3).map((n, i) => <div key={i} className="ev"><div className="small">{n.text}</div><div className="xs muted">{n.by} · {fmtTime(n.at)}</div></div>)}
                  </div>
                )}
                <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => go(`/ticket/${sel.id}`)}>Open full ticket →</button>
              </div>
            </>
          ) : (
            <div className="panel-b muted">Select a job.</div>
          )}
        </section>
      </div>

      <section className="panel">
        <div className="panel-h"><h2>Resolved today</h2><span className="tag">{doneToday.length}</span></div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 620 }}>
            <thead><tr><th>Ticket</th><th>Issue</th><th>Unit</th><th>Resolved</th><th>Time to resolve</th><th>Note</th></tr></thead>
            <tbody>
              {doneToday.map((t) => (
                <tr key={t.id} onClick={() => go(`/ticket/${t.id}`)}>
                  <td className="mono xs">{t.id}</td>
                  <td style={{ fontWeight: 600 }}>{t.ai.title}</td>
                  <td className="mono">{t.ai.category === 'facilities' ? `Stop ${t.stopId}` : t.vehicle}</td>
                  <td className="small">{fmtTime(t.resolution.at)}</td>
                  <td className="small num">{durationLabel(t.resolution.at - t.createdAt)}</td>
                  <td className="small muted">{t.resolution.note}</td>
                </tr>
              ))}
              {!doneToday.length && <tr><td colSpan={6} className="muted center">Nothing resolved yet today.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {resolving && sel && <ResolveModal t={sel} by={sel.assignee || c.tech} onClose={() => setResolving(false)} />}
    </DashShell>
  );
}

export const DEPT_VIEWS = Object.keys(CONFIG);
export { DEPARTMENTS };
