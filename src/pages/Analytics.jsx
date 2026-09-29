import { useMemo } from 'react';
import { useStore, patternAlerts } from '../services/store.js';
import { startOfDay } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { PatternAlerts } from '../components/Widgets.jsx';
import { useNow } from '../components/TicketTable.jsx';

// Rolling 7-day baseline (simulated). Live demo reports are added on top.
const WEEK = {
  total: 187,
  byDay: [27, 31, 29, 24, 18, 22, 36],
  byCategory: { vehicle_defect: 80, facilities: 54, safety: 32, other: 21 },
  byGarage: { 'Oakland Terminal': 72, 'Macomb Terminal': 61, 'Wayne Terminal': 54 },
  byShift: { Morning: 81, Afternoon: 69, Night: 37 },
  vehicleIssues: [['Doors', 21], ['Brakes', 14], ['Warning lights', 13], ['Wheelchair equipment', 11], ['HVAC', 9]],
  facilityIssues: [['Trash', 17], ['Broken shelter glass', 12], ['Lighting', 10], ['Graffiti', 8], ['Sign damage', 5]],
  repeatIssues: 18,
  avgAssign: '2 min 14 sec',
  avgResolution: 42,
  adoptionGarage: [['Oakland Terminal', 91], ['Macomb Terminal', 84], ['Wayne Terminal', 76]],
  adoptionShift: [['Morning', 89], ['Afternoon', 82], ['Night', 71]],
};

const VEH_KEY = { passenger_door: 'Doors', brakes: 'Brakes', warning_indicator: 'Warning lights', accessibility_equipment: 'Wheelchair equipment', hvac: 'HVAC' };
const FAC_KEY = { trash: 'Trash', broken_glass: 'Broken shelter glass', lighting: 'Lighting', graffiti: 'Graffiti', sign_damage: 'Sign damage' };
const CAT_COLORS = { vehicle_defect: '#0b5cad', facilities: '#0f7a6d', safety: 'var(--high)', other: 'var(--line-strong)' };
const CAT_NAMES = { vehicle_defect: 'Vehicle', facilities: 'Facilities', safety: 'Safety', other: 'Other' };

function Bars({ rows, max, suffix = '', target, color }) {
  const m = max || Math.max(...rows.map((r) => r[1]), 1);
  return (
    <div className="bars">
      {rows.map(([l, v]) => (
        <div key={l} className="bar-row">
          <span className="lbl">{l}</span>
          <span className="track">
            <span className="fill" style={{ width: `${(v / m) * 100}%`, display: 'block', background: color || 'var(--accent)' }} />
            {target && <span className="target" style={{ left: `${(target / m) * 100}%` }} title={`Target ${target}${suffix}`} />}
          </span>
          <span className="val">{v}{suffix}</span>
        </div>
      ))}
    </div>
  );
}

