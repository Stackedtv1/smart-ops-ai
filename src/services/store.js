import { useSyncExternalStore } from 'react';
import seed from '../data/demoReports.json';
import vehicleData from '../data/demoVehicles.json';
import { OPERATOR, DEPARTMENTS, deptLabel } from '../lib/config.js';
import { MIN, startOfDay, dayKey, yymmdd, fmtDate } from '../lib/time.js';
import { stopById } from './maps.js';
import { classifyLocal, resolveLocation, toContractJson, recommendedAction } from './ai.js';
import * as remote from './supabase.js';
import { seedOps, emptyOps, diffOps } from './opsSeed.js';

const KEY = 'smart-ops-ai.state.v3';
const TAB = Math.random().toString(36).slice(2);
const FIRST_LIVE_SEQ = 142;

const listeners = new Set();
const eventListeners = new Set();

const GARAGE_NAME = Object.fromEntries(vehicleData.garages.map((g) => [g.id, g.name]));
const VEHICLE = Object.fromEntries(vehicleData.vehicles.map((v) => [v.fleet_number, v]));
export const garageOf = (bus) => GARAGE_NAME[VEHICLE[bus]?.garage] || 'Oakland Terminal';

function shiftOf(ts) {
  const h = new Date(ts).getHours();
  if (h >= 4 && h < 12) return 'Morning';
  if (h >= 12 && h < 20) return 'Afternoon';
  return 'Night';
}

const ticketId = (ts, seq) => `SMART-${yymmdd(ts)}-${String(seq).padStart(4, '0')}`;

// ---------------------------------------------------------------------------
// Seed data -> tickets
// ---------------------------------------------------------------------------
function buildSeedTicket(s, now) {
  let createdAt;
  if (s.daysAgo) {
    const [hh, mm] = s.at.split(':').map(Number);
    const d = new Date(startOfDay(now) - s.daysAgo * 86400000);
    d.setHours(hh, mm, 0, 0);
    createdAt = d.getTime();
  } else {
    // Compress "today" offsets if the demo is opened early in the morning.
    const available = Math.max(60, (now - startOfDay(now)) / MIN - 20);
    const scale = Math.min(1, available / 400);
    createdAt = now - s.minutesAgo * scale * MIN;
  }
  const stop = stopById(s.stopId);
  const dep = s.department;
  const tl = [
    { at: createdAt, label: 'Operator submitted', by: s.operatorName },
    { at: createdAt + 12000, label: 'AI categorized', by: 'SMART Ops AI' },
    { at: createdAt + 40000, label: `${deptLabel(dep)} notified`, by: 'SMART Ops AI' },
  ];
  let resolvedAt = null;
  const life = s.resolvedAfter ? s.resolvedAfter * MIN : Math.max(4 * MIN, now - createdAt);
  if (s.status !== 'New') tl.push({ at: createdAt + Math.min(3 * MIN, life * 0.1), label: `Assigned to ${s.assignee}`, by: 'Dispatch' });
  if (s.status === 'In Progress' || s.status === 'Resolved')
    tl.push({ at: createdAt + Math.min(life * 0.45, now - createdAt - MIN), label: DEPARTMENTS[dep]?.startLabel || 'Work started', by: s.assignee });
  if (s.status === 'Resolved') {
    resolvedAt = createdAt + s.resolvedAfter * MIN;
    tl.push({ at: resolvedAt, label: 'Resolved', by: s.assignee });
  }
  const ai = {
    category: s.category, subcategory: s.subcategory, component: s.component, title: s.title,
    issue: s.issue, condition: s.issue, priority: s.priority, department: dep, summary: s.summary,
    safety_review_required: s.review, confidence: 0.9 + ((s.seq * 7) % 8) / 100, engine: 'demo',
  };
  ai.recommended_action = recommendedAction(ai);
  return {
    id: ticketId(createdAt, s.seq),
    seq: s.seq,
    createdAt,
    updatedAt: resolvedAt || tl[tl.length - 1].at,
    operatorId: s.operatorId,
    operatorName: s.operatorName,
    vehicle: s.vehicle,
    route: s.route,
    garage: garageOf(s.vehicle),
    shift: shiftOf(createdAt),
    stopId: stop?.id ?? s.stopId,
    location: { lat: stop?.lat, lng: stop?.lng, label: stop?.name, source: 'bus position' },
    reportType: s.reportType,
    originalText: s.text,
    inputMode: 'voice',
    hasVoice: true,
    photo: null,
    ai,
    aiJson: toContractJson(ai),
    priority: s.priority,
    department: dep,
    status: s.status,
    assignee: s.assignee || null,
    notes: [],
    timeline: tl,
    resolution: s.status === 'Resolved' ? { note: s.resolution, at: resolvedAt, by: s.assignee } : null,
    demoSeed: true,
  };
}

