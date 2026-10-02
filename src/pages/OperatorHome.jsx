import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore, isOpen } from '../services/store.js';
import { startOfDay } from '../lib/time.js';
import { isMoving, activeDetourFor, unackedFor, openLostForBus, createFieldReport, operatorPosition } from '../services/ops.js';
import { Icon } from '../components/ui.jsx';
import { DetourBanner, MessageCard, LostAlertCard } from '../components/OpsWidgets.jsx';
import OperatorShell from './OperatorShell.jsx';
import { useState } from 'react';

function Assist({ icon, label, sub, tone, badge, onClick }) {
  return (
    <button className={`assist a-${tone}`} onClick={onClick}>
      {badge > 0 && <span className="assist-badge">{badge}</span>}
      <Icon name={icon} size={34} />
      <span className="t">{label}</span>
      {sub && <span className="d">{sub}</span>}
    </button>
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
  const [flagged, setFlagged] = useState(null);

  function flagLocation() {
    const p = operatorPosition();
    const r = createFieldReport({ text: 'Location flagged while driving. Operator will add details at next stop.', bus: OPERATOR.bus, route: OPERATOR.route, by: OPERATOR.id, lat: p.lat, lng: p.lng, kind: 'other' });
    setFlagged(r.id);
  }

  return (
    <OperatorShell>
      <div className="row between small" style={{ fontWeight: 600 }}>
        <span>{OPERATOR.name} · <span className="mono">{OPERATOR.id}</span></span>
        <span className="muted">{OPERATOR.garage}</span>
      </div>

      <DetourBanner detour={detour} compact={moving} onMap={moving ? null : () => go('/operator/navigate')} />

      {moving ? (
        <>
          <div className="locked">
            <Icon name="stop" size={30} />
            <div className="t">Bus moving · screens locked</div>
            <div>Driver Assist opens when you stop or reach layover.</div>
          </div>
          <button className="bigbtn v-safety" onClick={flagLocation}>
            <span className="ico"><Icon name="flag" size={30} /></span>
            <span><span className="t">ONE-TAP FLAG</span><span className="d" style={{ display: 'block' }}>Drops a GPS pin. Add details at your next stop.</span></span>
          </button>
          {flagged && <div className="notice notice-ok">Location flagged ({flagged}). Dispatch can see it now.</div>}
        </>
      ) : (
        <>
          {msgs.slice(0, 2).map((m) => <MessageCard key={m.id} m={m} recipient={OPERATOR.bus} by={`Bus ${OPERATOR.bus} · ${OPERATOR.name}`} />)}
          {lost.slice(0, 1).map((l) => <LostAlertCard key={l.id} item={l} />)}

          <div className="eyebrow" style={{ marginBottom: -6 }}>Driver Assist</div>
          <div className="assist-grid">
            <Assist icon="restroom" label="RESTROOM" sub="Approved relief points" tone="relief" onClick={() => go('/operator/relief')} />
            <Assist icon="bag" label="LOST ITEM" sub="Found something / alerts" tone="lost" badge={lost.length} onClick={() => go('/operator/lost')} />
            <Assist icon="bus" label="VEHICLE ISSUE" sub="Doors, brakes, lamps" tone="vehicle" onClick={() => go('/operator/report/vehicle')} />
            <Assist icon="radio" label="DISPATCH" sub="Messages & requests" tone="dispatch" badge={msgs.length} onClick={() => go('/operator/dispatch')} />
          </div>

          <div className="assist-row">
            <button className="shortcut strong" onClick={() => go('/operator/navigate')}>
              <span className="row"><Icon name="nav" /> Navigation{detour ? ' · detour' : ''}</span>
              <Icon name="chevron" size={18} />
            </button>
            <button className="shortcut strong" onClick={() => go('/operator/field')}>
              <span className="row"><Icon name="cone" /> Road / Hazard / Location</span>
              <Icon name="chevron" size={18} />
            </button>
          </div>

          <button className="bigbtn v-stop slim" onClick={() => go('/operator/report/stop')}>
            <span className="ico"><Icon name="shelter" size={26} /></span>
            <span><span className="t">STOP / SHELTER ISSUE</span><span className="d" style={{ display: 'block' }}>Glass, trash, lighting, signs, graffiti</span></span>
          </button>
          <button className="bigbtn v-safety slim" onClick={() => go('/operator/report/safety')}>
            <span className="ico"><Icon name="shield" size={26} /></span>
            <span><span className="t">SAFETY / INCIDENT</span><span className="d" style={{ display: 'block' }}>Passenger conduct, hazards, security</span></span>
          </button>

          <div className="op-stat">
            <span style={{ fontWeight: 700 }}>My Reports Today</span>
            <span className="row" style={{ gap: 10 }}>
              {open > 0 && <span className="tag">{open} open</span>}
              <span className="n num">{mine.length}</span>
            </span>
          </div>

          <div className="stack-sm">
            <button className="shortcut" onClick={() => go('/operator/pretrip')}>
              <span className="row"><Icon name="clipboard" /> Pre-Trip Inspection</span>
              <Icon name="chevron" size={18} />
            </button>
            <button className="shortcut" onClick={() => go('/operator/reports')}>
              <span className="row"><Icon name="list" /> View Open Reports</span>
              <Icon name="chevron" size={18} />
            </button>
          </div>
        </>
      )}

      <div className="op-stopped"><Icon name="stop" size={16} /> Report only while stopped or at layover. Never use the device while driving.</div>
    </OperatorShell>
  );
}
