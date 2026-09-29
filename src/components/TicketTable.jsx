import { useEffect, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { catShort, deptLabel } from '../lib/config.js';
import { ago } from '../lib/time.js';
import { PriorityPill, StatusPill, RouteBadge } from './ui.jsx';

const RANK = { high: 0, medium: 1, low: 2 };
const SRANK = { New: 0, Assigned: 1, 'In Progress': 2, Resolved: 3 };

export function unitLabel(t) {
  return t.ai.category === 'facilities' ? `Stop ${t.stopId}` : t.vehicle;
}

export function sortQueue(list) {
  return [...list].sort((a, b) => {
    const ra = a.status === 'Resolved' ? 1 : 0;
    const rb = b.status === 'Resolved' ? 1 : 0;
    if (ra !== rb) return ra - rb;
    if (ra) return (b.resolution?.at || 0) - (a.resolution?.at || 0);
    return RANK[a.priority] - RANK[b.priority] || SRANK[a.status] - SRANK[b.status] || b.createdAt - a.createdAt;
  });
}

export function useNow(ms = 10000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export default function TicketTable({ tickets, showRoute = true }) {
  const { go } = useNav();
  const now = useNow();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Priority</th>
            <th>Type</th>
            <th>Unit</th>
            {showRoute && <th>Route</th>}
            <th>Issue</th>
            <th>Department</th>
            <th>Status</th>
            <th>Reported</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => {
            const fresh = now - t.createdAt < 120000 && t.live;
            return (
              <tr key={t.id} className={fresh ? 'fresh' : ''} onClick={() => go(`/ticket/${t.id}`)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && go(`/ticket/${t.id}`)}>
                <td><PriorityPill p={t.priority} resolved={t.status === 'Resolved'} /></td>
                <td style={{ fontWeight: 700 }}>{catShort(t.ai.category)}</td>
                <td className="mono" style={{ fontWeight: 600 }}>{unitLabel(t)}</td>
                {showRoute && <td><RouteBadge id={t.route} /></td>}
                <td>
                  <span style={{ fontWeight: 600 }}>{t.ai.title}</span>
                  {fresh && <span className="new-badge">NEW</span>}
                  <div className="xs muted mono">{t.id}</div>
                </td>
                <td>{deptLabel(t.department)}</td>
                <td><StatusPill s={t.status} /></td>
                <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(t.createdAt, now)}</td>
              </tr>
            );
          })}
          {!tickets.length && (
            <tr><td colSpan={8} className="muted center" style={{ padding: 24 }}>No tickets match this filter.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
