import { useNav } from '../lib/router.jsx';
import { Icon } from '../components/ui.jsx';
import OperatorShell, { StoppedOnly } from './OperatorShell.jsx';

const KINDS = [
  { k: 'Vehicle', d: 'Doors, brakes, lift, warning lamps', icon: 'bus', to: '/operator/report/vehicle', c: '#0b5cad' },
  { k: 'Road', d: 'Closed road, construction, pothole', icon: 'cone', to: '/operator/field', c: '#c75f00' },
  { k: 'Stop', d: 'Shelter, trash, lighting, blocked stop', icon: 'shelter', to: '/operator/report/stop', c: '#0f7a6d' },
  { k: 'Safety', d: 'Passenger conduct, hazards', icon: 'shield', to: '/operator/report/safety', c: '#b3261e' },
  { k: 'Lost Item', d: 'Found something / alerts', icon: 'bag', to: '/operator/lost', c: '#6b3fb0' },
];

// REPORT ISSUE: pick one, speak, send. Bus, route, GPS and time are captured
// automatically and AI routes it to the right department.
export default function OperatorReport() {
  const { go } = useNav();
  return (
    <OperatorShell title="Report Issue" back="/operator">
      <StoppedOnly what="Reporting">
        <div className="small muted" style={{ fontWeight: 600 }}>Pick one. Speak or type. Send. SMART Ops fills in the bus, route, location and department.</div>
        <div className="stack-sm">
          {KINDS.map((x) => (
            <button key={x.k} className="bigbtn slim" style={{ background: x.c }} onClick={() => go(x.to)}>
              <span className="ico"><Icon name={x.icon} size={26} /></span>
              <span><span className="t">{x.k.toUpperCase()}</span><span className="d" style={{ display: 'block' }}>{x.d}</span></span>
            </button>
          ))}
        </div>
      </StoppedOnly>
    </OperatorShell>
  );
}
