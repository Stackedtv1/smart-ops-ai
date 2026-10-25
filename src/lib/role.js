import { useSyncExternalStore } from 'react';

// Role-based navigation. Every role sees only what it needs; everything else
// still exists behind "More" (dispatch) or links from alerts and tickets.
// Demo only: production enforces roles with Supabase Auth + row-level security.

const is = (...paths) => (p) => paths.some((x) => (x.endsWith('*') ? p.startsWith(x.slice(0, -1)) : p.split('?')[0] === x));

// Maintenance and Facilities: one queue, five ways to look at it.
export const WORK_VIEWS = [
  { view: '', label: 'My Work Queue', icon: 'wrench' },
  { view: 'high', label: 'High Priority', icon: 'alert' },
  { view: 'mine', label: 'Assigned to Me', icon: 'user' },
  { view: 'open', label: 'Open Jobs', icon: 'list' },
  { view: 'done', label: 'Completed Today', icon: 'check' },
];
const viewOf = (p) => (p.split('?')[1] || '').match(/(?:^|&)view=([a-z]+)/)?.[1] || '';
function workTabs(dept, also = []) {
  return WORK_VIEWS.map((w) => ({
    label: w.label, icon: w.icon,
    to: w.view ? `/${dept}?view=${w.view}` : `/${dept}`,
    on: (p) => (p.split('?')[0] === `/${dept}` ? viewOf(p) === w.view : !w.view && is(...also)(p)),
  }));
}

export const NAV = {
  dispatch: {
    icon: 'radio',
    label: 'Central Dispatch',
    home: '/dispatch',
    tabs: [
      { label: 'Home', icon: 'home', to: '/dispatch', on: is('/dispatch') },
      { label: 'Map / Detours', icon: 'map', to: '/dispatch/map', on: is('/dispatch/map') },
      { label: 'Messages', icon: 'mail', badge: 'dispatchMessages', to: '/dispatch/messages', on: is('/dispatch/messages') },
      { label: 'Incidents', icon: 'alert', badge: 'newIncidents', to: '/dashboard', on: is('/dashboard', '/ticket/*') },
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
    icon: 'building',
    label: 'Terminal Supervisor',
    home: '/terminal/oakland',
    tabs: [
      { label: 'Terminal', icon: 'building', to: '/terminal/oakland', on: (p) => /^\/terminal(\/[a-z]+)?$/.test(p) },
      { label: 'Buses', icon: 'bus', to: '/terminal/oakland/buses', on: (p) => /\/buses$/.test(p) },
      { label: 'Incidents', icon: 'alert', to: '/terminal/oakland/incidents', on: (p) => /\/incidents$/.test(p) || p.startsWith('/ticket/') },
      { label: 'Lost & Found', icon: 'bag', to: '/terminal/oakland/lost', on: (p) => /\/lost$/.test(p) },
      { label: 'Messages', icon: 'mail', to: '/terminal/oakland/messages', on: (p) => /\/messages$/.test(p) },
    ],
  },
  safety: {
    icon: 'shield',
    label: 'Safety & Security',
    home: '/safety',
    tabs: [
      { label: 'Safety Queue', icon: 'shield', to: '/safety', on: is('/safety', '/ticket/*') },
      { label: 'Guardian Alerts', icon: 'sparkle', to: '/guardian', on: is('/guardian') },
    ],
  },
  customer: {
    icon: 'bag',
    label: 'Customer Service',
    home: '/lost-found',
    tabs: [{ label: 'Lost & Found', icon: 'bag', to: '/lost-found', on: is('/lost-found') }],
  },
  maintenance: {
    icon: 'wrench',
    label: 'Maintenance',
    home: '/maintenance',
    tabs: workTabs('maintenance', ['/ticket/*', '/fleet*']),
  },
  facilities: {
    icon: 'shelter',
    label: 'Facilities',
    home: '/facilities',
    tabs: workTabs('facilities', ['/ticket/*']),
  },
  admin: {
    icon: 'chart',
    label: 'Management',
    home: '/dashboard',
    tabs: [
      { label: 'Overview', icon: 'chart', to: '/dashboard', on: is('/dashboard', '/ticket/*') },
      { label: 'Fleet Health', icon: 'pulse', to: '/fleet', on: is('/fleet*') },
      { label: 'Analytics', icon: 'chart', to: '/analytics', on: is('/analytics') },
      { label: 'ROI', icon: 'dollar', to: '/roi', on: is('/roi*') },
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
