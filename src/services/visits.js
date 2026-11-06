import { CONFIG } from '../lib/config.js';
import { getClient } from './supabase.js';

// Visit tracking: each app open and each demo sign-in is logged server-side
// (track-visit function -> Supabase so_visits). Only the owner can read it,
// from the hidden /#/owner?key=... page. Opening that page once marks this
// device as the owner's, so the owner's own visits are tagged and hidden.

const VKEY = 'smart-ops-ai.visitor';
const OKEY = 'smart-ops-ai.owner';
const SKEY = 'smart-ops-ai.opened';

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function visitorId() {
  let id = ls.get(VKEY);
  if (!id) {
    id = (crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    ls.set(VKEY, id);
  }
  return id;
}

export const ownerKey = () => ls.get(OKEY);
export const markOwner = (key) => ls.set(OKEY, key);

export function trackVisit(event, extra = {}) {
  if (CONFIG.aiMode === 'offline' || typeof window === 'undefined') return;
  const body = JSON.stringify({
    event,
    visitor: visitorId(),
    referrer: document.referrer || null,
    owner: !!ownerKey(),
    ...extra,
  });
  try {
    fetch(`${CONFIG.functionsBase}/track-visit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* tracking must never break the demo */ }
}

// One "open" per browser tab session.
export function trackOpen() {
  try {
    if (sessionStorage.getItem(SKEY)) return;
    sessionStorage.setItem(SKEY, '1');
  } catch { /* ignore */ }
  if ((window.location.hash || '').startsWith('#/owner')) return;
  trackVisit('open');
}

export async function fetchVisits(key, includeOwner = false) {
  const sb = await getClient();
  if (!sb) return { error: 'Supabase is not configured' };
  const { data, error } = await sb.rpc('so_visit_report', { p_key: key, p_include_owner: includeOwner });
  if (error) return { error: /not allowed/i.test(error.message) ? 'Wrong key' : error.message };
  return { rows: data || [] };
}
