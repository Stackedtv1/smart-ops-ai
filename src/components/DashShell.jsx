import { useEffect, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { onEvent, loadDemoScenario, resetDemo } from '../services/store.js';
import { deptLabel } from '../lib/config.js';
import { DemoFlag, Modal } from './ui.jsx';
import { supabaseEnabled } from '../services/supabase.js';

const TABS = [
  { to: '/dashboard', label: 'Command' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/facilities', label: 'Facilities' },
  { to: '/safety', label: 'Safety' },
  { to: '/analytics', label: 'Analytics' },
  { to: '/roi', label: 'ROI' },
];

export function Clock() {
  const [t, setT] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setT(new Date()), 15000);
    return () => clearInterval(id);
  }, []);
  return <span className="clock">{t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · {t.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>;
}

export function Toasts() {
  const { go } = useNav();
  const [items, setItems] = useState([]);
  useEffect(
    () =>
      onEvent((ev) => {
        if (ev.type !== 'created') return;
        const t = ev.ticket;
        setItems((xs) => [...xs.slice(-2), t]);
        setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 7000);
      }),
    []
  );
  if (!items.length) return null;
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.priority}`} onClick={() => go(`/ticket/${t.id}`)}>
          <div className="row between">
            <span className="eyebrow" style={{ color: t.priority === 'high' ? 'var(--high)' : 'var(--med)' }}>New {t.priority} ticket</span>
            <span className="mono xs muted">{t.id}</span>
          </div>
          <div style={{ fontWeight: 800, marginTop: 2 }}>
            {t.ai.category === 'facilities' ? `Stop ${t.stopId}` : `Bus ${t.vehicle}`} · {t.ai.title}
          </div>
          <div className="small muted">Routed to {deptLabel(t.department)} · Route {t.route}</div>
        </div>
      ))}
    </div>
  );
}

export default function DashShell({ active, children, compact }) {
  const { go, path } = useNav();
  const [menu, setMenu] = useState(false);
  const [msg, setMsg] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    const k = (e) => {
      if (e.shiftKey && (e.key === 'D' || e.key === 'd') && !/input|textarea|select/i.test(e.target.tagName)) {
        const r = loadDemoScenario();
        setMsg(r.already ? 'Demo scenario is already loaded.' : `Demo scenario loaded: ${r.created.length} tickets created.`);
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(id);
  }, [msg]);

  const cur = active || path;
  return (
    <div className="dash">
      <header className="dash-top">
        <div className="inner">
          <div className="dash-brand">
            <span className="name">SMART OPS AI</span>
            <span className="tagline hide-sm">AI-Powered Operational Intelligence</span>
          </div>
          <DemoFlag />
          <div className="grow" />
          {!compact && <span className="row small hide-sm" style={{ color: 'var(--bar-muted)', gap: 6 }}><span className="live-dot" /> {supabaseEnabled() ? 'Live · Supabase Realtime' : 'Live · demo sync'}</span>}
          <Clock />
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Demo ▾</button>
            {menu && (
              <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 250, zIndex: 40, boxShadow: 'var(--shadow)', color: 'var(--ink)' }}>
                <div className="stack-sm" style={{ padding: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => { const r = loadDemoScenario(); setMsg(r.already ? 'Demo scenario is already loaded.' : `Demo scenario loaded: ${r.created.length} tickets created.`); setMenu(false); }}>Load Demo Scenario</button>
                  <button className="btn btn-sm" onClick={() => { setMenu(false); go('/operator'); }}>Open Operator App</button>
                  <button className="btn btn-sm" onClick={() => { setMenu(false); go('/'); }}>Switch role</button>
                  <button className="btn btn-sm" onClick={() => { setMenu(false); setConfirmReset(true); }}>Reset demo data</button>
                  <span className="xs muted" style={{ padding: '2px 4px' }}>Shortcut: Shift + D loads the scenario.</span>
                </div>
              </div>
            )}
          </div>
        </div>
        {!compact && (
          <nav className="dash-nav" aria-label="Views">
            {TABS.map((t) => (
              <a key={t.to} href={`#${t.to}`} className={cur.startsWith(t.to) ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(t.to); }}>
                {t.label}
              </a>
            ))}
          </nav>
        )}
      </header>
      {msg && <div className="demo-ribbon" role="status">{msg}</div>}
      <main className="dash-main">{children}</main>
      <footer className="dash-footer">
        DEMO / CONCEPT SYSTEM · Prototype by Bestowal Powers A.I. · Simulated operational data · Not affiliated with, endorsed by, or connected to SMART systems. Route numbers are public SMART routes; fleet numbers, employees and stop IDs are fictional.
      </footer>
      <Toasts />
      {confirmReset && (
        <Modal
          title="Reset demo data?"
          onClose={() => setConfirmReset(false)}
          footer={<>
            <button className="btn" onClick={() => setConfirmReset(false)}>Cancel</button>
            <button className="btn btn-danger" onClick={() => { resetDemo(); setConfirmReset(false); setMsg('Demo data reset to the morning baseline.'); }}>Reset</button>
          </>}
        >
          <p>This clears reports created during the demo and restores the baseline queue (14 open issues).</p>
        </Modal>
      )}
    </div>
  );
}