export default function Analytics() {
  const tickets = useStore((s) => s.tickets);
  const now = useNow(15000);
  const live = useMemo(() => tickets.filter((t) => t.live), [tickets]);
  const alerts = useMemo(() => patternAlerts(tickets, now), [tickets, now]);

  const d = useMemo(() => {
    const cat = { ...WEEK.byCategory };
    const garage = { ...WEEK.byGarage };
    const shift = { ...WEEK.byShift };
    const veh = Object.fromEntries(WEEK.vehicleIssues);
    const fac = Object.fromEntries(WEEK.facilityIssues);
    for (const t of live) {
      const c = ['operations', 'other'].includes(t.ai.category) ? 'other' : t.ai.category;
      cat[c] += 1;
      garage[t.garage] = (garage[t.garage] || 0) + 1;
      shift[t.shift] = (shift[t.shift] || 0) + 1;
      if (VEH_KEY[t.ai.subcategory]) veh[VEH_KEY[t.ai.subcategory]] += 1;
      String(t.ai.subcategory).split('+').forEach((s) => FAC_KEY[s] && (fac[FAC_KEY[s]] += 1));
    }
    const total = WEEK.total + live.length;
    const byDay = [...WEEK.byDay];
    byDay[6] += live.length;
    return {
      total, cat, byDay,
      garage: Object.entries(garage),
      shift: Object.entries(shift),
      veh: Object.entries(veh).sort((a, b) => b[1] - a[1]),
      fac: Object.entries(fac).sort((a, b) => b[1] - a[1]),
    };
  }, [live]);

  const pct = (n) => Math.round((n / d.total) * 100);
  const days = [...Array(7)].map((_, i) => new Date(startOfDay(now) - (6 - i) * 86400000).toLocaleDateString([], { weekday: 'short' }));
  const maxDay = Math.max(...d.byDay);

  return (
    <DashShell active="/analytics">
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>Operational Analytics</h1>
          <div className="small muted">Last 7 days · all garages · live demo reports included</div>
        </div>
        <span className="demo-data">Demo data · simulated</span>
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <div className="stat lead"><div className="n">{d.total}</div><div className="l">Reports this week</div></div>
        <div className="stat"><div className="n" style={{ fontSize: 34 }}>{WEEK.avgAssign}</div><div className="l">Avg assignment time</div></div>
        <div className="stat"><div className="n">{WEEK.avgResolution} min</div><div className="l">Avg resolution time</div></div>
        <div className="stat"><div className="n">{WEEK.repeatIssues}</div><div className="l">Repeat issues</div></div>
      </div>

      <div className="an-grid">
        <section className="panel span2">
          <div className="panel-h"><h2>Issues by category</h2><span className="small muted">Share of {d.total} reports</span></div>
          <div className="panel-b stack">
            <div className="split" role="img" aria-label="Issues by category">
              {Object.entries(d.cat).map(([k, v]) => <span key={k} style={{ width: `${(v / d.total) * 100}%`, background: CAT_COLORS[k] }} title={`${CAT_NAMES[k]} ${pct(v)}%`} />)}
            </div>
            <div className="legend">
              {Object.entries(d.cat).map(([k, v]) => (
                <span key={k}><i style={{ background: CAT_COLORS[k] }} /><b>{CAT_NAMES[k]}</b> — {pct(v)}% <span className="muted">({v})</span></span>
              ))}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Reports per day</h2><span className="small muted">Today highlighted</span></div>
          <div className="panel-b">
            <div className="cols">
              {d.byDay.map((v, i) => (
                <div key={i} className={`c ${i === 6 ? 'today' : ''}`}>
                  <b>{v}</b>
                  <i style={{ height: `${(v / maxDay) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="col-labels" style={{ marginTop: 6 }}>{days.map((x, i) => <span key={i}>{i === 6 ? 'Today' : x}</span>)}</div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Average routing time</h2><span className="small muted">Weekly average</span></div>
          <div className="panel-b">
            <ol className="ranked" style={{ counterReset: 'r' }}>
              <li><span>Operator submits → AI routed</span><b className="num">3 sec</b></li>
              <li><span>Routed → crew assigned</span><b className="num">{WEEK.avgAssign}</b></li>
              <li><span>Assigned → work started</span><b className="num">14 min</b></li>
              <li><span>Report → resolved</span><b className="num">{WEEK.avgResolution} min</b></li>
            </ol>
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Reports by garage</h2></div>
          <div className="panel-b"><Bars rows={d.garage} /></div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Reports by shift</h2></div>
          <div className="panel-b"><Bars rows={d.shift} /></div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Most common vehicle issues</h2></div>
          <div className="panel-b"><ol className="ranked">{d.veh.map(([l, v]) => <li key={l}><span>{l}</span><b className="num">{v}</b></li>)}</ol></div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Most common facility issues</h2></div>
          <div className="panel-b"><ol className="ranked">{d.fac.map(([l, v]) => <li key={l}><span>{l}</span><b className="num">{v}</b></li>)}</ol></div>
        </section>

        <section className="panel span2">
          <div className="panel-h"><h2>Repeat-problem detection</h2><span className="tag">{alerts.length} active</span></div>
          <div className="panel-b"><PatternAlerts alerts={alerts} limit={6} now={now} /></div>
        </section>

        <section className="panel span2">
          <div className="panel-h">
            <h2>Digital Reporting Adoption</h2>
            <span className="small muted">Share of reports filed digitally vs. paper · target 85%</span>
          </div>
          <div className="panel-b an-grid" style={{ gap: 24 }}>
            <div className="stack-sm"><span className="eyebrow">By garage</span><Bars rows={WEEK.adoptionGarage} max={100} suffix="%" target={85} color="#0f7a6d" /></div>
            <div className="stack-sm"><span className="eyebrow">By shift</span><Bars rows={WEEK.adoptionShift} max={100} suffix="%" target={85} color="#0f7a6d" /></div>
          </div>
          <div className="panel-b" style={{ paddingTop: 0 }}>
            <div className="notice notice-info small">Adoption is reported at team level (garage, shift, route) only. It is not an individual operator performance tool.</div>
          </div>
        </section>
      </div>
    </DashShell>
  );
}
