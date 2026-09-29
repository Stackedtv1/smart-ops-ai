import { useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore } from '../services/store.js';
import { GTFS_META } from '../services/maps.js';
import { fmtTime, ago } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { Icon, MonitorModeBadge } from '../components/ui.jsx';
import { runBrakeScenario, sweep, undoEntry, DEVICES, THRESHOLDS, SWEEP_MS } from '../services/guardian.js';

const KIND = {
  'auto-fix': { label: 'Auto-corrected', cls: 'k-fix' },
  escalation: { label: 'Escalated', cls: 'k-esc' },
  flag: { label: 'Flagged', cls: 'k-flag' },
  data: { label: 'Data / system', cls: 'k-data' },
  'follow-up': { label: 'Follow-up', cls: 'k-fix' },
  undo: { label: 'Undone', cls: 'k-data' },
};


function Stage({ n, label, text, on }) {
  return (
    <li className={`cp-stage ${on ? 'on' : ''}`}>
      <span className="cp-n">{n}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="eyebrow" style={{ color: on ? 'var(--ink)' : undefined }}>{label}</span>
        <span className="small" style={{ display: 'block' }}>{text}</span>
      </span>
    </li>
  );
}

function IncidentCard({ i }) {
  const { go } = useNav();
  const k = KIND[i.kind] || KIND.flag;
  const done = /Acknowledged|Auto-corrected|Undone/.test(i.state);
  return (
    <article className={`cp-card ${i.severity === 'high' ? 'sev-high' : ''}`}>
      <div className="row between wrap" style={{ gap: 8 }}>
        <span className={`cp-kind ${k.cls}`}>{k.label}</span>
        <span className="xs muted mono">{fmtTime(i.at)}</span>
      </div>
      <h3 className="cp-title">{i.title}</h3>
      <ol className="cp-stages">
        <Stage n="1" label="Detect" text={i.stages.detect} on />
        <Stage n="2" label="Diagnose" text={i.stages.diagnose} on />
        <Stage n="3" label={i.kind === 'escalation' || i.kind === 'data' || i.kind === 'flag' ? 'Route / escalate' : 'Correct workflow'} text={i.stages.correct} on />
        <Stage n="4" label="Follow up" text={i.stages.followUp} on={i.stages.followUp !== 'No follow-up needed.'} />
      </ol>
      <div className="row between wrap" style={{ gap: 8, marginTop: 8 }}>
        <span className={`cp-state ${done ? 'ok' : ''}`}>{i.state}</span>
        <span className="row wrap" style={{ gap: 6 }}>
          {i.humanRequired && <span className="tag">Human confirmation required</span>}
          {i.ticketIds?.[0] && <button className="btn btn-sm" onClick={() => go(`/ticket/${i.ticketIds[0]}`)}>Open {i.ticketIds[0]}</button>}
        </span>
      </div>
    </article>
  );
}

