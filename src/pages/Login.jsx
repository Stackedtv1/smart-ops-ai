import { useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { routeLabel } from '../services/maps.js';
import { loadDemoScenario, resetDemo } from '../services/store.js';
import { DemoFlag } from '../components/ui.jsx';
import { setRole, setUser } from '../lib/role.js';

const ROLES = [
  { id: 'operator', t: 'Operator', d: 'Four buttons: Restroom, Navigation, Report Issue, Dispatch.', to: '/operator', pin: true, pass: '2026', who: { name: OPERATOR.name, id: OPERATOR.id, lines: [OPERATOR.garage, `Bus ${OPERATOR.bus}`, `Route ${routeLabel(OPERATOR.route)}`] } },
  { id: 'dispatch', pass: 'smart2026', t: 'Central Dispatch', d: 'Home shows what needs you now. Road closed → detour in 3 taps.', to: '/dispatch', who: { name: 'Angela Brooks', id: 'DEMO-S-204', lines: ['Dispatch Supervisor', 'All garages'] } },
  { id: 'terminal', pass: 'smart2026', t: 'Terminal Supervisor', d: 'Your terminal only: buses, incidents, lost & found, messages.', to: '/terminal/oakland', who: { name: 'T. Reed', id: 'DEMO-T-410', lines: ['Oakland Terminal'] } },
  { id: 'safety', pass: 'smart2026', t: 'Safety & Security', d: 'Incident reports and escalations: fights, medical, threats, hazards.', to: '/safety', who: { name: 'Road Supervisor 12', id: 'DEMO-R-012', lines: ['Supervisor / Safety', 'All garages'] } },
  { id: 'customer', pass: 'smart2026', t: 'Customer Service', d: 'Lost & Found intake, AI trip matching, claim tracking.', to: '/lost-found', who: { name: 'Customer Service Desk', id: 'DEMO-C-120', lines: ['Lost & Found only'] } },
  { id: 'maintenance', pass: 'smart2026', t: 'Maintenance', d: 'Your work queue: high priority, assigned to you, open, completed.', to: '/maintenance', who: { name: 'Daniel Alvarez', id: 'DEMO-M-311', lines: ['Technician', 'Oakland Terminal'] } },
  { id: 'facilities', pass: 'smart2026', t: 'Facilities', d: 'Your work queue: shelters, trash, signs, relief-point problems.', to: '/facilities', who: { name: 'Shelter Crew 1', id: 'DEMO-F-102', lines: ['Facilities', 'Oakland / Wayne'] } },
  { id: 'admin', pass: 'smart2026', t: 'Management', d: 'Overview, fleet health, analytics, ROI.', to: '/dashboard', who: { name: 'Executive View', id: 'DEMO-A-001', lines: ['Administration', 'Analytics & trends'] } },
];

const norm = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
const findAccount = (id) => ROLES.find((r) => norm(r.who.id) === norm(id) || norm(r.who.id) === `DEMO-${norm(id)}`);

export default function Login() {
  const { go } = useNav();
  const [note, setNote] = useState(null);
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState(null);
  const pwRef = useRef(null);
  const formRef = useRef(null);
  const acct = findAccount(id);
  const isPin = acct ? !!acct.pin : picked === 'operator';

  function pick(r) {
    setPicked(r.id); setId(r.who.id); setPw(r.pass); setErr(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function signIn(e) {
    e.preventDefault();
    const a = findAccount(id);
    if (!a) { setErr('No account with that ID. Tap a demo account below.'); return; }
    if (pw !== a.pass) { setErr(a.pin ? 'Wrong PIN. Try again.' : 'Wrong password. Try again.'); return; }
    setErr(null); setBusy(true);
    setTimeout(() => {
      setUser({ name: a.who.name, id: a.who.id, role: a.id, title: a.t });
      setRole(a.id === 'operator' ? null : a.id);
      setBusy(false);
      go(a.to);
    }, 700);
  }

  return (
    <div className="login">
      <div className="demo-ribbon">Demo / Concept System · Simulated data · Not an official SMART system</div>
      <div className="login-inner">
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--flag)' }}>AI-Powered Operational Intelligence</div>
          <h1>SMART OPS AI</h1>
          <p className="lede">One communication system for the whole operation: Operator → Bus → Terminal → Central Dispatch → Maintenance → Facilities → Customer Service, all feeding the Command Center.</p>
        </div>

        <form className="signin" ref={formRef} onSubmit={signIn}>
          <div className="row between" style={{ gap: 8 }}>
            <span className="signin-t">Sign in</span>
            <span className="signin-tag">Demo accounts</span>
          </div>
          <label className="signin-l">
            <span>{isPin ? 'Badge number' : 'Employee ID'}</span>
            <input className="signin-in" value={id} onChange={(e) => { setId(e.target.value); setPicked(null); setErr(null); }} placeholder="e.g. DEMO-S-204" autoCapitalize="characters" autoCorrect="off" spellCheck={false} autoComplete="username" />
          </label>
          <label className="signin-l">
            <span>{isPin ? '4-digit PIN' : 'Password'}</span>
            <input ref={pwRef} className="signin-in" type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} inputMode={isPin ? 'numeric' : undefined} maxLength={isPin ? 4 : undefined} autoComplete="current-password" />
          </label>
          {acct && <div className="signin-who">{acct.who.name} · {acct.t}</div>}
          {err && <div className="signin-err" role="alert">{err}</div>}
          <button className="signin-btn" disabled={busy || !id || !pw}>{busy ? 'Verifying role…' : 'Sign in'}</button>
          <div className="signin-note">Each person gets their own login and sees only their department's screens. In production, staff sign in with their existing SMART work account (single sign-on), and operators use badge number + PIN. No new passwords to manage.</div>
        </form>

        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow" style={{ color: 'var(--bar-muted)' }}>Demo accounts · tap one to fill in the login</div>
          <div className="roles">
            {ROLES.map((r) => (
              <button key={r.id} className={`role${picked === r.id ? ' sel' : ''}`} onClick={() => pick(r)}>
                <span className="row between" style={{ gap: 8 }}>
                  <span className="t">{r.t}</span>
                  <span className="role-go" aria-hidden="true">Use →</span>
                </span>
                <span className="d">{r.d}</span>
                <span className="role-who">{r.who.name} · {r.who.id} · {r.pin ? 'PIN' : 'Password'}: {r.pass}{r.who.lines.length ? ` · ${r.who.lines.join(' · ')}` : ''}</span>
              </button>
            ))}
          </div>
        </div>

        <button className="role" style={{ minHeight: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }} onClick={() => { setRole(null); setUser({ name: 'Presenter', id: 'DEMO-P', role: 'presenter', title: 'Presenter Mode' }); go('/present'); }}>
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
