import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { fmtTime } from '../lib/time.js';

export function StatCard({ n, label, lead, stripe }) {
  const prev = useRef(n);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (n !== prev.current) {
      setBump(true);
      const id = setTimeout(() => setBump(false), 800);
      prev.current = n;
      return () => clearTimeout(id);
    }
  }, [n]);
  return (
    <div className={`stat ${lead ? 'lead' : ''} ${bump ? 'bump' : ''}`}>
      {stripe && <span className="stripe" style={{ background: stripe }} />}
      <div className="n">{n}</div>
      <div className="l">{label}</div>
    </div>
  );
}

export function PatternAlerts({ alerts, limit = 4, now = Date.now() }) {
  const { go } = useNav();
  if (!alerts.length) return <div className="muted small">No repeat patterns detected.</div>;
  return (
    <div className="stack-sm" style={{ gap: 10 }}>
      {alerts.slice(0, limit).map((a) => (
        <div key={a.id} className={`alert ${a.kind} ${now - a.latest < 120000 ? 'fresh' : ''}`}>
          <div className="k">{a.kind === 'vehicle' ? 'AI Pattern Alert' : 'Repeat Location Alert'}</div>
          <div className="h">{a.title}</div>
          <div className="small" style={{ fontWeight: 600 }}>{a.headline}{a.kind === 'vehicle' ? ':' : ''}</div>
          {a.kind === 'vehicle' && <div className="small">{a.dates.join(' · ')}</div>}
          <div className="small" style={{ fontWeight: 800, marginTop: 4 }}>{a.detail}</div>
          <div className="row between wrap" style={{ marginTop: 8 }}>
            <span className="small muted">Recommendation: <b style={{ color: 'var(--ink)' }}>{a.recommendation}</b></span>
            <button className="btn btn-sm" onClick={() => go(`/ticket/${a.ticketIds[a.ticketIds.length - 1]}`)}>View latest</button>
          </div>
        </div>
      ))}
      <p className="xs muted">The AI identifies patterns only. Repair decisions stay with maintenance and facilities staff.</p>
    </div>
  );
}

export function ActivityFeed({ tickets, limit = 8 }) {
  const { go } = useNav();
  const events = tickets
    .flatMap((t) => t.timeline.map((e) => ({ ...e, t })))
    .filter((e) => e.at <= Date.now() + 5000)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
  return (
    <ul className="feed">
      {events.map((e, i) => (
        <li key={`${e.t.id}-${i}`} onClick={() => go(`/ticket/${e.t.id}`)}>
          <span className="t">{fmtTime(e.at)}</span>
          <span className="grow">
            <b>{e.label}</b>
            <span className="muted"> · {e.t.ai.category === 'facilities' ? `Stop ${e.t.stopId}` : `Bus ${e.t.vehicle}`} {e.t.ai.title.toLowerCase()}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
