import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { Icon } from '../components/ui.jsx';

export default function OperatorShell({ title, back, children }) {
  const { go, back: goBack } = useNav();
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
        </div>
        <span className="demo-flag" style={{ marginTop: 8 }}>Demo Environment</span>
      </header>
      <div className="op-body">{children}</div>
    </div>
  );
}
