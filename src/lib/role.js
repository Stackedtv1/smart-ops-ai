import { useSyncExternalStore } from 'react';

// Role-based navigation. Every role sees only what it needs; everything else
// still exists behind "More" (dispatch) or links from alerts and tickets.
// Demo only: production enforces roles with Supabase Auth + row-level security.

const is = (...paths) => (p) => paths.some((x) => (x.endsWith('*') ? p.startsWith(x.slice(0, -1)) : p.split('?')[0] === x));

export const NAV = {
  dispatch: {
    label: 'Central Dispatch',
    home: '/dispatch',
    tabs: [
      { label: 'Home', to: '/dispatch', on: is('/dispatch') },
      { label: 'Map / Detours', to: '/dispatch/map', on: is('/dispatch/map') },
      { label: 'Messages', to: '/dispatch/messages', on: is('/dispatch/messages') },
      { label: 'Incidents', to: '/dashboard', on: is('/dashboard', '/ticket/*') },
    ],
    more: [
      { label: 'Terminals', to: '/terminal/oakland', on: is('/terminal*') },
      { label: 'Lost & Found', to: '/lost-found', on: is('/lost-found') },
      { label: 'Maintenance queue', to: '/maintenance', on: is('/maintenance') },
      { label: 'Facilities queue', to: '/facilities', on: is('/facilities') },
      { label: 'Safety queue', to: '/safety', on: is('/safety') },
      { label: 'Fleet Health', to: '/fleet', on: is('/fleet*') },
      { label: 'Guardian activity', to: '/guardian', on: is('/guardian') },
      { label: 'Analytics', to: '/analytics', on: is('/analytics') },
      { label: 'ROI', to: '/roi', on: is('/roi*') },
    ],
  },
  terminal: {
    label: 'Terminal Supervisor',
    home: '/terminal/oakland',
    tabs: [
      { label: 'Terminal', to: '/terminal/oakland', on: (p) => /^\/terminal(\/[a-z]+)?$/.test(p) },
      { label: 'Buses', to: '/terminal/oakland/buses', on: (p) => /\/buses$/.test(p) },
      { label: 'Incidents', to: '/terminal/oakland/incidents', on: (p) => /\/incidents$/.test(p) || p.startsWith('/ticket/') },
      { label: 'Lost & Found', to: '/terminal/oakland/lost', on: (p) => /\/lost$/.test(p) },
      { label: 'Messages', to: '/terminal/oakland/messages', on: (p) => /\/messages$/.test(p) },
    ],
  },
  customer: {
    label: 'Customer Service',
    home: '/lost-found',
    tabs: [{ label: 'Lost & Found', to: '/lost-found', on: is('/lost-found') }],
  },
  maintenance: {
    label: 'Maintenance',
    home: '/maintenance',
    tabs: [{ label: 'My Work Queue', to: '/maintenance', on: is('/maintenance', '/ticket/*', '/fleet*') }],
  },
  facilities: {
    label: 'Facilities',
    home: '/facilities',
    tabs: [{ label: 'My Work Queue', to: '/facilities', on: is('/facilities', '/ticket/*') }],
  },
  admin: {
    label: 'Management',
    home: '/dashboard',
    tabs: [
      { label: 'Overview', to: '/dashboard', on: is('/dashboard', '/ticket/*') },
      { label: 'Fleet Health', to: '/fleet', on: is('/fleet*') },
      { label: 'Analytics', to: '/analytics', on: is('/analytics') },
      { label: 'ROI', to: '/roi', on: is('/roi*') },
    ],
    more: [
      { label: 'Dispatch Home', to: '/dispatch', on: is('/dispatch') },
      { label: 'Guardian activity', to: '/guardian', on: is('/guardian') },
    ],
  },
};

export const ROLE_LABEL = Object.fromEntries(Object.entries(NAV).map(([k, v]) => [k, v.label]));

// Terminal tabs follow whichever terminal is open.
export function navFor(role, path) {
  const n = NAV[role] || NAV.dispatch;
  if (role !== 'terminal') return n;
  const id = path.match(/^\/terminal\/([a-z]+)/)?.[1] || 'oakland';
  return { ...n, tabs: n.tabs.map((t) => ({ ...t, to: t.to.replace('oakland', id) })) };
}

const KEY = 'smart-ops-ai.role';
let role = (() => {
  try { return sessionStorage.getItem(KEY) || null; } catch { return null; }
})();
const subs = new Set();

export function setRole(r) {
  role = r || null;
  try { if (role) sessionStorage.setItem(KEY, role); else sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

export function useRole() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => role, () => role);
}
