import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore } from '../services/store.js';
import { isMoving, setMotion } from '../services/ops.js';
import { Icon } from '../components/ui.jsx';

// Bus status control. In production the stopped/moving state comes from the
// vehicle (AVL speed / CAN bus), not a button; the demo lets you flip it.
export function MotionToggle() {
  const moving = useStore((s) => isMoving(s.ops, OPERATOR.bus));
  return (
    <div className="motion" role="group" aria-label="Bus status (demo control)">
      <button className={!moving ? 'on stopped' : ''} onClick={() => setMotion(OPERATOR.bus, 'stopped')} aria-pressed={!moving}>● Stopped</button>
      <button className={moving ? 'on moving' : ''} onClick={() => setMotion(OPERATOR.bus, 'moving')} aria-pressed={moving}>▶ Moving</button>
    </div>
  );
}

export default function OperatorShell({ title, back, children }) {
  const { go, back: goBack, embedded } = useNav();
  return (
    <div className="op">
      <header className="op-top">
        <div className="row between" style={{ alignItems: 'flex-start' }}>
          <div className="stack-sm" style={{ gap: 2 }}>
            {back ? (
              <button className="op-back row" style={{ gap: 4 }} onClick={() => (typeof back === 'string' ? go(back) : goBack('/operator'))}>
                <Icon name="back" size={18} /> {title || 'Back'}
              </button>
            ) : (
              <span className="brand">SMART OPS AI</span>
            )}
            <span className="sub">Bus {OPERATOR.bus} • Route {OPERATOR.route}</span>
          </div>
          {!back && !embedded && <button className="op-back" style={{ fontSize: 14, textDecoration: 'underline' }} onClick={() => go('/')}>Switch role</button>}
        </div>
        <div className="row between" style={{ marginTop: 8, gap: 8 }}>
          <span className="demo-flag">Demo Environment</span>
          <MotionToggle />
        </div>
      </header>
      <div className="op-body">{children}</div>
    </div>
  );
}

// Wrap any screen that needs the operator's hands and eyes. While the bus is
// moving it shows a locked panel instead of the screen.
export function StoppedOnly({ children, what = 'This screen' }) {
  const moving = useStore((s) => isMoving(s.ops, OPERATOR.bus));
  if (!moving) return children;
  return (
    <div className="locked">
      <Icon name="stop" size={34} />
      <div className="t">Bus moving</div>
      <div>{what} opens when the bus is stopped or at layover. Eyes on the road.</div>
      <div className="xs" style={{ opacity: 0.8 }}>Production: unlocks automatically from the vehicle's speed signal.</div>
    </div>
  );
}