export default function Guardian() {
  const { go } = useNav();
  const c = useStore((s) => s.guardian);
  const now = useNow(1000);
  const [filter, setFilter] = useState('all');
  const [ran, setRan] = useState(false);

  const fixes = c.audit.filter((a) => a.kind === 'auto-fix' && !a.undone).length;
  const openEsc = c.followups.filter((f) => !f.closed).length;
  const offline = DEVICES.filter((d) => now - d.seen >= THRESHOLDS.deviceOfflineMin * 60000).length;
  const nextIn = c.lastSweep ? Math.max(0, Math.ceil((c.lastSweep + SWEEP_MS - now) / 1000)) : null;
  const incidents = c.incidents.filter((i) => filter === 'all' || (filter === 'human' ? i.humanRequired : i.kind === filter));

  return (
    <DashShell active="/guardian">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="row wrap" style={{ gap: 12 }}>
            <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>SMART Ops AI Guardian</h1>
            <MonitorModeBadge />
          </div>
          <div className="small muted"><b>Guardian watches. Copilot answers.</b> Guardian monitors tickets, feeds and devices, fixes workflow problems itself, and sends vehicle and safety decisions to people.</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => sweep()}>Run check now</button>
          <button className="btn btn-primary" disabled={ran} onClick={() => { runBrakeScenario(); setRan(true); }}>
            {ran ? 'Scenario running…' : 'Live scenario: Bus 4721 brake warning'}
          </button>
        </div>
      </div>

      <div className="cp-status">
        <span className="row" style={{ gap: 8 }}><span className="live-dot" /><b>Guardian active</b></span>
        <span>Last check {c.lastSweep ? ago(c.lastSweep, now) : 'starting…'}{nextIn != null ? ` · next in ${nextIn}s` : ''}</span>
        <span><b className="num">{c.sweeps || 0}</b> sweeps · <b className="num">{(c.checks || 0).toLocaleString()}</b> checks</span>
        <span><b className="num">{fixes}</b> auto-fixes</span>
        <span><b className="num">{openEsc}</b> escalation{openEsc === 1 ? '' : 's'} awaiting a person</span>
        <span>{GTFS_META.live ? `GTFS ${GTFS_META.feedVersion} ✓` : 'GTFS fallback'}</span>
        <span>{DEVICES.length - offline}/{DEVICES.length} tablets online</span>
      </div>

      <div className="cp-grid">
        <section className="panel">
          <div className="panel-h" style={{ flexWrap: 'wrap' }}>
            <h2>Detections</h2>
            <div className="filters">
              {[['all', 'All'], ['auto-fix', 'Auto-corrected'], ['escalation', 'Escalated'], ['human', 'Needs a person'], ['data', 'Data / devices']].map(([k, l]) => (
                <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
              ))}
            </div>
          </div>
          <div className="panel-b stack" style={{ gap: 12 }}>
            {incidents.length ? incidents.map((i) => <IncidentCard key={i.id} i={i} />) : <div className="muted">Nothing detected yet. The first check runs a moment after the app opens.</div>}
          </div>
        </section>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel panel-b stack-sm">
            <div className="row between wrap" style={{ gap: 8 }}>
              <h2 style={{ fontSize: 15, fontWeight: 800 }}>Need an answer instead?</h2>
              <button className="btn btn-primary btn-sm" onClick={() => go('/copilot')}>Ask Copilot →</button>
            </div>
            <p className="small muted">SMART Ops AI Copilot is the assistant staff talk to. It answers from live tickets and from everything Guardian has detected and changed.</p>
          </section>
          <section className="panel">
            <div className="panel-h"><h2>Guardrails</h2><span className="small muted">Enforced in code</span></div>
            <div className="panel-b guard-grid">
              <div>
                <div className="eyebrow" style={{ color: 'var(--ok)' }}>Guardian fixes on its own</div>
                <ul className="guard-list">
                  <li>Merge duplicate reports</li>
                  <li>Reroute misfiled tickets</li>
                  <li>Assign unowned work</li>
                  <li>Fill missing fields from system records</li>
                  <li>Raise priority, notify, escalate</li>
                </ul>
              </div>
              <div>
                <div className="eyebrow" style={{ color: 'var(--high)' }}>Always needs a qualified person</div>
                <ul className="guard-list">
                  <li>Declaring a bus repaired or safe to operate</li>
                  <li>Closing any vehicle or safety ticket</li>
                  <li>Lowering priority on vehicle or safety work</li>
                  <li>Emergency response (SMART procedures apply)</li>
                </ul>
              </div>
            </div>
            <div className="panel-b xs muted" style={{ paddingTop: 0 }}>
              Thresholds: safety acknowledgement {THRESHOLDS.safetyAckMin} min · high-priority start {THRESHOLDS.highStartMin} min · unassigned {THRESHOLDS.newAssignMin} min · duplicates within {THRESHOLDS.duplicateWindowHrs} h · follow-up {THRESHOLDS.followUpMin} min (accelerated for the demo).
            </div>
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-h"><h2>Audit trail</h2><span className="small muted">Every change: what, why, who was told</span></div>
        <div className="table-wrap">
          <table className="table" style={{ minWidth: 900 }}>
            <thead><tr><th>Time</th><th>Action</th><th>Why</th><th>Changes</th><th>Notified</th><th /></tr></thead>
            <tbody>
              {c.audit.map((e) => (
                <tr key={e.id} style={{ cursor: e.ticketIds?.[0] ? 'pointer' : 'default', opacity: e.undone ? 0.55 : 1 }} onClick={() => e.ticketIds?.[0] && go(`/ticket/${e.ticketIds[0]}`)}>
                  <td className="mono xs" style={{ whiteSpace: 'nowrap' }}>{fmtTime(e.at)}</td>
                  <td style={{ minWidth: 200 }}>
                    <span className={`cp-kind ${(KIND[e.kind] || KIND.flag).cls}`}>{(KIND[e.kind] || KIND.flag).label}</span>
                    <div style={{ fontWeight: 600, marginTop: 4 }}>{e.title}</div>
                  </td>
                  <td className="small muted" style={{ maxWidth: 320 }}>{e.why}</td>
                  <td className="xs mono">{e.changes?.length ? e.changes.map((x, i) => <div key={i}>{x}</div>) : <span className="muted">—</span>}</td>
                  <td className="small">{e.notified?.length ? e.notified.join(', ') : <span className="muted">—</span>}</td>
                  <td onClick={(ev) => ev.stopPropagation()}>
                    {e.undo && !e.undone && <button className="btn btn-sm" onClick={() => undoEntry(e.id)}>Undo</button>}
                    {e.undone && <span className="xs muted">Undone</span>}
                  </td>
                </tr>
              ))}
              {!c.audit.length && <tr><td colSpan={6} className="muted center">No actions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </DashShell>
  );
}
