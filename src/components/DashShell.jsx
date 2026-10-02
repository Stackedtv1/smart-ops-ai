import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { onEvent, loadDemoScenario, resetDemo } from '../services/store.js';
import { deptLabel } from '../lib/config.js';
import { durationLabel } from '../lib/time.js';
import { DemoFlag, Modal } from './ui.jsx';
import { useStore } from '../services/store.js';
import { useRole, setRole, allowedTab, ROLE_LABEL } from '../lib/role.js';
import { FIELD_KINDS, terminalName } from '../services/ops.js';

const TABS = [
  { to: '/dispatch', label: 'Dispatch Hub' },
  { to: '/dashboard', label: 'Command' },
  { to: '/terminal/oakland', match: '/terminal', label: 'Terminals' },
  { to: '/lost-found', label: 'Lost & Found' },
  { to: '/maintenance', label: 'Maintenance' },
  { to: '/facilities', label: 'Facilities' },
  { to: '/safety', label: 'Safety' },
  { to: '/fleet', label: 'Fleet Health' },
  { to: '/guardian', label: 'Guardian' },
  { to: '/copilot', label: 'Copilot' },
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
        if (ev.type === 'guardian') {
          const inc = ev.incident;
          if (inc.kind === 'data' || inc.kind === 'flag') return;
          const item = { id: `cp-${Math.random().toString(36).slice(2)}`, guardian: inc };
          setItems((xs) => [...xs.slice(-2), item]);
          setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), 8000);
          return;
        }
        if (ev.type === 'ops') {
          const o = opsToast(ev);
          if (!o) return;
          const item = { id: `op-${Math.random().toString(36).slice(2)}`, ops: o };
          setItems((xs) => [...xs.slice(-2), item]);
          setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), 8000);
          return;
        }
        if (ev.type === 'resolved') {
          const item = { id: `rs-${ev.ticket.id}`, resolved: ev.ticket };
          setItems((xs) => [...xs.filter((x) => x.id !== item.id).slice(-2), item]);
          setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), 8000);
          return;
        }
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
      {items.map((t) => t.ops ? (
        <div key={t.id} className={`toast ${t.ops.tone}`} onClick={() => t.ops.to && go(t.ops.to)}>
          <div className="eyebrow" style={{ color: t.ops.color }}>{t.ops.eyebrow}</div>
          <div style={{ fontWeight: 800, marginTop: 2 }}>{t.ops.title}</div>
          {t.ops.sub && <div className="small muted">{t.ops.sub}</div>}
        </div>
      ) : t.resolved ? (
        <div key={t.id} className="toast toast-ok" onClick={() => go(`/ticket/${t.resolved.id}`)}>
          <div className="row between">
            <span className="eyebrow" style={{ color: 'var(--ok)' }}>✓ Resolved</span>
            <span className="mono xs muted">{t.resolved.id}</span>
          </div>
          <div style={{ fontWeight: 800, marginTop: 2 }}>
            {t.resolved.ai.category === 'facilities' ? `Stop ${t.resolved.stopId}` : `Bus ${t.resolved.vehicle}`} · {t.resolved.ai.title}
          </div>
          <div className="small muted">By {t.resolved.resolution?.by} · {durationLabel((t.resolved.resolution?.at || Date.now()) - t.resolved.createdAt)} from report · “{t.resolved.resolution?.note}”</div>
        </div>
      ) : t.guardian ? (
        <div key={t.id} className={`toast ${t.guardian.severity === 'high' ? 'high' : 'medium'} toast-cp`} onClick={() => go('/guardian')}>
          <div className="eyebrow" style={{ color: 'var(--accent)' }}>Guardian · {t.guardian.kind === 'auto-fix' ? 'auto-corrected' : 'escalated'}</div>
          <div style={{ fontWeight: 800, marginTop: 2 }}>{t.guardian.title}</div>
          {t.guardian.stages?.correct && <div className="small muted">{t.guardian.stages.correct}</div>}
        </div>
      ) : (
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

function opsToast(ev) {
  const i = ev.item;
  if (!i) return null;
  if (ev.kind === 'field') return { eyebrow: `Operator report · ${FIELD_KINDS[i.kind]?.short || 'Note'}`, title: `Bus ${i.bus} · Route ${i.route}`, sub: `“${i.text}”${i.suggestedDetour ? ' · Detour recommendation ready' : ''}`, tone: i.sev === 'high' ? 'high' : 'medium', color: 'var(--high)', to: '/dispatch' };
  if (ev.kind === 'message' && i.fromKind !== 'dispatch') return { eyebrow: 'Request for Dispatch', title: i.from, sub: i.text, tone: 'medium', color: 'var(--accent)', to: '/dispatch' };
  if (ev.kind === 'detour') return { eyebrow: 'Detour published', title: `Routes ${i.routes.join('/')} ${i.direction}`, sub: `${i.closure} · sent to ${i.recipients.length} operators`, tone: 'medium', color: 'var(--med)', to: '/dispatch' };
  if (ev.kind === 'lost-new') return { eyebrow: 'Lost & Found', title: `${i.id} · ${i.item}`, sub: i.status === 'Found' ? `Found on Bus ${i.foundBy}` : `Drivers alerted: ${(i.alerted || []).join(', ') || 'none'}`, tone: 'medium', color: 'var(--ok)', to: '/lost-found' };
  if (ev.kind === 'lost-stage') return { eyebrow: `Lost & Found · ${i.status}`, title: `${i.id} · ${i.item}`, sub: i.status === 'Found' ? `Bus ${i.foundBy} · ${i.foundWhere} · to ${terminalName(i.terminal)}` : i.chain[i.chain.length - 1]?.by, tone: 'medium toast-ok', color: 'var(--ok)', to: '/lost-found' };
  return null;
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
  const navRef = useRef(null);
  useEffect(() => {
    const nav = navRef.current;
    const on = nav?.querySelector('a.on');
    if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - nav.clientWidth / 2 + on.clientWidth / 2);
  }, [cur]);
  const role = useRole();
  const tabs = TABS.filter((t) => allowedTab(role, t.match || t.to));
  const liveStatus = useStore((st) => st.liveStatus);
  const liveLabel = { live: 'Live · shared across every screen', connecting: 'Connecting to live data…', offline: 'Offline · this device only', local: 'Demo · this browser' }[liveStatus] || 'Demo';
  return (
    <div className="dash">
      <header className="dash-top">
        <div className="inner">
          <div className="dash-brand">
            <span className="name">SMART OPS AI</span>
            <span className="tagline hide-sm">AI-Powered Operational Intelligence</span>
          </div>
          <DemoFlag />
          {role && !compact && <span className="role-chip hide-sm">Viewing as {ROLE_LABEL[role]}</span>}
          <div className="grow" />
          {!compact && <span className="row small hide-sm" style={{ color: 'var(--bar-muted)', gap: 6 }}><span className="live-dot" /> {liveLabel}</span>}
          <Clock />
          <div style={{ position: 'relative' }}>
            <button className="btn btn-sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>Demo ▾</button>
            {menu && (
              <div className="panel" style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', width: 250, zIndex: 40, boxShadow: 'var(--shadow)', color: 'var(--ink)' }}>
                <div className="stack-sm" style={{ padding: 8 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => { const r = loadDemoScenario(); setMsg(r.already ? 'Demo scenario is already loaded.' : `Demo scenario loaded: ${r.created.length} tickets created.`); setMenu(false); }}>Load Demo Scenario</button>
                  <button className="btn btn-sm" onClick={() => { setMenu(false); go('/operator'); }}>Open Operator App</button>
                  <button className="btn btn-sm" onClick={() => { setMenu(false); go('/'); }}>Switch role</button>
                  {role && <button className="btn btn-sm" onClick={() => { setMenu(false); setRole(null); }}>Show every tab</button>}
                  <button className="btn btn-sm" onClick={() => { setMenu(false); setConfirmReset(true); }}>Reset demo data</button>
                  <span className="xs muted" style={{ padding: '2px 4px' }}>Shortcut: Shift + D loads the scenario.</span>
                </div>
              </div>
            )}
          </div>
        </div>
        {(
          <nav className="dash-nav" aria-label="Views" ref={navRef}>
            {tabs.map((t) => (
              <a key={t.to} href={`#${t.to}`} className={cur.startsWith(t.match || t.to) ? 'on' : ''} onClick={(e) => { e.preventDefault(); go(t.to); }}>
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
