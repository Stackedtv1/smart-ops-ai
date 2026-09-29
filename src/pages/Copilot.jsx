import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useStore } from '../services/store.js';
import { CONFIG } from '../lib/config.js';
import { GTFS_META } from '../services/maps.js';
import { fmtTime, ago } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { Icon } from '../components/ui.jsx';
import { answerLocal, snapshotForAI, runBrakeScenario, sweep, undoEntry, DEVICES, THRESHOLDS, SWEEP_MS } from '../services/copilot.js';

const KIND = {
  'auto-fix': { label: 'Auto-corrected', cls: 'k-fix' },
  escalation: { label: 'Escalated', cls: 'k-esc' },
  flag: { label: 'Flagged', cls: 'k-flag' },
  data: { label: 'Data / system', cls: 'k-data' },
  'follow-up': { label: 'Follow-up', cls: 'k-fix' },
  undo: { label: 'Undone', cls: 'k-data' },
};

const SUGGESTED = [
  'What are our biggest unresolved issues right now?',
  'Which buses have repeat defects?',
  "What's stalled or overdue?",
  'What did you change today?',
  'Any offline devices or data problems?',
];

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

function AskCopilot() {
  const { go } = useNav();
  const [msgs, setMsgs] = useState([{ role: 'ai', text: 'I watch every ticket, feed and device around the clock. Ask me about open issues, repeat defects, stalled work, or what I changed.' }]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [msgs]);

  async function ask(question) {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'me', text }]);
    setBusy(true);
    let reply = null;
    if (CONFIG.aiMode !== 'offline') {
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 9000);
        const res = await fetch(`${CONFIG.functionsBase}/ask-copilot`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text, snapshot: snapshotForAI() }), signal: ctl.signal,
        });
        clearTimeout(tm);
        if (res.ok) {
          const d = await res.json();
          if (d.answer) reply = { text: d.answer, items: (d.ticket_ids || []).map((id) => ({ ticketId: id, label: id })) };
        }
      } catch { /* fall back to local answer */ }
    }
    if (!reply) {
      await new Promise((r) => setTimeout(r, 450));
      reply = answerLocal(text);
    }
    setMsgs((m) => [...m, { role: 'ai', ...reply }]);
    setBusy(false);
  }

  return (
    <section className="panel cp-chat">
      <div className="panel-h"><h2>Ask Copilot</h2><span className="small muted">Answers from live ticket data</span></div>
      <div className="cp-msgs" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`cp-msg ${m.role}`}>
            <div>{m.text}</div>
            {m.items?.length > 0 && (
              <ul className="cp-items">
                {m.items.map((it, j) => (
                  <li key={j}>
                    {it.ticketId ? <a href={`#/ticket/${it.ticketId}`} onClick={(e) => { e.preventDefault(); go(`/ticket/${it.ticketId}`); }}>{it.label}</a> : it.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="cp-msg ai muted">Checking live data…</div>}
        <div ref={endRef} />
      </div>
      <div className="panel-b stack-sm" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="script-chips">
          {SUGGESTED.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input id="copilot-q" className="input grow" placeholder="e.g. Which buses have repeat defects?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask Copilot" />
          <button className="btn btn-primary" disabled={!q.trim() || busy}>Ask</button>
        </form>
      </div>
    </section>
  );
}

export default function Copilot() {
  const { go } = useNav();
  const c = useStore((s) => s.copilot);
  const now = useNow(1000);
  const [filter, setFilter] = useState('all');
  const [ran, setRan] = useState(false);

  const fixes = c.audit.filter((a) => a.kind === 'auto-fix' && !a.undone).length;
  const openEsc = c.followups.filter((f) => !f.closed).length;
  const offline = DEVICES.filter((d) => now - d.seen >= THRESHOLDS.deviceOfflineMin * 60000).length;
  const nextIn = c.lastSweep ? Math.max(0, Math.ceil((c.lastSweep + SWEEP_MS - now) / 1000)) : null;
  const incidents = c.incidents.filter((i) => filter === 'all' || (filter === 'human' ? i.humanRequired : i.kind === filter));

  return (
    <DashShell active="/copilot">
      <div className="row between wrap" style={{ alignItems: 'flex-end' }}>
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>AI Operations Copilot</h1>
          <div className="small muted">Watches tickets, feeds and devices 24/7. Fixes workflow problems itself; sends vehicle and safety decisions to people.</div>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn" onClick={() => sweep()}>Run check now</button>
          <button className="btn btn-primary" disabled={ran} onClick={() => { runBrakeScenario(); setRan(true); }}>
            {ran ? 'Scenario running…' : 'Live scenario: Bus 4721 brake warning'}
          </button>
        </div>
      </div>

      <div className="cp-status">
        <span className="row" style={{ gap: 8 }}><span className="live-dot" /><b>Copilot active</b></span>
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
          <AskCopilot />
          <section className="panel">
            <div className="panel-h"><h2>Guardrails</h2><span className="small muted">Enforced in code</span></div>
            <div className="panel-b guard-grid">
              <div>
                <div className="eyebrow" style={{ color: 'var(--ok)' }}>Copilot fixes on its own</div>
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
