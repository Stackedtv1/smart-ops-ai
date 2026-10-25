import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore, isOpen } from '../services/store.js';
import { startOfDay } from '../lib/time.js';
import { isMoving, activeDetourFor, unackedFor, openLostForBus, createFieldReport, operatorPosition, ackDetour } from '../services/ops.js';
import { Icon } from '../components/ui.jsx';
import { MessageCard, LostAlertCard } from '../components/OpsWidgets.jsx';
import OperatorShell from './OperatorShell.jsx';
import { speak, oneTapDispatch } from './OperatorNavigate.jsx';

function Assist({ icon, label, sub, tone, badge, onClick, live }) {
  return (
    <button className={`assist a-${tone} ${live ? 'live' : ''}`} onClick={onClick}>
      {badge > 0 && <span className="assist-badge">{badge}</span>}
      <Icon name={icon} size={34} />
      <span className="t">{label}</span>
      {sub && <span className="d">{sub}</span>}
    </button>
  );
}

// Bottom bar from the operator mockup: Home · Messages · Emergency · More.
// Emergency asks once so a stray tap never pages Dispatch.
function OperatorTabBar({ msgCount, onNote }) {
  const { go, embedded } = useNav();
  const [sheet, setSheet] = useState(null);
  const more = [
    ['clipboard', 'Pre-Trip', '/operator/pretrip'],
    ['list', 'My Reports', '/operator/reports'],
    ['restroom', 'Restroom', '/operator/relief'],
    ['bag', 'Lost item alerts', '/operator/lost'],
  ];
  return (
    <>
      <nav className="op-tabbar" aria-label="Operator">
        <button className="on" aria-current="page" onClick={() => window.scrollTo(0, 0)}><Icon name="home" size={24} />Home</button>
        <button onClick={() => go('/operator/dispatch')}><Icon name="mail" size={24} />Messages{msgCount > 0 && <span className="nav-badge">{msgCount}</span>}</button>
        <button className="emer" onClick={() => setSheet('emer')}><Icon name="phonecall" size={24} />Emergency</button>
        <button onClick={() => setSheet('more')}><Icon name="dots" size={24} />More</button>
      </nav>
      {sheet && (
        <div className="op-sheet-bg" onClick={() => setSheet(null)}>
          <div className="op-sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {sheet === 'emer' ? (
              <>
                <h3>Send emergency to Dispatch?</h3>
                <div className="small muted">Sends your bus, route and GPS location. Use the radio emergency button too if you can.</div>
                <button className="bigemer" onClick={() => { oneTapDispatch('emergency'); setSheet(null); onNote('Emergency sent to Dispatch with your GPS location.'); }}>SEND EMERGENCY</button>
                <button className="btn btn-lg" onClick={() => setSheet(null)}>Cancel</button>
              </>
            ) : (
              <>
                <h3>More</h3>
                {more.map(([icon, label, to]) => (
                  <button key={to} className="shortcut" onClick={() => { setSheet(null); go(to); }}><span className="row"><Icon name={icon} /> {label}</span><Icon name="chevron" size={18} /></button>
                ))}
                {!embedded && <button className="shortcut" onClick={() => go('/')}><span className="row"><Icon name="user" /> Switch role</span></button>}
                <button className="btn btn-lg" onClick={() => setSheet(null)}>Close</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// Full-screen takeover the moment Dispatch publishes a detour for this route.
function DetourTakeover({ detour }) {
  const { go } = useNav();
  useEffect(() => { speak(`Detour active on Route ${detour.routes[0]}. Follow navigation. Plus ${detour.delayMin} minutes.`); }, [detour.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="takeover" role="dialog" aria-modal="true" aria-label="Detour active">
      <div className="takeover-card simple">
        <div className="tk-warn">⚠ DETOUR ACTIVE</div>
        <div className="tk-main">Follow navigation</div>
        <div className="tk-sub">+{detour.delayMin} min • {detour.bypassed.length} stops bypassed</div>
        <div className="tk-why">{detour.closure}</div>
        <button className="bigack" onClick={() => { ackDetour(detour.id, OPERATOR.bus); speak('Detour acknowledged.'); go('/operator/navigate'); }}>ACKNOWLEDGE</button>
      </div>
    </div>
  );
}

export default function OperatorHome() {
  const { go } = useNav();
  const mine = useStore((s) => s.tickets.filter((t) => t.operatorId === OPERATOR.id && t.createdAt >= startOfDay()));
  const ops = useStore((s) => s.ops);
  const moving = isMoving(ops, OPERATOR.bus);
  const detour = activeDetourFor(ops, OPERATOR.route);
  const msgs = unackedFor(ops, OPERATOR.bus);
  const lost = openLostForBus(ops, OPERATOR.bus);
  const open = mine.filter(isOpen).length;
  const [note, setNote] = useState(null);
  const urgent = msgs.filter((m) => m.priority === 'high');
  const spokenMsgs = useRef(new Set());
  useEffect(() => {
    urgent.forEach((m) => { if (!spokenMsgs.current.has(m.id)) { spokenMsgs.current.add(m.id); speak(`Message from dispatch. ${m.text}`); } });
  }, [urgent.map((m) => m.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  function flagLocation() {
    const p = operatorPosition();
    const r = createFieldReport({ text: 'Location flagged while driving. Operator will add details at next stop.', bus: OPERATOR.bus, route: OPERATOR.route, by: OPERATOR.id, lat: p.lat, lng: p.lng, kind: 'other' });
    setNote(`Location flagged (${r.id}). Add details at your next stop.`);
  }

  const showTakeover = detour && !detour.acks?.[OPERATOR.bus];

  return (
    <OperatorShell footer={<OperatorTabBar msgCount={msgs.length} onNote={setNote} />}>
      <div className="row between small" style={{ fontWeight: 600 }}>
        <span>{OPERATOR.name} · <span className="mono">{OPERATOR.id}</span></span>
        <span className="muted">{OPERATOR.garage}</span>
      </div>

      {moving ? (
        <>
          <div className="moving-dock">
            <button className="nav" onClick={() => go('/operator/navigate')}><Icon name="nav" size={30} />{detour ? 'DETOUR NAVIGATION' : 'NAVIGATION'}</button>
            <button className="disp" onClick={() => { oneTapDispatch('call'); setNote('Dispatch will contact you at your next stop.'); }}><Icon name="radio" size={28} />CALL ME</button>
            <button className="emer" onClick={() => { oneTapDispatch('emergency'); setNote('Emergency sent to Dispatch with your GPS location.'); }}><Icon name="alert" size={28} />EMERGENCY</button>
            <button className="flag" onClick={flagLocation}>ONE-TAP FLAG · GPS pin, details later</button>
          </div>
          {note && <div className="notice notice-ok" role="status">{note}</div>}
          <div className="locked" style={{ padding: 14 }}>
            <div className="t" style={{ fontSize: 20 }}>Bus moving · typing and reports locked</div>
            <div className="small">Navigation, one-tap Dispatch, Emergency and voice alerts stay on. Everything unlocks when you stop.</div>
          </div>
        </>
      ) : (
        <>
          {note && <div className="notice notice-ok" role="status">{note}</div>}
          {msgs.slice(0, 2).map((m) => <MessageCard key={m.id} m={m} recipient={OPERATOR.bus} by={`Bus ${OPERATOR.bus} · ${OPERATOR.name}`} />)}
          {lost.slice(0, 1).map((l) => <LostAlertCard key={l.id} item={l} />)}

          <div className="assist-grid">
            <Assist icon="restroom" label="RESTROOM" sub="Best 3 options ahead" tone="relief" onClick={() => go('/operator/relief')} />
            <Assist icon="nav" label={detour ? 'DETOUR' : 'NAVIGATION'} sub={detour ? 'Active · follow route' : 'Route & next stops'} tone="detour" live={!!detour} onClick={() => go('/operator/navigate')} />
            <Assist icon="alert" label="REPORT ISSUE" sub="Vehicle · Road · Stop · Safety · Lost item" tone="report" badge={lost.length} onClick={() => go('/operator/report')} />
            <Assist icon="radio" label="DISPATCH" sub="Messages & requests" tone="dispatch" badge={msgs.length} onClick={() => go('/operator/dispatch')} />
          </div>

          <div className="op-stat">
            <span style={{ fontWeight: 700 }}>My Reports Today</span>
            <span className="row" style={{ gap: 10 }}>
              {open > 0 && <span className="tag">{open} open</span>}
              <span className="n num">{mine.length}</span>
            </span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="shortcut" onClick={() => go('/operator/pretrip')}><span className="row"><Icon name="clipboard" /> Pre-Trip</span></button>
            <button className="shortcut" onClick={() => go('/operator/reports')}><span className="row"><Icon name="list" /> My Reports</span></button>
          </div>
        </>
      )}

      <div className="op-stopped"><Icon name="stop" size={16} /> Reporting unlocks only when the bus is stopped.</div>
      {showTakeover && <DetourTakeover detour={detour} />}
    </OperatorShell>
  );
}
