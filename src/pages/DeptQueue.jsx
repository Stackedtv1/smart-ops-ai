import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore, startWork, isOpen } from '../services/store.js';
import { DEPARTMENTS, deptLabel } from '../lib/config.js';
import { routeLabel, stopById } from '../services/maps.js';
import { fmtTime, ago, startOfDay, durationLabel } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { PriorityPill, StatusPill, RouteBadge, PRIORITY_COLOR } from '../components/ui.jsx';
import { sortQueue, useNow } from '../components/TicketTable.jsx';
import { ResolveModal } from './TicketDetail.jsx';

const CONFIG = {
  maintenance: {
    title: 'MAINTENANCE QUEUE', deps: ['maintenance'], tech: 'Tech D. Alvarez', accept: 'Accept Job',
    scope: ['Doors', 'Brakes', 'Tires', 'Warning lights', 'Wheelchair equipment', 'Mirrors', 'HVAC', 'Lighting'],
  },
  facilities: {
    title: 'FACILITIES QUEUE', deps: ['facilities'], tech: 'Shelter Crew 1', accept: 'Accept Job',
    scope: ['Shelters', 'Trash', 'Signs', 'Graffiti', 'Broken glass', 'Lighting', 'Stop damage'],
  },
  safety: {
    title: 'SAFETY / SUPERVISOR QUEUE', deps: ['supervisor', 'safety'], tech: 'Road Supervisor 12', accept: 'Acknowledge & Respond',
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
                {sel.photo && <div className="ev-photo"><img src={sel.photo} alt="Operator photo" /></div>}

                <div className="stack-sm">
                  <span className="eyebrow">Workflow</span>
                  <div className="row wrap" style={{ gap: 8 }}>
                    {['Assigned / New', 'In Progress', 'Resolved'].map((s, i) => {
                      const idx = sel.status === 'Resolved' ? 2 : sel.status === 'In Progress' ? 1 : 0;
                      return <span key={s} className="tag" style={i <= idx ? { background: 'var(--accent)', color: 'var(--accent-ink)' } : {}}>{i + 1}. {s}</span>;
                    })}
                  </div>
                </div>

                {sel.status === 'New' || sel.status === 'Assigned' ? (
                  <button className="btn btn-primary btn-lg" onClick={() => startWork(sel.id, sel.assignee || c.tech)}>{c.accept}</button>
                ) : sel.status === 'In Progress' ? (
                  <button className="btn btn-ok btn-lg" onClick={() => setResolving(true)}>Resolve</button>
                ) : (
                  <div className="notice notice-info">Resolved: {sel.resolution?.note}</div>
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
