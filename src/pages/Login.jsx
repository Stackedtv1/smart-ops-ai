import { useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { routeLabel } from '../services/maps.js';
import { loadDemoScenario, resetDemo } from '../services/store.js';
import { DemoFlag } from '../components/ui.jsx';
import { setRole } from '../lib/role.js';

const ROLES = [
  { id: 'operator', t: 'Operator', d: 'Four buttons: Restroom, Navigation, Report Issue, Dispatch.', to: '/operator', who: { name: OPERATOR.name, id: OPERATOR.id, lines: [OPERATOR.garage, `Bus ${OPERATOR.bus}`, `Route ${routeLabel(OPERATOR.route)}`] } },
  { id: 'dispatch', t: 'Central Dispatch', d: 'Home shows what needs you now. Road closed → detour in 3 taps.', to: '/dispatch', who: { name: 'Angela Brooks', id: 'DEMO-S-204', lines: ['Dispatch Supervisor', 'All garages'] } },
  { id: 'terminal', t: 'Terminal Supervisor', d: 'Your terminal only: buses, incidents, lost & found, messages.', to: '/terminal/oakland', who: { name: 'T. Reed', id: 'DEMO-T-410', lines: ['Oakland Terminal'] } },
  { id: 'customer', t: 'Customer Service', d: 'Lost & Found intake, AI trip matching, claim tracking.', to: '/lost-found', who: { name: 'Customer Service Desk', id: 'DEMO-C-120', lines: ['Lost & Found only'] } },
  { id: 'maintenance', t: 'Maintenance', d: 'Your work queue: high priority, assigned to you, open, completed.', to: '/maintenance', who: { name: 'Daniel Alvarez', id: 'DEMO-M-311', lines: ['Technician', 'Oakland Terminal'] } },
  { id: 'facilities', t: 'Facilities', d: 'Your work queue: shelters, trash, signs, relief-point problems.', to: '/facilities', who: { name: 'Shelter Crew 1', id: 'DEMO-F-102', lines: ['Facilities', 'Oakland / Wayne'] } },
  { id: 'admin', t: 'Management', d: 'Overview, fleet health, analytics, ROI.', to: '/dashboard', who: { name: 'Executive View', id: 'DEMO-A-001', lines: ['Administration', 'Analytics & trends'] } },
];

export default function Login() {
  const { go } = useNav();
  const [note, setNote] = useState(null);

  return (
    <div className="login">
      <div className="demo-ribbon">Demo / Concept System · Simulated data · Not an official SMART system</div>
      <div className="login-inner">
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--flag)' }}>AI-Powered Operational Intelligence</div>
          <h1>SMART OPS AI</h1>
          <p className="lede">One communication system for the whole operation: Operator → Bus → Terminal → Central Dispatch → Maintenance → Facilities → Customer Service, all feeding the Command Center.</p>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--bar-muted)' }}>Choose a role · tap to open</div>
          <div className="roles">
            {ROLES.map((r) => (
              <button key={r.id} className="role" onClick={() => { setRole(r.id === 'operator' ? null : r.id); go(r.to); }}>
                <span className="row between" style={{ gap: 8 }}>
                  <span className="t">{r.t}</span>
                  <span className="role-go" aria-hidden="true">Open →</span>
                </span>
                <span className="d">{r.d}</span>
                <span className="role-who">Demo login: {r.who.name} · {r.who.id}{r.who.lines.length ? ` · ${r.who.lines.join(' · ')}` : ''}</span>
              </button>
            ))}
          </div>
        </div>

        <button className="role" style={{ minHeight: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }} onClick={() => { setRole(null); go('/present'); }}>
          <span className="stack-sm" style={{ gap: 2 }}>
            <span className="t">Presenter Mode</span>
            <span className="d">Operator phone and command dashboard side by side. Best for a live pitch on one screen.</span>
          </span>
          <DemoFlag text="Recommended" />
        </button>

        <div className="login-foot">
          <span>Prototype by Bestowal Powers A.I. Not affiliated with or endorsed by SMART. Fleet numbers, employees and stop IDs are fictional.</span>
          <span className="row" style={{ gap: 6 }}>
            <button onClick={() => { const r = loadDemoScenario(); setNote(r.already ? 'Scenario already loaded' : `Loaded ${r.created.length} demo tickets`); }}>Load demo scenario</button>
            <button onClick={() => { resetDemo(); setNote('Demo reset'); }}>Reset</button>
          </span>
          {note && <span role="status" style={{ color: 'var(--flag)', fontWeight: 700, fontSize: 14, flexBasis: '100%' }}>{note}</span>}
        </div>
      </div>
    </div>
  );
}
