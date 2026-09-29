import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore, isOpen } from '../services/store.js';
import { startOfDay } from '../lib/time.js';
import { Icon } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

export default function OperatorHome() {
  const { go } = useNav();
  const mine = useStore((s) => s.tickets.filter((t) => t.operatorId === OPERATOR.id && t.createdAt >= startOfDay()));
  const open = mine.filter(isOpen).length;

  return (
    <OperatorShell>
      <div className="row between small" style={{ fontWeight: 600 }}>
        <span>{OPERATOR.name} · <span className="mono">{OPERATOR.id}</span></span>
        <span className="muted">{OPERATOR.garage}</span>
      </div>

      <button className="bigbtn v-vehicle" onClick={() => go('/operator/report/vehicle')}>
        <span className="ico"><Icon name="bus" size={30} /></span>
        <span><span className="t">REPORT VEHICLE ISSUE</span><span className="d" style={{ display: 'block' }}>Doors, brakes, lights, lift, warning lamps</span></span>
      </button>
      <button className="bigbtn v-stop" onClick={() => go('/operator/report/stop')}>
        <span className="ico"><Icon name="shelter" size={30} /></span>
        <span><span className="t">REPORT STOP / SHELTER ISSUE</span><span className="d" style={{ display: 'block' }}>Glass, trash, lighting, signs, graffiti</span></span>
      </button>
      <button className="bigbtn v-safety" onClick={() => go('/operator/report/safety')}>
        <span className="ico"><Icon name="shield" size={30} /></span>
        <span><span className="t">REPORT SAFETY / INCIDENT</span><span className="d" style={{ display: 'block' }}>Passenger conduct, hazards, security</span></span>
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

      <div className="op-stopped"><Icon name="stop" size={16} /> Report only while stopped or at layover. Never use the device while driving.</div>
    </OperatorShell>
  );
}
