import { useEffect } from 'react';
import { routeById } from '../services/maps.js';
import { isLive } from '../services/store.js';

const P = {
  mic: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>,
  bus: <><rect x="4" y="3" width="16" height="15" rx="3" /><path d="M4 10h16M8 21v-3M16 21v-3M8 14h.01M16 14h.01" /></>,
  shelter: <><path d="M3 6h18M5 6v14M19 6v14M8 11h8v5H8z" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M12 8v5M12 16h.01" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  alert: <><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></>,
  pin: <><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  clipboard: <><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12l2 2 4-4" /></>,
  list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>,
  back: <><path d="M15 5l-7 7 7 7" /></>,
  chevron: <><path d="M9 5l7 7-7 7" /></>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2" /></>,
  sparkle: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  wrench: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z" /></>,
  restroom: <><circle cx="7" cy="4.5" r="1.8" /><circle cx="17" cy="4.5" r="1.8" /><path d="M5 9h4l1 6H8v6M6 15v6M15 9h4l2 7h-3v5M16 16v5M12 3v18" /></>,
  nav: <><path d="M3 11l18-8-8 18-2-8z" /></>,
  radio: <><rect x="4" y="8" width="16" height="13" rx="2" /><path d="M8 8l9-5M8 13h.01M8 17h.01M13 13h4M13 17h4" /></>,
  bag: <><path d="M6 8h12l1 13H5zM9 8V6a3 3 0 0 1 6 0v2" /></>,
  cone: <><path d="M9 4h6l4 15H5zM7 12h10M4 19h16v2H4z" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="M7 12h10" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>,
  flag: <><path d="M5 21V4h11l-2 4 2 4H5" /></>,
  building: <><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3" /></>,
};

export function Icon({ name, size = 20, stroke = 2, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {P[name]}
    </svg>
  );
}

export function DemoFlag({ text = 'Demo / Concept System' }) {
  return <span className="demo-flag">{text}</span>;
}

export function PriorityPill({ p, resolved, merged }) {
  if (merged) return <span className="pill p-merged">Merged</span>;
  if (resolved) return <span className="pill p-resolved">Resolved</span>;
  return <span className={`pill p-${p}`}>{p}</span>;
}

const S = { New: 's-new', Assigned: 's-assigned', 'In Progress': 's-progress', Resolved: 's-resolved', Merged: 's-merged' };
export function StatusPill({ s }) {
  return <span className={`status ${S[s] || ''}`}>{s}</span>;
}

export function RouteBadge({ id }) {
  const r = routeById(id);
  return (
    <span className="route-badge" style={{ background: r?.color || '#445' }} title={r ? `${r.id} ${r.name}` : ''}>
      {id}
    </span>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="panel-h">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="panel-b stack">{children}</div>
        {footer && <div className="panel-b row" style={{ justifyContent: 'flex-end', borderTop: '1px solid var(--line)' }}>{footer}</div>}
      </div>
    </div>
  );
}

export const PRIORITY_COLOR = { high: 'var(--high)', medium: 'var(--med)', low: 'var(--low)' };

// Downscale a camera photo so it can travel with the ticket.
export function readPhoto(file, max = 800) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = reject;
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => resolve(fr.result);
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k);
        c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try {
          resolve(c.toDataURL('image/jpeg', 0.6));
        } catch {
          resolve(fr.result);
        }
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

// Shown next to Guardian everywhere it appears, so nobody wonders whether
// the monitoring runs with the browser closed.
export function MonitorModeBadge({ compact }) {
  if (isLive()) {
    return (
      <span className={`mode-badge live ${compact ? 'compact' : ''}`} title="Guardian runs in a server function: every minute on a schedule, and whenever someone submits a report. It keeps running with every browser closed.">
        <span className="mode-row"><b>LIVE</b> — Guardian runs server-side</span>
        {!compact && <span className="mode-row">Every 60 sec + on every report · keeps running with browsers closed</span>}
      </span>
    );
  }
  return (
    <span className={`mode-badge ${compact ? 'compact' : ''}`} title="In this demo Guardian runs in the open browser. In production it runs on a server around the clock.">
      <span className="mode-row"><b>DEMO MODE</b> — monitoring every 15 sec</span>
      {!compact && <span className="mode-row">Production: 24/7 server-side monitoring</span>}
    </span>
  );
}
