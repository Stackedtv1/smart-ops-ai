import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore, dashboardStats, patternAlerts, isOpen } from '../services/store.js';
import DashShell from '../components/DashShell.jsx';
import { MonitorModeBadge } from '../components/ui.jsx';
import IssueMap from '../components/IssueMap.jsx';
import TicketTable, { sortQueue, useNow } from '../components/TicketTable.jsx';
import { StatCard, PatternAlerts, ActivityFeed, CrewPanel } from '../components/Widgets.jsx';
import { startOfDay } from '../lib/time.js';

const FILTERS = [
  ['open', 'Open'],
  ['high', 'High priority'],
  ['vehicle_defect', 'Vehicle'],
  ['facilities', 'Facilities'],
  ['safety', 'Safety'],
  ['resolved', 'Resolved today'],
];

function GuardianStrip() {
  const { go } = useNav();
  const c = useStore((s) => s.guardian);
  const fixes = c.audit.filter((a) => a.kind === 'auto-fix' && !a.undone).length;
  const esc = c.followups.filter((f) => !f.closed).length;
  const latest = c.incidents[0];
  return (
    <button className="cp-strip" onClick={() => go('/guardian')}>
      <span className="row wrap" style={{ gap: 8, minWidth: 0 }}><span className="live-dot" /><b>Guardian</b><MonitorModeBadge compact /></span>
      <span className="num"><b>{fixes}</b> auto-fixes</span>
      <span className="num"><b>{esc}</b> escalation{esc === 1 ? '' : 's'} awaiting a person</span>
      {latest && <span className="grow cp-latest">Latest: {latest.title}</span>}
      <span className="cp-open">Open Guardian →</span>
    </button>
  );
}

export default function Dashboard({ compact }) {
  const { go } = useNav();
  const tickets = useStore((s) => s.tickets);
  const now = useNow(5000);
  const stats = useMemo(() => dashboardStats(tickets, now), [tickets, now]);
  const alerts = useMemo(() => patternAlerts(tickets, now), [tickets, now]);
  const [filter, setFilter] = useState('open');

  const rows = useMemo(() => {
    const today = startOfDay(now);
    const f = {
      open: isOpen,
      high: (t) => isOpen(t) && t.priority === 'high',
      vehicle_defect: (t) => isOpen(t) && t.ai.category === 'vehicle_defect',
      facilities: (t) => isOpen(t) && t.ai.category === 'facilities',
      safety: (t) => isOpen(t) && t.ai.category === 'safety',
      resolved: (t) => t.status === 'Resolved' && t.resolution?.at >= today,
    }[filter];
    return sortQueue(tickets.filter(f));
  }, [tickets, filter, now]);

  return (
    <DashShell active="/dashboard">
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>SMART Command Dashboard</h1>
          <div className="small muted">Fixed-route operations · Macomb, Oakland & Wayne · Updates the moment an operator submits</div>
        </div>
        <span className="demo-data">Demo data</span>
      </div>

      <div className="stat-row">
        <StatCard n={stats.open} label="Open Issues" lead />
        <StatCard n={stats.vehicle} label="Vehicle" stripe="#0b5cad" />
        <StatCard n={stats.facilities} label="Facilities" stripe="#0f7a6d" />
        <StatCard n={stats.safety} label="Safety" stripe="var(--high)" />
        <StatCard n={stats.other} label="Other" stripe="var(--line-strong)" />
      </div>
      <div className="kpi-row">
        <button className="kpi kpi-btn" onClick={() => { setFilter('resolved'); document.getElementById('ticket-queue')?.scrollIntoView({ behavior: 'smooth' }); }} title="Show tickets resolved today"><span className="n">{stats.resolvedToday}</span><span className="l">Resolved Today →</span></button>
        <div className="kpi"><span className="n">{stats.avgResolutionMin} min</span><span className="l">Average Resolution</span></div>
        <div className="kpi"><span className="n">{stats.repeatLocations}</span><span className="l">Repeat Problem Locations</span></div>
        <div className="kpi"><span className="n">{stats.assignedPct}%</span><span className="l">Assigned</span></div>
      </div>

      <GuardianStrip />

      <div className="main-grid">
        <section className="panel">
          <div className="panel-h">
            <h2>Live Issue Map</h2>
            <span className="small muted">Open issues + resolved today · click a marker</span>
          </div>
          <IssueMap tickets={tickets} onOpen={(id) => go(`/ticket/${id}`)} height={compact ? 420 : 520} />
          <div className="panel-h" style={{ borderTop: '1px solid var(--line)' }}><h2>Live Activity</h2><span className="live-dot" /></div>
          <ActivityFeed tickets={tickets} limit={6} />
        </section>
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>AI Pattern Alerts</h2><span className="tag">{alerts.length}</span></div>
            <div className="panel-b"><PatternAlerts alerts={alerts} limit={3} now={now} /></div>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Crew Assignments</h2><span className="small muted">Active jobs · resolved today</span></div>
            <CrewPanel tickets={tickets} now={now} />
          </section>
        </div>
      </div>

      <section className="panel" id="ticket-queue">
        <div className="panel-h" style={{ flexWrap: 'wrap' }}>
          <h2>Ticket Queue</h2>
          <div className="filters">
            {FILTERS.map(([k, l]) => (
              <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        <TicketTable tickets={rows} />
      </section>
    </DashShell>
  );
}
