import { useMemo, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore } from '../services/store.js';
import { fleetHealth, vehicleHealth, sysLabel, FLEET_RULES } from '../services/fleet.js';
import { simulateServiceDays } from '../services/guardian.js';
import { routeLabel } from '../services/maps.js';
import { garageOf } from '../services/store.js';
import { fmtDate, fmtDateTime } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { PriorityPill, StatusPill, MonitorModeBadge } from '../components/ui.jsx';
import vehicleData from '../data/demoVehicles.json';

const STATUS_CLS = { 'Critical Review': 'fs-crit', 'Attention Required': 'fs-attn', 'Maintenance Due': 'fs-due', Normal: 'fs-ok' };
const mi = (n) => `${Math.round(n).toLocaleString()} mi`;
const routeOf = (bus) => vehicleData.vehicles.find((v) => v.fleet_number === bus)?.route;

export function FleetStatus({ s }) {
  return <span className={`fs-pill ${STATUS_CLS[s]}`}>{s}</span>;
}

function DataPath() {
  return (
    <div className="fs-path" aria-label="Data path">
      <span>Fleet / bus number</span><i>→</i><span>VIN</span><i>→</i><span>SMART maintenance record</span><i>→</i><span>SMART Ops Guardian</span>
    </div>
  );
}

function PmBar({ rec }) {
  const used = Math.min(1.15, Math.max(0, 1 - rec.pmRemainingMi / FLEET_RULES.pmIntervalMi));
  const over = rec.pmRemainingMi < 0;
  return (
    <div className="pm-bar" title={`${Math.round(used * 100)}% of PM interval used`}>
      <span style={{ width: `${Math.min(100, used * 100)}%`, background: over ? 'var(--high)' : rec.pmRemainingMi <= FLEET_RULES.pmWatchMi ? 'var(--med)' : 'var(--ok)' }} />
    </div>
  );
}