function freshState(now = Date.now()) {
  return {
    day: dayKey(now),
    seq: FIRST_LIVE_SEQ,
    tickets: seed.reports.map((s) => buildSeedTicket(s, now)),
    scenarioLoaded: false,
    liveCount: 0,
    guardian: emptyGuardian(),
    fleet: emptyFleet(),
    ops: seedOps(now),
  };
}

export function emptyGuardian() {
  return { audit: [], incidents: [], handled: {}, followups: [], sweeps: 0, checks: 0, lastSweep: null, startedAt: Date.now() };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.day !== dayKey()) return null; // new day -> fresh demo
    return { ...s, guardian: s.guardian || emptyGuardian(), fleet: s.fleet || emptyFleet(), ops: s.ops || seedOps() };
  } catch {
    return null;
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    try {
      // Photos can exceed storage quota; keep everything else.
      localStorage.setItem(KEY, JSON.stringify({ ...state, tickets: state.tickets.map((t) => ({ ...t, photo: t.photo ? null : t.photo })) }));
    } catch {
      /* storage unavailable */
    }
  }
}

const LIVE = remote.supabaseEnabled();
const IS_BROWSER = typeof window !== 'undefined';

let state = { ...(load() || freshState()), liveStatus: LIVE ? 'connecting' : 'local' };

let channel = null;
try {
  if (!IS_BROWSER) throw new Error('no channel on the server');
  channel = new BroadcastChannel('smart-ops-ai');
  channel.onmessage = (e) => {
    if (!e.data?.state || e.data.from === TAB) return;
    const before = new Map(state.tickets.map((t) => [t.id, t.status]));
    const prevOps = state.ops;
    const incoming = e.data.state;
    state = incoming;
    notify();
    incoming.tickets.forEach((t) => {
      if (!before.has(t.id)) emit({ type: 'created', ticket: t });
      else if (before.get(t.id) !== 'Resolved' && t.status === 'Resolved') emit({ type: 'resolved', ticket: t });
    });
    diffOps(prevOps, incoming.ops).forEach((ev) => emit({ type: 'ops', ...ev }));
  };
} catch {
  /* BroadcastChannel unsupported */
}

