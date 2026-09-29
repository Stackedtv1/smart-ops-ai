import { useState } from 'react';
import { OPERATOR, deptLabel } from '../lib/config.js';
import { useStore, isOpen } from '../services/store.js';
import { startOfDay, fmtTime } from '../lib/time.js';
import { PriorityPill, StatusPill } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

export default function MyReports() {
  const [filter, setFilter] = useState('open');
  const mine = useStore((s) => s.tickets.filter((t) => t.operatorId === OPERATOR.id && t.createdAt >= startOfDay()))
    .sort((a, b) => b.createdAt - a.createdAt);
  const list = filter === 'open' ? mine.filter(isOpen) : mine;

  return (
    <OperatorShell back="/operator" title="My Reports">
      <div className="filters">
        <button className={filter === 'open' ? 'on' : ''} onClick={() => setFilter('open')}>Open ({mine.filter(isOpen).length})</button>
        <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>All today ({mine.length})</button>
      </div>
      {list.map((t) => {
        const last = t.timeline[t.timeline.length - 1];
        return (
          <div key={t.id} className="panel" style={{ padding: 14 }}>
            <div className="row between" style={{ alignItems: 'flex-start' }}>
              <div className="grow">
                <div style={{ fontWeight: 800, fontSize: 16 }}>{t.ai.title}</div>
                <div className="mono xs muted">{t.id} · {fmtTime(t.createdAt)}</div>
              </div>
              <PriorityPill p={t.priority} resolved={t.status === 'Resolved'} />
            </div>
            <div className="row between" style={{ marginTop: 10 }}>
              <span className="small">{deptLabel(t.department)}{t.assignee ? ` · ${t.assignee}` : ''}</span>
              <StatusPill s={t.status} />
            </div>
            <div className="xs muted" style={{ marginTop: 6 }}>Latest: {last.label} at {fmtTime(last.at)}</div>
            {t.resolution && <div className="notice notice-info" style={{ marginTop: 8 }}>{t.resolution.note}</div>}
          </div>
        );
      })}
      {!list.length && <div className="notice notice-info">No open reports right now.</div>}
    </OperatorShell>
  );
}
