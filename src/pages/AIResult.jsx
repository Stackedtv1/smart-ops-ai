import { useEffect, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { getDraft, createTicket } from '../services/store.js';
import { classifyReport, resolveLocation, recommendedAction } from '../services/ai.js';
import { catLabel, deptLabel } from '../lib/config.js';
import { routeLabel, stopById, stopRoutesLabel } from '../services/maps.js';
import { sleep } from '../lib/time.js';
import { Icon } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

const STEPS = ['Reading operator report', 'Extracting vehicle & location', 'Classifying issue', 'Assessing priority', 'Selecting department'];

function run(draft) {
  if (!draft.promise) {
    draft.promise = (async () => {
      const [ai] = await Promise.all([classifyReport(draft), sleep(2600)]);
      const location = resolveLocation(draft.text, draft.position);
      return createTicket({ ...draft, ai, location });
    })();
  }
  return draft.promise;
}

export default function AIResult({ id }) {
  const { go } = useNav();
  const draft = getDraft(id);
  const [step, setStep] = useState(0);
  const [ticket, setTicket] = useState(null);
  const [stage, setStage] = useState('analyzing');
  const [showJson, setShowJson] = useState(false);

  useEffect(() => {
    if (!draft) return;
    let alive = true;
    const iv = setInterval(() => setStep((s) => Math.min(STEPS.length, s + 1)), 480);
    run(draft).then((t) => {
      if (!alive) return;
      clearInterval(iv);
      setStep(STEPS.length);
      setTicket(t);
      setStage('classified');
      setTimeout(() => alive && setStage('created'), 1300);
    });
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) {
    return (
      <OperatorShell back="/operator" title="Report">
        <div className="notice notice-info">This report session has expired. Start a new report from the home screen.</div>
        <button className="btn btn-primary btn-lg" onClick={() => go('/operator')}>Back to Home</button>
      </OperatorShell>
    );
  }

  if (stage === 'analyzing' || !ticket) {
    return (
      <OperatorShell title="Processing">
        <div className="analyzing">
          <div className="scanner"><Icon name="sparkle" size={36} /></div>
          <h2>SMART OPS AI IS ANALYZING REPORT…</h2>
          <ul className="steps">
            {STEPS.map((s, i) => (
              <li key={s} className={i < step ? 'done' : i === step ? 'active' : ''}>
                <span className="dot">{i < step ? '✓' : ''}</span>
                {s}
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ maxWidth: 320 }}>“{draft.text}”</p>
        </div>
      </OperatorShell>
    );
  }

  const ai = ticket.ai;
  const stop = stopById(ticket.stopId);
  const locLabel = (stop?.name || ticket.location.label || '').replace(' & ', ' / ');
  const rows = [
    ['Category', catLabel(ai.category)],
    [ai.category === 'facilities' ? 'Subcategory' : 'Component', ai.category === 'facilities' ? ai.subcategoryLabel || ai.title : ai.component],
    ['Issue', ai.issue],
    ['Priority', <span key="p" className={`pill p-${ticket.priority}`}>{ticket.priority}</span>],
    ['Safety Impact', ai.safety_review_required ? 'Possible' : 'None identified'],
    ['Recommended Routing', deptLabel(ticket.department)],
    ...(ai.category === 'facilities'
      ? [['Stop', stop?.name || ticket.location.label], ['Route', stop ? stopRoutesLabel(stop) : routeLabel(ticket.route)]]
      : [['Bus', ticket.vehicle], ['Route', routeLabel(ticket.route)]]),
    ['Location', ai.category === 'facilities' ? `GPS captured · ${ticket.location.source}` : locLabel],
    ['Photo', ticket.photo ? 'Attached ✓' : 'None'],
  ];

  return (
    <OperatorShell title="AI Classification">
      <div className="ai-card">
        <div className="hd">
          <span className="display">AI CLASSIFICATION</span>
          <span className="xs" style={{ color: 'var(--bar-muted)' }}>Confidence {Math.round((ai.confidence || 0.9) * 100)}%</span>
        </div>
        <div className="ai-rows">
          {rows.map(([k, v]) => (
            <FragmentRow key={k} k={k} v={v} />
          ))}
        </div>
      </div>

      <div className="rec"><b style={{ flex: 'none' }}>Recommended action</b><span>{ai.recommended_action || recommendedAction(ai)}</span></div>

      {ai.safety_review_required && ai.category !== 'safety' && (
        <div className="notice notice-warn"><b>{ai.category === 'facilities' ? 'Facilities' : 'Supervisor / Maintenance'} Review Required.</b> SMART Ops AI flags concerns; it does not decide whether a bus is safe to operate.</div>
      )}
      {ai.category === 'safety' && (
        <div className="notice notice-safety"><b>AI does not replace emergency procedures.</b> Operator should follow existing SMART safety procedures. A supervisor has been notified.</div>
      )}

      <div className="routing">
        <Icon name="sparkle" />
        <div className="grow">
          <div className="eyebrow" style={{ color: 'var(--ink)' }}>Routing to {deptLabel(ticket.department)}</div>
          <div className="bar" style={{ marginTop: 6 }}><i /></div>
        </div>
      </div>

      {stage === 'created' && (
        <div className="created" role="status">
          <Icon name="check" size={34} stroke={3} />
          <div className="display">{ai.category === 'facilities' ? 'Facilities Ticket Created' : 'Ticket Created'}</div>
          <div className="mono" style={{ fontSize: 17, fontWeight: 600 }}>#{ticket.id}</div>
          <div className="small" style={{ opacity: 0.9, marginTop: 4 }}>Now visible on the command dashboard</div>
        </div>
      )}

      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setShowJson((s) => !s)}>
        {showJson ? 'Hide' : 'View'} AI JSON output
      </button>
      {showJson && <pre className="json">{JSON.stringify(ticket.aiJson, null, 2)}</pre>}
      <div className="xs muted">Engine: {ai.engine === 'demo' ? 'on-device demo classifier (no external API)' : ai.engine}</div>

      <div className="row" style={{ gap: 10 }}>
        <button className="btn btn-lg grow" onClick={() => go('/operator')}>Home</button>
        <button className="btn btn-primary btn-lg grow" onClick={() => go('/operator/reports')}>My Reports</button>
      </div>
    </OperatorShell>
  );
}

function FragmentRow({ k, v }) {
  return (
    <>
      <div>{k}</div>
      <div>{v}</div>
    </>
  );
}
