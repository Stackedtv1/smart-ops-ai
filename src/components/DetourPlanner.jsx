import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../services/store.js';
import { fmtTime } from '../lib/time.js';
import {
  DETOUR_TEMPLATES, planDetour, publishDetour, stopsOnRoute, terminalName, riderAlertText, vehicleOf, busesOnRoute, suggestDetour,
} from '../services/ops.js';
import OpsMap from './OpsMap.jsx';
import { DetourSummary } from './OpsWidgets.jsx';
import { Modal } from './ui.jsx';

const STEPS = ['Closure', 'Route', 'Closed section', 'Bus-safe detour', 'Publish'];

// Dispatch detour workflow: road closure → affected route → closed section →
// SMART Ops generates a bus-safe detour → Publish to everyone at once.
export default function DetourPlanner({ report = null, onClose }) {
  const tpl0 = report ? suggestDetour(report.text, report.route) : null;
  const [tplId, setTplId] = useState(tpl0?.id || null);
  const tpl = DETOUR_TEMPLATES.find((t) => t.id === tplId) || null;
  const routes = report?.affectedRoutes?.length ? report.affectedRoutes : tpl?.routes || [];
  const [route, setRoute] = useState(tpl?.routes[0] || routes[0] || null);
  const [from, setFrom] = useState(tpl?.fromStop || null);
  const [to, setTo] = useState(tpl?.rejoinStop || null);
  const [phase, setPhase] = useState(tpl ? 'segment' : 'closure');
  const [shown, setShown] = useState(0);
  const [published, setPublished] = useState(null);
  const live = useStore((s) => (published ? s.ops.detours.find((d) => d.id === published) : null));

  useEffect(() => {
    if (!tpl) return;
    setRoute(tpl.routes[0]);
    setFrom(tpl.fromStop);
    setTo(tpl.rejoinStop);
  }, [tplId]); // eslint-disable-line react-hooks/exhaustive-deps

  const stops = useMemo(() => (route ? stopsOnRoute(route) : []), [route]);
  const plan = useMemo(() => (phase === 'generate' || phase === 'review' ? planDetour({ templateId: tplId, route, fromStop: from, toStop: to }) : null), [phase, tplId, route, from, to]);

  // Checks reveal one by one, like the engine working through them.
  useEffect(() => {
    if (phase !== 'generate' || !plan) return;
    setShown(0);
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setShown(i);
      if (i >= plan.checks.length) { clearInterval(id); setTimeout(() => setPhase('review'), 350); }
    }, 320);
    return () => clearInterval(id);
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const stepIdx = { closure: 0, route: 1, segment: 2, generate: 3, review: 3, done: 4 }[phase];
  const recipients = plan ? [...new Set(plan.routes.flatMap((r) => busesOnRoute(r)))] : [];
  const terms = [...new Set(recipients.map((b) => vehicleOf(b)?.garage).filter(Boolean))];

  function publish() {
    const d = publishDetour(plan, { fromReport: report?.id || null });
    setPublished(d.id);
    setPhase('done');
  }

  const footer = phase === 'review' ? (
    <>
      <button className="btn" onClick={() => setPhase('segment')}>Change section</button>
      <button className="btn btn-primary btn-lg" onClick={publish}>Publish detour to {recipients.length} buses</button>
    </>
  ) : phase === 'done' ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <button className="btn" onClick={onClose}>Cancel</button>;

  return (
    <Modal title="Detour Planner" onClose={onClose} footer={footer} wide>
      <div className="planner-steps">
        {STEPS.map((s, i) => <span key={s} className={i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}>{i < stepIdx ? '✓ ' : ''}{s}</span>)}
      </div>

      {report && (
        <div className="notice notice-safety">
          <b>Road closure · Bus {report.bus} · {fmtTime(report.at)}</b> — “{report.text}”
          {report.affectedRoutes?.length > 0 && <div className="small" style={{ marginTop: 4 }}><b>Guardian:</b> affects Route{report.affectedRoutes.length > 1 ? 's' : ''} {report.affectedRoutes.join(', ')} · {report.affectedBuses?.length || 0} buses currently on those routes.</div>}
        </div>
      )}

      {phase === 'closure' && (
        <div className="stack-sm">
          <b>Where is the road closed?</b>
          <span className="small muted">Dispatch got a call or saw it on the camera. Pick the closure.</span>
          {DETOUR_TEMPLATES.map((t) => (
            <button key={t.id} className="btn btn-block" style={{ justifyContent: 'flex-start', textAlign: 'left' }} onClick={() => { setTplId(t.id); setPhase('route'); }}>
              {t.closure} · Routes {t.routes.join('/')}
            </button>
          ))}
        </div>
      )}

      {phase === 'route' && tpl && (
        <div className="stack-sm">
          <b>Affected route</b>
          <span className="small muted">Guardian found these routes running through the closure.</span>
          <div className="row wrap" style={{ gap: 8 }}>
            {tpl.routes.map((r) => <button key={r} className={`btn ${route === r ? 'btn-primary' : ''}`} onClick={() => setRoute(r)}>Route {r}</button>)}
          </div>
          <span className="xs muted">Routes {tpl.routes.join(' and ')} share this corridor, so one detour covers both.</span>
          <button className="btn btn-primary" onClick={() => setPhase('segment')}>Next: closed section</button>
        </div>
      )}

      {phase === 'segment' && (
        <div className="stack-sm">
          <b>Closed section of Route {route}</b>
          <div className="calc-grid">
            <div className="field"><label>Closed from</label><select className="select" value={from || ''} onChange={(e) => setFrom(e.target.value)}>{stops.map((s) => <option key={s.id} value={s.demoId || s.id}>{s.name}</option>)}</select></div>
            <div className="field"><label>To (rejoin)</label><select className="select" value={to || ''} onChange={(e) => setTo(e.target.value)}>{stops.map((s) => <option key={s.id} value={s.demoId || s.id}>{s.name}</option>)}</select></div>
          </div>
          <button className="btn btn-primary btn-lg" disabled={!from || !to || from === to} onClick={() => setPhase('generate')}>Generate bus-safe detour</button>
        </div>
      )}

      {(phase === 'generate' || phase === 'review') && plan && (
        <div className="stack">
          <div>
            <DetourSummary d={plan} />
            <OpsMap routes={plan.routes} detours={[plan]} fit={[...plan.detourPath, ...plan.closedPath]} height={260} label="Detour preview map" />
          </div>
          <div className="split2">
            <div className="stack-sm">
              <div className="eyebrow">Turn-by-turn for operators</div>
              <ol className="detour-steps light">
                {plan.steps.map((s, i) => <li key={i}><b>{s.text}</b><span>{s.at}{s.then ? ` · then ${s.then}` : ''}</span></li>)}
              </ol>
              <div className="small">Delay: +{plan.delayParts.extraMi.toFixed(1)} mi extra driving (+{plan.delayParts.extraMin} min) · 4 turns (+{plan.delayParts.turnMin} min) · temp stops vs skipped stops</div>
              <div><div className="eyebrow">Stops bypassed ({plan.bypassed.length})</div>{plan.bypassed.map((b) => <div key={b.name} className="small" style={{ color: 'var(--high)' }}>✕ {b.name}</div>)}</div>
              <div><div className="eyebrow">Temporary stops ({plan.temporary.length})</div>{plan.temporary.map((t) => <div key={t.name} className="small">▣ {t.name}</div>)}</div>
            </div>
            <div className="stack-sm">
              <div className="eyebrow">Bus-safe checks</div>
              <ul className="checks">
                {plan.checks.map((c, i) => (
                  <li key={c.label} className={i >= shown && phase === 'generate' ? 'pending' : c.ok ? '' : 'bad'}>
                    <span className="ck">{i >= shown && phase === 'generate' ? '…' : c.ok ? '✓' : '!'}</span>
                    <span><b>{c.label}</b><span>{c.detail}</span></span>
                  </li>
                ))}
                <li className="bad"><span className="ck">✕</span><span><b>{plan.rejected.label}</b><span>{plan.rejected.detail}</span></span></li>
              </ul>
              <div className="xs muted">Demo checks. Production checks every detour against SMART's pre-approved detour library plus bus/truck routing data (turn restrictions, clearances, weight limits, lane widths).</div>
            </div>
          </div>
          {phase === 'review' && (
            <div className="stack-sm">
              <div className="eyebrow">Publishing sends the same update to</div>
              <ul className="fanout">
                <li><b>{recipients.length} operators</b>Buses {recipients.join(', ')} · must acknowledge</li>
                <li><b>{terms.map(terminalName).join(', ')}</b>Terminal dashboards</li>
                <li><b>Customer Service</b>Rider script + stop list</li>
                <li><b>Command Center</b>Map + audit trail</li>
                <li><b>Rider alert (preview)</b>Phase 2: SMART's rider channels</li>
                <li><b>SMART CAD/AVL</b>Production integration</li>
              </ul>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && live && (
        <div className="stack">
          <div className="notice notice-ok"><b>Detour {live.id} published at {fmtTime(live.at)}.</b> Every screen below got the same update.</div>
          <DetourSummary d={live} />
          <ul className="fanout">
            <li className={Object.keys(live.acks).length === live.recipients.length ? 'ok' : ''}><b>Operators: {Object.keys(live.acks).length}/{live.recipients.length} acknowledged</b>{live.recipients.map((b) => `${b}${live.acks[b] ? ' ✓' : ''}`).join(' · ')}</li>
            <li className="ok"><b>{live.terminals.map(terminalName).join(', ')} ✓</b>Service alert on dashboard</li>
            <li className="ok"><b>Customer Service ✓</b>Rider script ready</li>
            <li className="ok"><b>Command Center ✓</b>Logged {fmtTime(live.at)}</li>
          </ul>
          <div><div className="eyebrow">Rider alert (preview)</div><div className="rider-alert">{riderAlertText(live)}</div></div>
        </div>
      )}
    </Modal>
  );
}