function notify() {
  listeners.forEach((l) => l());
}
function emit(ev) {
  eventListeners.forEach((l) => l(ev));
}
function commit(next, { broadcast = true, fromRemote = false } = {}) {
  const prev = state;
  state = next;
  persist();
  notify();
  if (LIVE && !fromRemote) queueMetaSave(prev, next);
  if (broadcast && channel) {
    try {
      channel.postMessage({ from: TAB, state });
    } catch {
      /* ignore */
    }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onEvent(fn) {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}
export const getState = () => state;
export const isLive = () => LIVE;

// Server-side Guardian: load a state snapshot without persisting or syncing.
export function hydrate(next) {
  state = { ...freshShape(), ...next };
}
function freshShape() {
  return { day: dayKey(), seq: FIRST_LIVE_SEQ, tickets: [], scenarioLoaded: false, liveCount: 0, guardian: emptyGuardian(), fleet: emptyFleet(), ops: emptyOps() };
}

export function useStore(selector = (s) => s) {
  const s = useSyncExternalStore(subscribe, getState, getState);
  return selector(s);
}

export const getTicket = (id) => state.tickets.find((t) => t.id === id);

// ---- used by SMART Ops AI Guardian ----
export const emitEvent = (ev) => emit(ev);
export function emptyFleet() {
  return { extraMiles: {}, extraDays: 0, workOrders: [], woStatus: {}, simulatedDays: 0 };
}
export function setFleet(fn) {
  commit({ ...state, fleet: fn(state.fleet || emptyFleet()) });
}
// Operations communication layer (dispatch, lost & found, detours, field reports).
export function setOps(fn) {
  commit({ ...state, ops: fn(state.ops || emptyOps()) });
}
export function setGuardian(fn) {
  commit({ ...state, guardian: fn(state.guardian || emptyGuardian()) });
}
export function restoreTickets(prev) {
  const byId = new Map(prev.map((t) => [t.id, t]));
  commit({ ...state, tickets: state.tickets.map((t) => byId.get(t.id) || t) });
  prev.forEach((t) => pushRemote(t));
}

// ---------------------------------------------------------------------------
// Live mode (Supabase). One shared demo for every device.
// ---------------------------------------------------------------------------
const metaVersion = { guardian: 0, fleet: 0, control: 0, ops: 0 };
let metaTimer = null;
let pendingMeta = new Set();
let lastResetAt = 0;

const controlOf = (s) => ({ day: s.day, seq: s.seq, scenarioLoaded: !!s.scenarioLoaded, liveCount: s.liveCount || 0, resetAt: lastResetAt });

function queueMetaSave(prev, next) {
  if (prev.guardian !== next.guardian) pendingMeta.add('guardian');
  if (prev.fleet !== next.fleet) pendingMeta.add('fleet');
  if (prev.ops !== next.ops) pendingMeta.add('ops');
  if (prev.seq !== next.seq || prev.scenarioLoaded !== next.scenarioLoaded) pendingMeta.add('control');
  if (!pendingMeta.size) return;
  clearTimeout(metaTimer);
  metaTimer = setTimeout(flushMeta, 250);
}

export async function flushMeta() {
  clearTimeout(metaTimer);
  const keys = [...pendingMeta];
  pendingMeta = new Set();
  await Promise.all(keys.map((k) => {
    metaVersion[k] += 1;
    const value = k === 'control' ? controlOf(state) : state[k];
    return remote.saveMeta(k, value, metaVersion[k]);
  }));
}

function maxSeqToday(tickets) {
  const today = startOfDay();
  return tickets.filter((t) => t.createdAt >= today).reduce((m, t) => Math.max(m, (t.seq || 0) + 1), FIRST_LIVE_SEQ);
}

async function seedRemote(fresh) {
  lastResetAt = Date.now();
  await remote.deleteAllTickets();
  await remote.upsertTickets(fresh.tickets);
  metaVersion.guardian += 1;
  metaVersion.fleet += 1;
  metaVersion.control += 1;
  metaVersion.ops += 1;
  await Promise.all([
    remote.saveMeta('ops', fresh.ops, metaVersion.ops),
    remote.saveMeta('guardian', fresh.guardian, metaVersion.guardian),
    remote.saveMeta('fleet', fresh.fleet, metaVersion.fleet),
    remote.saveMeta('control', controlOf(fresh), metaVersion.control),
  ]);
}

async function loadRemote({ initial = false } = {}) {
  const data = await remote.fetchAll();
  if (!data) {
    commit({ ...state, liveStatus: 'offline' }, { fromRemote: true });
    return false;
  }
  const control = data.meta.control?.value;
  if (!data.tickets.length || control?.day !== dayKey()) {
    // First visitor of the day (or an empty database) seeds the shared demo.
    const fresh = freshState();
    await seedRemote(fresh);
    commit({ ...fresh, liveStatus: 'live' }, { fromRemote: true });
    return true;
  }
  for (const k of ['guardian', 'fleet', 'control', 'ops']) metaVersion[k] = data.meta[k]?.version || 0;
  lastResetAt = control?.resetAt || 0;
  commit(
    {
      ...state,
      day: control.day,
      tickets: data.tickets.sort((a, b) => a.createdAt - b.createdAt),
      guardian: data.meta.guardian?.value || emptyGuardian(),
      fleet: data.meta.fleet?.value || emptyFleet(),
      ops: data.meta.ops?.value || seedOps(),
      seq: Math.max(control.seq || FIRST_LIVE_SEQ, maxSeqToday(data.tickets)),
      scenarioLoaded: !!control.scenarioLoaded,
      liveCount: control.liveCount || 0,
      liveStatus: 'live',
    },
    { fromRemote: true }
  );
  if (!initial) emit({ type: 'reloaded' });
  return true;
}

if (LIVE && IS_BROWSER) {
  (async () => {
    const ok = await loadRemote({ initial: true });
    if (!ok) return;
    remote.subscribeAll({
      onTicket: (t) => {
        const prev = state.tickets.find((x) => x.id === t.id);
        const tickets = prev ? state.tickets.map((x) => (x.id === t.id ? t : x)) : [...state.tickets, t];
        commit({ ...state, tickets, seq: Math.max(state.seq, maxSeqToday([t])) }, { fromRemote: true });
        if (!prev) emit({ type: 'created', ticket: t });
        else if (prev.status !== 'Resolved' && t.status === 'Resolved') emit({ type: 'resolved', ticket: t });
      },
      onTicketDeleted: (id) => {
        if (!id) return;
        commit({ ...state, tickets: state.tickets.filter((t) => t.id !== id) }, { fromRemote: true });
      },
      onMeta: (key, value, version) => {
        if (value == null) { loadRemote(); return; } // row too large for realtime: fetch it
        if (version <= (metaVersion[key] || 0) && key !== 'control') return; // our own write echoing back
        metaVersion[key] = Math.max(metaVersion[key] || 0, version);
        if (key === 'guardian') {
          const known = new Set((state.guardian?.incidents || []).map((i) => i.id));
          const hadSwept = (state.guardian?.sweeps || 0) > 0;
          commit({ ...state, guardian: value }, { fromRemote: true });
          if (hadSwept) (value.incidents || []).filter((i) => !known.has(i.id)).reverse().forEach((incident) => emit({ type: 'guardian', incident }));
        } else if (key === 'fleet') {
          commit({ ...state, fleet: value }, { fromRemote: true });
        } else if (key === 'ops') {
          const prevOps = state.ops;
          commit({ ...state, ops: value }, { fromRemote: true });
          diffOps(prevOps, value).forEach((ev) => emit({ type: 'ops', ...ev }));
        } else if (key === 'control') {
          if (value?.resetAt && value.resetAt !== lastResetAt) {
            lastResetAt = value.resetAt;
            loadRemote(); // another screen reset the demo
          } else {
            commit({ ...state, seq: Math.max(state.seq, value?.seq || 0), scenarioLoaded: !!value?.scenarioLoaded }, { fromRemote: true });
          }
        }
      },
    });
  })();
}

const syncs = new Map();
// Resolves once a ticket created on this screen has reached the shared database.
export const waitForSync = (id) => syncs.get(id) || Promise.resolve();

function pushRemote(t) {
  if (!LIVE || !IS_BROWSER) return;
  syncs.set(t.id, remote.upsertTickets([t]));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
export function createTicket({ text, reportType, inputMode, photo, vehicle, route, operatorId, operatorName, position, ai, location, createdAt }) {
  const now = createdAt || Date.now();
  const seq = Math.max(state.seq, maxSeqToday(state.tickets));
  const id = ticketId(now, seq);
  const loc = location || resolveLocation(text, position);
  const base = ai || classifyLocal({ text, reportType });
  const aiOut = base.recommended_action ? base : { ...base, recommended_action: recommendedAction(base) };
  const dep = aiOut.department;
  const tl = [
    { at: now, label: 'Operator submitted', by: operatorName },
    { at: now + 1500, label: 'AI categorized', by: 'SMART Ops AI' },
    { at: now + 3000, label: `${deptLabel(dep)} notified`, by: 'SMART Ops AI' },
  ];
  const t = {
    id, seq, createdAt: now, updatedAt: now + 3000,
    operatorId, operatorName, vehicle, route,
    garage: garageOf(vehicle), shift: shiftOf(now),
    stopId: loc.stopId, location: { lat: loc.lat, lng: loc.lng, label: loc.label, source: loc.source },
    reportType, originalText: text, inputMode, hasVoice: inputMode !== 'typed' && inputMode !== 'system',
    photo: photo || null,
    ai: aiOut, aiJson: toContractJson(aiOut),
    priority: aiOut.priority, department: dep, status: 'New', assignee: null,
    notes: [], timeline: tl, resolution: null, live: true,
  };
  commit({ ...state, seq: seq + 1, tickets: [...state.tickets, t], liveCount: (state.liveCount || 0) + 1 });
  emit({ type: 'created', ticket: t });
  if (LIVE && IS_BROWSER) syncs.set(t.id, remote.upsertTickets([t]).then(() => flushMeta()));
  return t;
}

export function updateTicket(id, fn, events = []) {
  return mutate(id, fn, events);
}

function mutate(id, fn, events = []) {
  const now = Date.now();
  let updated = null;
  const tickets = state.tickets.map((t) => {
    if (t.id !== id) return t;
    const evs = events.map((e) => ({ at: now, ...e }));
    updated = { ...fn(t), updatedAt: now, timeline: [...t.timeline, ...evs] };
    return updated;
  });
  if (!updated) return null;
  commit({ ...state, tickets });
  pushRemote(updated);
  return updated;
}

export const assignTicket = (id, assignee, by = 'Dispatch') =>
  mutate(id, (t) => ({ ...t, assignee, status: t.status === 'New' ? 'Assigned' : t.status }), [{ label: `Assigned to ${assignee}`, by }]);

export const setPriority = (id, priority, by = 'Dispatch') =>
  mutate(id, (t) => ({ ...t, priority }), [{ label: `Priority changed to ${priority.toUpperCase()}`, by }]);

export const routeTo = (id, department, by = 'Dispatch') =>
  mutate(id, (t) => ({ ...t, department, status: 'New', assignee: null }), [{ label: `Rerouted to ${deptLabel(department)}`, by }]);

export const addNote = (id, text, by = 'Dispatch') =>
  mutate(id, (t) => ({ ...t, notes: [...t.notes, { at: Date.now(), by, text }] }), [{ label: 'Note added', by }]);

export function startWork(id, by) {
  const t = getTicket(id);
  const who = by || t?.assignee || DEPARTMENTS[t?.department]?.crews[0];
  return mutate(
    id,
    (x) => ({ ...x, status: 'In Progress', assignee: x.assignee || who }),
    [
      ...(t && !t.assignee ? [{ label: `Assigned to ${who}`, by: who }] : []),
      { label: DEPARTMENTS[t?.department]?.startLabel || 'Work started', by: who },
    ]
  );
}

export function resolveTicket(id, note, photo, by) {
  const t = getTicket(id);
  const who = by || t?.assignee || 'Dispatch';
  const done = mutate(
    id,
    (x) => ({ ...x, status: 'Resolved', resolution: { note, photo: photo || null, at: Date.now(), by: who } }),
    [{ label: 'Resolved', by: who }]
  );
  if (done) emit({ type: 'resolved', ticket: done });
  return done;
}

export async function resetDemo() {
  const fresh = freshState();
  commit({ ...fresh, liveStatus: state.liveStatus }, { fromRemote: true });
  if (LIVE && IS_BROWSER) await seedRemote(fresh);
}

// ---------------------------------------------------------------------------
// Load Demo Scenario — works with no network / API keys.
// ---------------------------------------------------------------------------
export const DEMO_SCRIPTS = {
  door: 'Rear passenger door on bus 4602 is sticking and won\'t close properly.',
  shelter: 'The shelter at Woodward and Nine Mile has broken glass and overflowing trash.',
  safety: 'Passenger is becoming aggressive near the front of the bus. Supervisor assistance requested.',
  trash: 'Trash can overflowing at Joseph Campau and Caniff, bags on the ground by the stop.',
  warning: 'Amber check engine light came on at Van Dyke and 14 Mile, bus still running normally.',
};

export function demoPhoto(label, kind = 'vehicle') {
  const bg = kind === 'vehicle' ? '#2b3a4f' : '#3d4a3a';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="${bg}"/><g fill="none" stroke="#9fb3c8" stroke-width="6" opacity=".55">${
    kind === 'vehicle'
      ? '<rect x="170" y="70" width="300" height="360" rx="10"/><line x1="320" y1="70" x2="320" y2="430"/><rect x="190" y="95" width="110" height="170"/><rect x="340" y="95" width="110" height="170"/>'
      : '<rect x="110" y="110" width="420" height="260"/><path d="M180 150 L250 230 L210 300 M250 230 L330 210 M330 210 L380 280"/><rect x="430" y="300" width="70" height="90" rx="6"/>'
  }</g><rect x="0" y="420" width="640" height="60" fill="#000" opacity=".45"/><text x="24" y="458" font-family="monospace" font-size="22" fill="#fff">DEMO PHOTO · ${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function loadDemoScenario() {
  if (state.scenarioLoaded) return { already: true, created: [] };
  const now = Date.now();
  const items = [
    { key: 'door', type: 'vehicle', bus: '4602', route: '461', stopId: '1301', op: OPERATOR, minsAgo: 9, photo: demoPhoto('REAR DOOR · BUS 4602') },
    { key: 'shelter', type: 'stop', bus: '4602', route: '461', stopId: '1301', op: OPERATOR, minsAgo: 7, photo: demoPhoto('SHELTER · WOODWARD & 9 MILE', 'stop') },
    { key: 'safety', type: 'safety', bus: '4602', route: '461', stopId: '1301', op: OPERATOR, minsAgo: 5, photo: null },
    { key: 'trash', type: 'stop', bus: '4731', route: '500', stopId: '5012', op: { id: 'DEMO-3144', name: 'Darnell Hayes' }, minsAgo: 3, photo: demoPhoto('TRASH · JOSEPH CAMPAU & CANIFF', 'stop') },
    { key: 'warning', type: 'vehicle', bus: '4490', route: '510', stopId: '940', op: { id: 'DEMO-3021', name: 'Keisha Grant' }, minsAgo: 1, photo: null },
  ];
  const created = items.map((it) => {
    const text = DEMO_SCRIPTS[it.key];
    const s = stopById(it.stopId);
    return createTicket({
      text, reportType: it.type, inputMode: 'voice', photo: it.photo,
      vehicle: it.bus, route: it.route, operatorId: it.op.id, operatorName: it.op.name,
      position: { stopId: it.stopId, lat: s.lat, lng: s.lng, source: 'bus position' },
      createdAt: now - it.minsAgo * MIN,
    });
  });
  commit({ ...state, scenarioLoaded: true });
  return { already: false, created };
}

// ---------------------------------------------------------------------------
// Drafts passed from the report screen to the AI processing screen
// ---------------------------------------------------------------------------
const drafts = new Map();
export function saveDraft(d) {
  const id = Math.random().toString(36).slice(2, 10);
  drafts.set(id, d);
  return id;
}
export const getDraft = (id) => drafts.get(id);

// ---------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------
export const isOpen = (t) => t.status !== 'Resolved' && t.status !== 'Merged';

export function dashboardStats(tickets, now = Date.now()) {
  const today = startOfDay(now);
  const open = tickets.filter(isOpen);
  const resolvedToday = tickets.filter((t) => t.status === 'Resolved' && t.resolution?.at >= today);
  const avgRes = resolvedToday.length
    ? resolvedToday.reduce((s, t) => s + (t.resolution.at - t.createdAt), 0) / resolvedToday.length
    : 0;
  const cat = (c) => open.filter((t) => (Array.isArray(c) ? c.includes(t.ai.category) : t.ai.category === c)).length;
  return {
    open: open.length,
    vehicle: cat('vehicle_defect'),
    facilities: cat('facilities'),
    safety: cat('safety'),
    other: cat(['operations', 'other']),
    resolvedToday: resolvedToday.length,
    avgResolutionMin: Math.round(avgRes / MIN),
    assignedPct: open.length ? Math.round((open.filter((t) => t.status !== 'New').length / open.length) * 100) : 100,
    repeatLocations: patternAlerts(tickets, now).filter((a) => a.kind === 'location').length,
    newCount: open.filter((t) => t.status === 'New').length,
  };
}

// Repeat-problem detection: same vehicle + component within 30 days, or the
// same stop with 3+ facilities reports in the current month.
export function patternAlerts(tickets, now = Date.now()) {
  const alerts = [];
  const since = now - 30 * 86400000;
  const byVehicle = new Map();
  for (const t of tickets) {
    if (t.createdAt < since || t.ai.category !== 'vehicle_defect') continue;
    const k = `${t.vehicle}|${t.ai.subcategory}`;
    if (!byVehicle.has(k)) byVehicle.set(k, []);
    byVehicle.get(k).push(t);
  }
  for (const [k, list] of byVehicle) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.createdAt - b.createdAt);
    const [bus] = k.split('|');
    const span = Math.max(1, Math.round((startOfDay(list[list.length - 1].createdAt) - startOfDay(list[0].createdAt)) / 86400000));
    const c0 = list[list.length - 1].ai.component.replace(/^(Rear|Front|Left|Right) /i, '');
    const comp = c0.charAt(0).toUpperCase() + c0.slice(1).toLowerCase();
    alerts.push({
      id: `veh-${k}`, kind: 'vehicle', key: bus, bus, component: comp,
      title: `Bus ${bus}`, headline: `${comp} issue reported`,
      dates: list.map((t) => fmtDate(t.createdAt)),
      detail: `${list.length} similar reports within ${span} day${span === 1 ? '' : 's'}`,
      recommendation: 'Flag for maintenance review',
      ticketIds: list.map((t) => t.id), latest: list[list.length - 1].createdAt,
    });
  }
  const month = new Date(now);
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const byStop = new Map();
  for (const t of tickets) {
    if (t.createdAt < month.getTime() || t.ai.category !== 'facilities' || !t.stopId) continue;
    if (!byStop.has(t.stopId)) byStop.set(t.stopId, []);
    byStop.get(t.stopId).push(t);
  }
  for (const [stopId, list] of byStop) {
    if (list.length < 3) continue;
    list.sort((a, b) => a.createdAt - b.createdAt);
    alerts.push({
      id: `loc-${stopId}`, kind: 'location', key: stopId, stopId,
      title: stopById(stopId)?.name || `Stop ${stopId}`,
      headline: 'Repeat location',
      dates: list.map((t) => fmtDate(t.createdAt)),
      detail: `${list.length} facilities reports this month`,
      recommendation: 'Review shelter maintenance schedule',
      ticketIds: list.map((t) => t.id), latest: list[list.length - 1].createdAt,
    });
  }
  return alerts.sort((a, b) => b.latest - a.latest);
}
