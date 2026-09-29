import { CONFIG } from '../lib/config.js';

// Live mode: when VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, every
// device reads and writes one shared demo (tickets + Guardian + fleet state) in
// Supabase and gets changes over Supabase Realtime. Guardian itself runs in a
// Netlify function (server-side). Without the keys the app runs fully local.
//
// Tables (all prefixed so_ so they never collide with other apps' tables):
//   so_tickets(id text pk, payload jsonb, updated_at)
//   so_meta(key text pk, value jsonb, version int, updated_at)   keys: guardian, fleet, control

// A variable (not a string literal) so server bundlers don't try to resolve it.
const SUPABASE_ESM = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

let client = null;
let ready = null;

export const supabaseEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export function getClient() {
  if (!supabaseEnabled()) return Promise.resolve(null);
  if (!ready) {
    ready = import(/* @vite-ignore */ SUPABASE_ESM)
      .then(({ createClient }) => {
        client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, { realtime: { params: { eventsPerSecond: 20 } } });
        return client;
      })
      .catch((e) => {
        console.warn('Supabase unavailable, running local only', e);
        return null;
      });
  }
  return ready;
}

export async function fetchAll() {
  const sb = await getClient();
  if (!sb) return null;
  const [t, m] = await Promise.all([
    sb.from('so_tickets').select('payload'),
    sb.from('so_meta').select('key, value, version'),
  ]);
  if (t.error || m.error) {
    console.warn('live fetch failed', t.error || m.error);
    return null;
  }
  const meta = Object.fromEntries(m.data.map((r) => [r.key, { value: r.value, version: r.version }]));
  return { tickets: t.data.map((r) => r.payload), meta };
}

export async function upsertTickets(tickets) {
  const sb = await getClient();
  if (!sb || !tickets.length) return;
  const now = new Date().toISOString();
  const { error } = await sb.from('so_tickets').upsert(tickets.map((t) => ({ id: t.id, payload: t, updated_at: now })));
  if (error) console.warn('ticket upsert failed', error);
}

export async function deleteAllTickets() {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.from('so_tickets').delete().neq('id', '');
  if (error) console.warn('ticket delete failed', error);
}

export async function saveMeta(key, value, version) {
  const sb = await getClient();
  if (!sb) return;
  const { error } = await sb.from('so_meta').upsert({ key, value, version, updated_at: new Date().toISOString() });
  if (error) console.warn(`meta ${key} save failed`, error);
}

export async function subscribeAll({ onTicket, onTicketDeleted, onMeta }) {
  const sb = await getClient();
  if (!sb) return () => {};
  const ch = sb
    .channel('smart-ops-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'so_tickets' }, (msg) => {
      if (msg.eventType === 'DELETE') onTicketDeleted?.(msg.old?.id);
      else if (msg.new?.payload) onTicket(msg.new.payload);
      else if (msg.new?.id) {
        // Realtime drops large column values (e.g. a ticket carrying photos);
        // read the row directly instead.
        sb.from('so_tickets').select('payload').eq('id', msg.new.id).single().then(({ data }) => data?.payload && onTicket(data.payload));
      }
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'so_meta' }, (msg) => {
      if (msg.new?.key) onMeta(msg.new.key, msg.new.value, msg.new.version);
    })
    .subscribe();
  return () => sb.removeChannel(ch);
}

// Ask the server-side Guardian to run a check now (it also runs every minute on its own).
export async function triggerSweep() {
  try {
    const res = await fetch(`${CONFIG.functionsBase}/guardian-sweep`, { method: 'POST' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
