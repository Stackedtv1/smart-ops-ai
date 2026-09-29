import { useMemo, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { recommendedAction } from '../services/ai.js';
import { useStore, assignTicket, setPriority, addNote, resolveTicket, startWork, routeTo, patternAlerts } from '../services/store.js';
import { DEPARTMENTS, deptLabel, catLabel, PRIORITIES } from '../lib/config.js';
import { routeLabel, stopById } from '../services/maps.js';
import { fmtTime, fmtDateTime, durationLabel } from '../lib/time.js';
import DashShell from '../components/DashShell.jsx';
import IssueMap from '../components/IssueMap.jsx';
import { PriorityPill, StatusPill, Modal, Icon, readPhoto } from '../components/ui.jsx';

export default function TicketDetail({ id }) {
  const { go, back } = useNav();
  const tickets = useStore((s) => s.tickets);
  const t = tickets.find((x) => x.id === id);
  const alerts = useMemo(() => patternAlerts(tickets).filter((a) => a.ticketIds.includes(id)), [tickets, id]);
  const [modal, setModal] = useState(null);

  if (!t) {
    return (
      <DashShell>
        <div className="notice notice-info">Ticket {id} was not found. It may have been cleared by a demo reset.</div>
        <button className="btn" onClick={() => go('/dashboard')}>Back to dashboard</button>
      </DashShell>
    );
  }

  const stop = stopById(t.stopId);
  const resolved = t.status === 'Resolved' || t.status === 'Merged';
  const isStop = t.ai.category === 'facilities';

  return (
    <DashShell active={`/${t.department === 'maintenance' ? 'maintenance' : t.department === 'facilities' ? 'facilities' : t.department === 'operations' ? 'dashboard' : 'safety'}`}>
      <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => back('/dashboard')}>
        <Icon name="back" size={16} /> Back
      </button>

      <div className="panel panel-b">
        <div className="ticket-head">
          <div className="stack-sm" style={{ gap: 6 }}>
            <div className="ticket-id">{t.id}</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <PriorityPill p={t.priority} />
              <span className="display" style={{ fontSize: 18, fontWeight: 700, letterSpacing: '.06em', color: `var(--${t.priority === 'high' ? 'high' : t.priority === 'medium' ? 'med' : 'low'})` }}>{t.priority.toUpperCase()} PRIORITY</span>
              <StatusPill s={t.status} />
              {t.live && <span className="tag">Reported during demo</span>}
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{t.ai.title}</h1>
          </div>
          {!resolved && (
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn" onClick={() => setModal('assign')}>Assign</button>
              <button className="btn" onClick={() => setModal('priority')}>Change Priority</button>
              <button className="btn" onClick={() => setModal('note')}>Add Note</button>
              <button className="btn btn-ok" onClick={() => setModal('resolve')}>Resolve</button>
            </div>
          )}
        </div>
        <dl className="kv kv-wide" style={{ marginTop: 16 }}>
          {isStop ? (<><dt>Stop</dt><dd>{t.stopId} · {stop?.name}</dd></>) : (<><dt>Vehicle</dt><dd className="mono">{t.vehicle}</dd></>)}
          <dt>Route</dt><dd>{routeLabel(t.route)}</dd>
          <dt>Operator</dt><dd>{t.operatorName} <span className="mono xs muted">{t.operatorId}</span></dd>
          <dt>Reported</dt><dd>{fmtDateTime(t.createdAt)}</dd>
          <dt>Location</dt><dd>{(t.location.label || '').replace(' & ', ' / ')}</dd>
          <dt>Department</dt><dd>{deptLabel(t.department)}</dd>
          <dt>Assigned</dt><dd>{t.assignee || <span style={{ color: 'var(--high)' }}>Unassigned</span>}</dd>
          <dt>Garage</dt><dd>{t.garage}</dd>
        </dl>
      </div>

      {t.status === 'Merged' && (
        <div className="notice notice-info">
          <b>Merged duplicate.</b> The AI Operations Copilot merged this report into{' '}
          <a href={`#/ticket/${t.mergedInto}`} onClick={(e) => { e.preventDefault(); go(`/ticket/${t.mergedInto}`); }}>{t.mergedInto}</a>, where the work is tracked. The report stays on file as evidence.
        </div>
      )}
      {t.linkedReports?.length > 0 && (
        <section className="panel">
          <div className="panel-h"><h2>Linked reports</h2><span className="small muted">Duplicates merged by Copilot</span></div>
          <div className="panel-b stack-sm">
            {t.linkedReports.map((r) => (
              <div key={r.id} className="ev row between wrap" style={{ gap: 8 }}>
                <span className="small">“{r.text}” <span className="muted">— {r.by}, {fmtTime(r.at)}</span></span>
                <a className="mono xs" href={`#/ticket/${r.id}`} onClick={(e) => { e.preventDefault(); go(`/ticket/${r.id}`); }}>{r.id}</a>
              </div>
            ))}
          </div>
        </section>
      )}
      {alerts.map((a) => (
        <div key={a.id} className={`alert ${a.kind}`}>
          <div className="k">{a.kind === 'vehicle' ? 'AI Pattern Alert' : 'Repeat Location Alert'}</div>
          <div style={{ fontWeight: 700 }}>{a.title}: {a.detail} ({a.dates.join(', ')}). Recommendation: {a.recommendation}.</div>
        </div>
      ))}

      <div className="detail-grid">
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Original Operator Report</h2><span className="tag">{t.inputMode === 'typed' ? 'Typed' : t.inputMode === 'pretrip' ? 'Pre-trip checklist' : 'Voice'}</span></div>
            <div className="panel-b"><blockquote className="quote">“{t.originalText}”</blockquote></div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>AI Structured Report</h2><span className="small muted">Confidence {Math.round((t.ai.confidence || 0.9) * 100)}%</span></div>
            <div className="panel-b stack">
              <dl className="kv">
                <dt>Category</dt><dd>{catLabel(t.ai.category)}</dd>
                <dt>System</dt><dd>{t.ai.component}</dd>
                <dt>Condition</dt><dd>{t.ai.condition || t.ai.issue}</dd>
                <dt>Operational concern</dt><dd>{t.ai.safety_review_required ? 'Requires review' : 'Routine'}</dd>
                <dt>Destination</dt><dd>{deptLabel(t.department)}</dd>
                <dt>Summary</dt><dd style={{ fontWeight: 500 }}>{t.ai.summary}</dd>
                <dt>Recommended action</dt><dd>{recommendedAction({ ...t.ai, priority: t.priority })}</dd>
              </dl>
              {t.ai.safety_review_required && (
                <div className="notice notice-warn"><b>{t.ai.category === 'safety' ? 'Supervisor' : isStop ? 'Facilities' : 'Supervisor / Maintenance'} Review Required.</b> {t.ai.category === 'safety' ? 'AI does not replace emergency procedures; existing SMART safety procedures apply.' : 'The AI does not decide whether a bus is safe to operate.'}</div>
              )}
              <details>
                <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>AI JSON output</summary>
                <pre className="json" style={{ marginTop: 8 }}>{JSON.stringify(t.aiJson, null, 2)}</pre>
              </details>
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Evidence</h2></div>
            <div className="panel-b stack">
              {t.photo ? (
                <div className="ev-photo"><img src={t.photo} alt="Operator evidence photo" /></div>
              ) : (
                <div className="notice notice-info">No photo attached to this report.</div>
              )}
              <div className="evidence">
                <div className="ev"><div className="k">Photo</div><div className="v">{t.photo ? 'Attached ✓' : 'None'}</div></div>
                <div className="ev"><div className="k">Voice recording</div><div className="v">{t.hasVoice ? 'Transcript on file' : 'Typed report'}</div></div>
                <div className="ev"><div className="k">GPS</div><div className="v mono" style={{ fontSize: 12.5 }}>{t.location.lat?.toFixed(4)}, {t.location.lng?.toFixed(4)}</div></div>
                <div className="ev"><div className="k">Timestamp</div><div className="v">{fmtDateTime(t.createdAt)}</div></div>
              </div>
            </div>
          </section>

          {t.resolution && (
            <section className="panel">
              <div className="panel-h"><h2>Resolution</h2><span className="small muted">{durationLabel(t.resolution.at - t.createdAt)} to resolve</span></div>
              <div className="panel-b stack">
                <p>{t.resolution.note}</p>
                <div className="small muted">By {t.resolution.by} at {fmtTime(t.resolution.at)}</div>
                {t.resolution.photo && <div className="ev-photo"><img src={t.resolution.photo} alt="Repair photo" /></div>}
              </div>
            </section>
          )}
        </div>

        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Status Timeline</h2></div>
            <div className="panel-b">
              <ol className="timeline">
                {t.timeline.map((e, i) => (
                  <li key={i} className={i === t.timeline.length - 1 ? 'last' : ''}>
                    <span className="tt">{fmtTime(e.at)}</span>
                    <span className="tdot" />
                    <span><span className="tl">{e.label}</span>{e.by && <div className="tb">{e.by}</div>}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Notes</h2><button className="btn btn-sm" onClick={() => setModal('note')}>Add Note</button></div>
            <div className="panel-b stack-sm">
              {t.notes.length ? t.notes.map((n, i) => (
                <div key={i} className="ev"><div className="small">{n.text}</div><div className="xs muted">{n.by} · {fmtTime(n.at)}</div></div>
              )) : <span className="small muted">No notes yet.</span>}
            </div>
          </section>

          <section className="panel">
            <div className="panel-h"><h2>Location</h2></div>
            <IssueMap tickets={[t]} height={260} focus={t.location} />
          </section>

          {!resolved && t.status !== 'In Progress' && (
            <button className="btn btn-block" onClick={() => startWork(t.id)}>Mark In Progress</button>
          )}
          {!resolved && (
            <div className="row wrap small muted">
              Reroute:
              {Object.keys(DEPARTMENTS).filter((d) => d !== t.department && d !== 'safety').map((d) => (
                <button key={d} className="btn btn-sm" onClick={() => routeTo(t.id, d)}>{deptLabel(d)}</button>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === 'assign' && <AssignModal t={t} onClose={() => setModal(null)} />}
      {modal === 'priority' && <PriorityModal t={t} onClose={() => setModal(null)} />}
      {modal === 'note' && <NoteModal t={t} onClose={() => setModal(null)} />}
      {modal === 'resolve' && <ResolveModal t={t} onClose={() => setModal(null)} />}
    </DashShell>
  );
}

function AssignModal({ t, onClose }) {
  const crews = DEPARTMENTS[t.department]?.crews || [];
  const [who, setWho] = useState(t.assignee || crews[0]);
  return (
    <Modal title="Assign ticket" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => { assignTicket(t.id, who); onClose(); }}>Assign</button></>}>
      <div className="field">
        <label htmlFor="assignee">{deptLabel(t.department)} crew</label>
        <select id="assignee" className="select" value={who} onChange={(e) => setWho(e.target.value)}>
          {crews.map((c) => <option key={c}>{c}</option>)}
        </select>
      </div>
    </Modal>
  );
}

function PriorityModal({ t, onClose }) {
  const [p, setP] = useState(t.priority);
  return (
    <Modal title="Change priority" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => { if (p !== t.priority) setPriority(t.id, p); onClose(); }}>Save</button></>}>
      <div className="row wrap">
        {PRIORITIES.map((x) => (
          <button key={x} className={`btn ${p === x ? 'btn-primary' : ''}`} onClick={() => setP(x)} aria-pressed={p === x}>{x.toUpperCase()}</button>
        ))}
      </div>
      <p className="small muted">The AI's suggested priority is kept in the ticket history.</p>
    </Modal>
  );
}

function NoteModal({ t, onClose }) {
  const [text, setText] = useState('');
  return (
    <Modal title="Add note" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={!text.trim()} onClick={() => { addNote(t.id, text.trim()); onClose(); }}>Add Note</button></>}>
      <div className="field">
        <label htmlFor="note-text">Note</label>
        <textarea id="note-text" className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Spare bus 4611 staged at Oakland Terminal." autoFocus />
      </div>
    </Modal>
  );
}

export function suggestedResolution(t) {
  const s = t.ai.subcategory || '';
  if (s === 'passenger_door') return 'Rear door actuator inspected and adjusted. Door operating normally.';
  if (s.includes('broken_glass')) return 'Broken panel removed, area swept, replacement glass ordered.';
  if (s.includes('trash')) return 'Receptacle emptied and area cleaned.';
  if (s === 'warning_indicator') return 'Codes read and cleared; no active fault. Monitoring.';
  if (t.ai.category === 'safety') return 'Supervisor met bus, situation de-escalated. No injuries reported.';
  return '';
}

export function ResolveModal({ t, onClose, by }) {
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState(null);
  const fileRef = useRef(null);
  const suggestion = suggestedResolution(t);
  return (
    <Modal
      title="Resolve ticket"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-ok" disabled={!note.trim()} onClick={() => { resolveTicket(t.id, note.trim(), photo, by); onClose(); }}>Resolve</button></>}
    >
      <div className="field">
        <label htmlFor="res-note">Resolution note (required)</label>
        <textarea id="res-note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Describe what was found and done." autoFocus />
      </div>
      {suggestion && !note && (
        <button className="chip" style={{ alignSelf: 'flex-start' }} onClick={() => setNote(suggestion)}>Use: “{suggestion}”</button>
      )}
      {photo ? (
        <div className="photo-thumb"><img src={photo} alt="Repair" /><div className="grow" style={{ fontWeight: 700, color: 'var(--ok)' }}>Repair photo attached ✓</div><button className="btn btn-sm" onClick={() => setPhoto(null)}>Remove</button></div>
      ) : (
        <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="camera" size={18} /> Attach Repair Photo (optional)</button>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await readPhoto(f)); e.target.value = ''; }} />
    </Modal>
  );
}
