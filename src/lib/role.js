import { useSyncExternalStore } from 'react';

// Role-based views. Each role sees only the tabs it needs; Central Dispatch
// gets the master view. Demo only: production enforces this with Supabase Auth
// + row-level security, not in the browser.
export const ROLE_TABS = {
  dispatch: null, // master view: every tab
  terminal: ['/terminal', '/fleet', '/maintenance'],
  customer: ['/lost-found'],
  maintenance: ['/maintenance', '/fleet', '/guardian'],
  facilities: ['/facilities', '/dispatch'],
  admin: ['/dashboard', '/analytics', '/roi', '/copilot', '/guardian'],
};

export const ROLE_LABEL = {
  dispatch: 'Central Dispatch · master view',
  terminal: 'Terminal Supervisor',
  customer: 'Customer Service',
  maintenance: 'Maintenance',
  facilities: 'Facilities',
  admin: 'Management',
};

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

export function allowedTab(r, to) {
  const list = r ? ROLE_TABS[r] : null;
  if (!list) return true;
  return list.some((p) => to.startsWith(p));
}
