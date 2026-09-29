// Runs SMART Ops AI Guardian on the server against the shared Supabase demo.
// Used by guardian-sweep (on demand) and guardian-scheduled (every minute).
process.env.TZ = process.env.DEMO_TZ || 'America/Detroit';

import { hydrate, getState, emptyGuardian, emptyFleet } from '../../src/services/store.js';
import { sweep } from '../../src/services/guardian.js';
import { dayKey, startOfDay } from '../../src/lib/time.js';

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

export async function runLiveSweep() {
  if (!URL || !KEY) return { ok: false, error: 'Supabase is not configured for Guardian' };
  const [ticketRows, metaRows] = await Promise.all([rest('so_tickets?select=payload'), rest('so_meta?select=key,value,version')]);
  const meta = Object.fromEntries(metaRows.map((r) => [r.key, r]));
  const control = meta.control?.value;
  const tickets = ticketRows.map((r) => r.payload);
  if (!control || control.day !== dayKey() || !tickets.length) return { ok: true, skipped: 'demo not seeded for today yet' };

  const today = startOfDay();
  const seq = Math.max(control.seq || 142, ...tickets.filter((t) => t.createdAt >= today).map((t) => (t.seq || 0) + 1));
  hydrate({
    day: control.day,
    seq,
    scenarioLoaded: !!control.scenarioLoaded,
    liveCount: control.liveCount || 0,
    tickets,
    guardian: meta.guardian?.value || emptyGuardian(),
    fleet: meta.fleet?.value || emptyFleet(),
  });
  const before = new Map(tickets.map((t) => [t.id, JSON.stringify(t)]));
  const fleetBefore = JSON.stringify(getState().fleet);

  sweep();

  const s = getState();
  const changed = s.tickets.filter((t) => before.get(t.id) !== JSON.stringify(t));
  const now = new Date().toISOString();

  // Claim this run: only one Guardian check may write per Guardian version, so
  // two checks started at the same moment never both act.
  const gv = meta.guardian?.version || 0;
  let claimed;
  if (meta.guardian) {
    claimed = await rest(`so_meta?key=eq.guardian&version=eq.${gv}`, { method: 'PATCH', prefer: 'return=representation', body: { value: s.guardian, version: gv + 1, updated_at: now } });
  } else {
    claimed = await rest('so_meta', { method: 'POST', prefer: 'return=representation', body: { key: 'guardian', value: s.guardian, version: 1, updated_at: now } }).catch(() => []);
  }
  if (!Array.isArray(claimed) || !claimed.length) return { ok: true, skipped: 'another Guardian check ran at the same moment' };

  if (changed.length) {
    await rest('so_tickets', { method: 'POST', prefer: 'resolution=merge-duplicates', body: changed.map((t) => ({ id: t.id, payload: t, updated_at: now })) });
  }
  if (JSON.stringify(s.fleet) !== fleetBefore) {
    const fv = meta.fleet?.version || 0;
    await rest('so_meta', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { key: 'fleet', value: s.fleet, version: fv + 1, updated_at: now } });
  }
  if (s.seq !== seq || (control.seq || 0) < s.seq) {
    const cv = meta.control?.version || 0;
    await rest('so_meta', { method: 'POST', prefer: 'resolution=merge-duplicates', body: { key: 'control', value: { ...control, seq: s.seq }, version: cv + 1, updated_at: now } });
  }
  const known = new Set((meta.guardian?.value?.incidents || []).map((i) => i.id));
  return {
    ok: true,
    sweep: s.guardian.sweeps,
    ticketsChanged: changed.length,
    newDetections: s.guardian.incidents.filter((i) => !known.has(i.id)).map((i) => i.title),
  };
}
