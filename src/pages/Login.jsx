import { useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { routeLabel } from '../services/maps.js';
import { loadDemoScenario, resetDemo } from '../services/store.js';
import { DemoFlag } from '../components/ui.jsx';

const ROLES = [
  { id: 'operator', t: 'Operator', d: 'Report vehicle, stop and safety issues by voice.', to: '/operator', who: { name: OPERATOR.name, id: OPERATOR.id, lines: [OPERATOR.garage, `Bus ${OPERATOR.bus}`, `Route ${routeLabel(OPERATOR.route)}`] } },
  { id: 'dispatch', t: 'Supervisor / Dispatch', d: 'Command dashboard, live map, ticket queue.', to: '/dashboard', who: { name: 'Angela Brooks', id: 'DEMO-S-204', lines: ['Dispatch Supervisor', 'All garages'] } },
  { id: 'maintenance', t: 'Maintenance', d: 'Vehicle defect queue, fleet health, repair close-out.', to: '/maintenance', who: { name: 'Daniel Alvarez', id: 'DEMO-M-311', lines: ['Technician', 'Oakland Terminal'] } },
  { id: 'facilities', t: 'Facilities', d: 'Shelters, trash, signs, lighting, graffiti.', to: '/facilities', who: { name: 'Shelter Crew 1', id: 'DEMO-F-102', lines: ['Facilities', 'Oakland / Wayne'] } },
  { id: 'admin', t: 'Administration', d: 'Analytics, adoption, ROI calculator.', to: '/analytics', who: { name: 'Executive View', id: 'DEMO-A-001', lines: ['Administration', 'Read-only analytics'] } },
];

export default function Login() {
  const { go } = useNav();
  const [role, setRole] = useState(ROLES[0]);
  const [note, setNote] = useState(null);

  return (
    <div className="login">
      <div className="demo-ribbon">Demo / Concept System · Simulated data · Not an official SMART system</div>
      <div className="login-inner">
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--flag)' }}>AI-Powered Operational Intelligence</div>
          <h1>SMART OPS AI</h1>
          <p className="lede">Operators report problems by voice. The AI structures, prioritizes and routes each report to the right department, and management sees it on a live dashboard.</p>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--bar-muted)' }}>Choose a role</div>
          <div className="roles">
            {ROLES.map((r) => (
              <button key={r.id} className={`role ${role.id === r.id ? 'sel' : ''}`} onClick={() => setRole(r)} aria-pressed={role.id === r.id}>
                <span className="t">{r.t}</span>
                <span className="d">{r.d}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="idcard">
          <div className="avatar">{role.who.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</div>
          <div className="row wrap between" style={{ gap: 14 }}>
            <div className="stack-sm" style={{ gap: 2 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{role.who.name}</div>
              <div className="mono small muted">Employee {role.who.id}</div>
              <div className="small">{role.who.lines.join(' · ')}</div>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => go(role.to)}>Demo Login</button>
          </div>
        </div>

        <button className="role" style={{ minHeight: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }} onClick={() => go('/present')}>
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
