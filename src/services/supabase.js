import { CONFIG } from '../lib/config.js';

// Optional Supabase sync. When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are
// set, tickets are written to Postgres and every device receives changes via
// Supabase Realtime (operator phone -> management dashboard on another screen).
// Without them the app runs fully local (same-browser tabs still sync).

let client = null;
let ready = null;

export const supabaseEnabled = () => !!(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);

export function getClient() {
  if (!supabaseEnabled()) return Promise.resolve(null);
  if (!ready) {
    ready = import(/* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({ createClient }) => {
        client = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
        return client;
      })
      .catch((e) => {
        console.warn('Supabase unavailable, running local only', e);
        return null;
      });
  }
  return ready;
}

function toRow(t) {
  return {
    id: t.id,
    created_at: new Date(t.createdAt).toISOString(),
    updated_at: new Date(t.updatedAt || t.createdAt).toISOString(),
    vehicle_id: t.vehicle,
    route_id: t.route,
    stop_id: t.stopId,
    operator_id: t.operatorId,
    category: t.ai.category,
    subcategory: t.ai.subcategory,
    priority: t.priority,
    department: t.department,
    status: t.status,
    assignee: t.assignee,
    summary: t.ai.summary,
    latitude: t.location?.lat ?? null,
    longitude: t.location?.lng ?? null,
    payload: t,
  };
}

export async function fetchTickets() {
  const sb = await getClient();
  if (!sb) return null;
  const { data, error } = await sb.from('tickets').select('payload').order('created_at', { ascending: true });
  if (error) {
    console.warn(error);
    return null;
  }
  return data.map((r) => r.payload);
}

export async function upsertTickets(tickets) {
  const sb = await getClient();
  if (!sb || !tickets.length) return;
  const { error } = await sb.from('tickets').upsert(tickets.map(toRow));
  if (error) console.warn('ticket upsert failed', error);
}

// Normalized audit rows alongside the denormalized ticket payload.
export async function insertReport(t) {
  const sb = await getClient();
  if (!sb) return;
  await sb.from('reports').insert({
    ticket_id: t.id,
    operator_id: t.operatorId,
    vehicle_id: t.vehicle,
    route_id: t.route,
    stop_id: t.stopId,
    latitude: t.location?.lat ?? null,
    longitude: t.location?.lng ?? null,
    voice_text: t.inputMode === 'typed' ? null : t.originalText,
    typed_text: t.inputMode === 'typed' ? t.originalText : null,
    photo_url: t.photo && !t.photo.startsWith('data:') ? t.photo : null,
    ai_json: t.aiJson,
    created_at: new Date(t.createdAt).toISOString(),
  });
}

export async function insertStatusEvent(ticketId, ev) {
  const sb = await getClient();
  if (!sb) return;
  await sb.from('status_history').insert({ ticket_id: ticketId, label: ev.label, actor: ev.by, created_at: new Date(ev.at).toISOString() });
}

export async function uploadPhoto(dataUrl, ticketId) {
  const sb = await getClient();
  if (!sb || !dataUrl?.startsWith('data:')) return dataUrl;
  const blob = await (await fetch(dataUrl)).blob();
  const path = `${ticketId}/${Date.now()}.jpg`;
  const { error } = await sb.storage.from('report-photos').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) return dataUrl;
  return sb.storage.from('report-photos').getPublicUrl(path).data.publicUrl;
}

export async function subscribeTickets(onRow) {
  const sb = await getClient();
  if (!sb) return () => {};
  const ch = sb
    .channel('tickets-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, (msg) => {
      if (msg.new?.payload) onRow(msg.new.payload);
    })
    .subscribe();
  return () => sb.removeChannel(ch);
}

export async function clearRemote() {
  const sb = await getClient();
  if (!sb) return;
  await sb.from('status_history').delete().neq('ticket_id', '');
  await sb.from('reports').delete().neq('ticket_id', '');
  await sb.from('tickets').delete().neq('id', '');
}