export default function FleetHealth() {
  const { go } = useNav();
  const state = useStore((s) => s);
  const now = useNow(10000);
  const rows = useMemo(() => fleetHealth(state, now), [state, now]);
  const [filter, setFilter] = useState('all');
  const count = (s) => rows.filter((r) => r.status === s).length;
  const shown = rows.filter((r) => filter === 'all' || r.status === filter);

  return (
    <DashShell active="/fleet">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>Fleet Health & Maintenance</h1>
          <div className="small muted">Operator reports, maintenance history, PM schedules and fault codes in one view per bus. Guardian watches all of it.</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => simulateServiceDays(3)}>Simulate 3 service days of mileage</button>
        </div>
      </div>

      <div className="notice notice-info small row wrap between" style={{ gap: 10 }}>
        <span><b>Simulated maintenance-system data.</b> In production SMART Ops reads mileage, PM schedules, work orders and fault codes from SMART's existing fleet/maintenance system, so nobody enters anything twice.</span>
        <DataPath />
      </div>

      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {['Critical Review', 'Attention Required', 'Maintenance Due', 'Normal'].map((s) => (
          <button key={s} className={`stat fs-stat ${filter === s ? 'on' : ''}`} onClick={() => setFilter(filter === s ? 'all' : s)} aria-pressed={filter === s}>
            <span className={`stripe ${STATUS_CLS[s]}`} />
            <div className="n">{count(s)}</div>
            <div className="l">{s}</div>
          </button>
        ))}
      </div>

      <section className="panel">
        <div className="panel-h" style={{ flexWrap: 'wrap', gap: 8 }}>
          <h2>Fleet ({rows.length} demo buses)</h2>
          <span className="small muted">{filter === 'all' ? 'Worst first · tap a bus' : `Showing ${filter}`}{state.fleet?.simulatedDays ? ` · +${state.fleet.simulatedDays} simulated service days` : ''}</span>
        </div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 980 }}>
            <thead>
              <tr><th>Bus</th><th>Guardian status</th><th>Mileage</th><th>Next PM</th><th>Brakes / tires</th><th>Faults</th><th>Open tickets</th><th>Work orders</th><th>Why</th></tr>
            </thead>
            <tbody>
              {shown.map(({ rec, status, reasons, open }) => {
                const why = reasons[status]?.[0] || 'No issues';
                return (
                  <tr key={rec.bus} onClick={() => go(`/fleet/${rec.bus}`)}>
                    <td>
                      <div className="display" style={{ fontSize: 20, fontWeight: 700, lineHeight: 1 }}>#{rec.bus}</div>
                      <div className="mono xs muted">{rec.vin}</div>
                    </td>
                    <td><FleetStatus s={status} /></td>
                    <td className="num">{mi(rec.mileage)}</td>
                    <td style={{ minWidth: 130 }}>
                      <div className="num" style={{ fontWeight: 700, color: rec.pmRemainingMi < 0 ? 'var(--high)' : undefined }}>{rec.pmRemainingMi < 0 ? `Over ${mi(-rec.pmRemainingMi)}` : `${mi(rec.pmRemainingMi)}`}</div>
                      <PmBar rec={rec} />
                    </td>
                    <td className="small">
                      <div style={{ color: rec.brakeDueDays <= FLEET_RULES.inspDueSoonDays ? 'var(--med)' : undefined }}>Brakes {rec.brakeDueDays < 0 ? `overdue ${-rec.brakeDueDays}d` : `in ${rec.brakeDueDays}d`}</div>
                      <div style={{ color: rec.tireDueDays <= FLEET_RULES.inspDueSoonDays ? 'var(--med)' : undefined }}>Tires {rec.tireDueDays < 0 ? `overdue ${-rec.tireDueDays}d` : `in ${rec.tireDueDays}d`}</div>
                    </td>
                    <td className="small">{rec.faults.length ? rec.faults.map((f) => <div key={f.code} style={{ color: f.severity === 'critical' ? 'var(--high)' : 'var(--med)', fontWeight: 700 }}>{f.code}</div>) : <span className="muted">None</span>}</td>
                    <td className="num">{open.length || <span className="muted">0</span>}</td>
                    <td className="small">{rec.openWorkOrders.length ? rec.openWorkOrders.map((w) => <div key={w.id} className="mono">{w.id}</div>) : <span className="muted">None</span>}</td>
                    <td className="small" style={{ maxWidth: 260 }}>{why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="xs muted">Guardian can detect, alert, prioritize and escalate vehicle problems. Maintenance personnel make the final safety and return-to-service decision. <MonitorModeBadge compact /></p>
    </DashShell>
  );
}

export function VehicleDetail({ bus }) {
  const { go, back } = useNav();
  const state = useStore((s) => s);
  const now = useNow(10000);
  const h = vehicleHealth(bus, state, now);
  const incidents = state.guardian.incidents.filter((i) => i.vehicle === bus || (i.ticketIds || []).some((id) => state.tickets.find((t) => t.id === id)?.vehicle === bus));
  if (!h) {
    return <DashShell active="/fleet"><div className="notice notice-info">Bus {bus} isn't in the demo fleet records.</div><button className="btn" onClick={() => go('/fleet')}>Back to fleet</button></DashShell>;
  }
  const { rec, status, reasons, tickets, open, repeats } = h;
  const allReasons = ['Critical Review', 'Attention Required', 'Maintenance Due'].flatMap((s) => reasons[s].map((r) => [s, r]));

  return (
    <DashShell active="/fleet">
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => back('/fleet')}>← Fleet</button>

      <div className="panel panel-b">
        <div className="row between wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div className="display" style={{ fontSize: 40, fontWeight: 700, lineHeight: 1 }}>Bus #{rec.bus}</div>
            <div className="mono small" style={{ marginTop: 4 }}>VIN {rec.vin} <span className="tag">demo VIN</span></div>
            <div className="small muted" style={{ marginTop: 4 }}>{rec.year} · {rec.model} · {garageOf(rec.bus)} · {routeLabel(routeOf(rec.bus))}</div>
          </div>
          <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
            <span className="eyebrow">Guardian status</span>
            <FleetStatus s={status} />
          </div>
        </div>
        {allReasons.length > 0 && (
          <ul className="fs-reasons">
            {allReasons.map(([s, r], i) => <li key={i}><span className={`fs-dot ${STATUS_CLS[s]}`} />{r}</li>)}
          </ul>
        )}
      </div>

      <div className="fs-grid">
        <div className="fs-card"><div className="k">Mileage</div><div className="v num">{mi(rec.mileage)}</div><div className="xs muted">{rec.engineHours.toLocaleString()} engine hours</div></div>
        <div className="fs-card">
          <div className="k">Next PM</div>
          <div className="v num" style={{ color: rec.pmRemainingMi < 0 ? 'var(--high)' : undefined }}>{rec.pmRemainingMi < 0 ? `Over by ${mi(-rec.pmRemainingMi)}` : mi(rec.pmRemainingMi)}</div>
          <PmBar rec={rec} />
          <div className="xs muted">Due at {mi(rec.nextPmAt)} · last PM {fmtDate(rec.lastPmAt)} · every {mi(FLEET_RULES.pmIntervalMi)}</div>
        </div>
        <div className="fs-card"><div className="k">Oil / service interval</div><div className="v num">{rec.oilRemainingMi < 0 ? `Over by ${mi(-rec.oilRemainingMi)}` : `${mi(rec.oilRemainingMi)} left`}</div><div className="xs muted">Every {mi(FLEET_RULES.oilIntervalMi)}</div></div>
        <div className="fs-card"><div className="k">Brake inspection</div><div className="v" style={{ color: rec.brakeDueDays <= 7 ? 'var(--med)' : undefined }}>{rec.brakeDueDays < 0 ? `Overdue ${-rec.brakeDueDays} days` : `Due in ${rec.brakeDueDays} days`}</div><div className="xs muted">{fmtDate(rec.brakeDueAt)} · every {FLEET_RULES.brakeInspectionDays} days</div></div>
        <div className="fs-card"><div className="k">Tire inspection</div><div className="v" style={{ color: rec.tireDueDays <= 7 ? 'var(--med)' : undefined }}>{rec.tireDueDays < 0 ? `Overdue ${-rec.tireDueDays} days` : `Due in ${rec.tireDueDays} days`}</div><div className="xs muted">{fmtDate(rec.tireDueAt)} · every {FLEET_RULES.tireInspectionDays} days</div></div>
        <div className="fs-card"><div className="k">Last completed repair</div><div className="v small" style={{ fontSize: 14 }}>{rec.lastRepair?.desc || '—'}</div><div className="xs muted mono">{rec.lastRepair ? `${rec.lastRepair.wo} · ${fmtDate(rec.lastRepair.at)}` : ''}</div></div>
      </div>

      <div className="detail-grid">
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Engine / transmission / fault alerts</h2><span className="small muted">Telematics DTCs (simulated)</span></div>
            <div className="panel-b stack-sm">
              {rec.faults.length ? rec.faults.map((f) => (
                <div key={f.code} className="ev row between wrap" style={{ gap: 8 }}>
                  <span><b className="mono">{f.code}</b> · {f.system} — {f.desc}</span>
                  <span className={`pill ${f.severity === 'critical' ? 'p-high' : 'p-medium'}`}>{f.severity}</span>
                </div>
              )) : <span className="small muted">No active fault codes.</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Open repair tickets</h2><span className="tag">{open.length}</span></div>
            <div className="panel-b stack-sm">
              {open.length ? open.map((t) => (
                <button key={t.id} className="ev row between wrap" style={{ gap: 8, textAlign: 'left', cursor: 'pointer' }} onClick={() => go(`/ticket/${t.id}`)}>
                  <span><b>{t.ai.title}</b> <span className="mono xs muted">{t.id}</span>{t.workOrder && <span className="mono xs"> · {t.workOrder}</span>}</span>
                  <span className="row" style={{ gap: 6 }}><PriorityPill p={t.priority} /><StatusPill s={t.status} /></span>
                </button>
              )) : <span className="small muted">No open SMART Ops tickets.</span>}
              {tickets.length > open.length && <span className="xs muted">{tickets.length - open.length} closed or merged report(s) on file.</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Repeat defects</h2></div>
            <div className="panel-b stack-sm">
              {repeats.length ? repeats.map((a) => (
                <div key={a.id} className="alert vehicle"><div className="k">Repeat defect</div><div style={{ fontWeight: 700 }}>{a.component}: {a.detail}</div><div className="small">{a.dates.join(' · ')}</div></div>
              )) : <span className="small muted">No repeat defects in the last 30 days.</span>}
            </div>
          </section>
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Maintenance work orders</h2><span className="small muted">From maintenance system (simulated)</span></div>
            <div className="panel-b stack-sm">
              {rec.workOrders.length ? rec.workOrders.map((w) => (
                <div key={w.id} className="ev">
                  <div className="row between wrap" style={{ gap: 6 }}><b className="mono">{w.id.startsWith('WO-') ? `Work order #${w.id.slice(3)}` : `Work request ${w.id}`}</b><span className="tag">{w.status}</span></div>
                  <div className="small">{w.desc}</div>
                  <div className="xs muted">{sysLabel(w.system)} · opened {fmtDate(w.openedAt)} · {w.tech}</div>
                </div>
              )) : <span className="small muted">No open work orders.</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Guardian on this bus</h2><MonitorModeBadge compact /></div>
            <div className="panel-b stack-sm">
              {incidents.length ? incidents.map((i) => (
                <button key={i.id} className="ev" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => go('/guardian')}>
                  <div className="xs muted">{fmtDateTime(i.at)} · {i.state}</div>
                  <div style={{ fontWeight: 700 }}>{i.title}</div>
                  <div className="small">{i.stages.correct}</div>
                </button>
              )) : <span className="small muted">Guardian hasn't flagged anything on this bus.</span>}
            </div>
          </section>

          <div className="notice notice-warn small"><b>Guardian detects, alerts, prioritizes and escalates.</b> Maintenance personnel make the final safety and return-to-service decision.</div>
        </div>
      </div>
    </DashShell>
  );
}
