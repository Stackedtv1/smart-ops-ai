// SMART Ops AI — operations communication layer.
// Operator ↔ Bus ↔ Terminal ↔ Central Dispatch ↔ Maintenance ↔ Facilities ↔ Customer Service.
// Everything lives in the shared store (state.ops) so every screen sees the
// same messages, lost items, detours and operator field reports in real time.
import opsData from '../data/demoOps.json';
import vehicleData from '../data/demoVehicles.json';
import { getState, setOps, createTicket, emitEvent, isOpen } from './store.js';
import { ROUTES, STOPS, routeById, stopById, nearestStop } from './maps.js';
import { MIN, fmtTime, yymmdd, startOfDay } from '../lib/time.js';
import { OPERATOR } from '../lib/config.js';
import { classifyField, FIELD_KINDS, LF_STAGES } from './opsSeed.js';

export { FIELD_KINDS, LF_STAGES, classifyField };
export const TERMINALS = opsData.terminals;
export const RELIEF = opsData.relief;
export const DETOUR_TEMPLATES = opsData.detourTemplates;
export const terminalById = (id) => TERMINALS.find((t) => t.id === id);
export const terminalName = (id) => terminalById(id)?.name || id;

const VEHICLES = vehicleData.vehicles;
const OPERATOR_OF = Object.fromEntries(Object.entries(vehicleData.assignments || {}).map(([op, bus]) => [bus, op]));
export const busesOnRoute = (route) => VEHICLES.filter((v) => v.route === String(route)).map((v) => v.fleet_number);
export const vehicleOf = (bus) => VEHICLES.find((v) => v.fleet_number === String(bus));
export const allBuses = () => VEHICLES.map((v) => v.fleet_number);

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------
export function distM(aLat, aLng, bLat, bLng) {
  const k = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(aLat - bLat, (aLng - bLng) * k) * 111320;
}

// Fraction (0..1) along a path of the point closest to lat/lng, plus distance off the path.
export function along(path, lat, lng) {
  if (!path?.length) return { f: 0, off: Infinity };
  const k = Math.cos((lat * Math.PI) / 180);
  let total = 0;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const [aLat, aLng] = path[i - 1];
    const [bLat, bLng] = path[i];
    const len = distM(aLat, aLng, bLat, bLng);
    segs.push({ aLat, aLng, bLat, bLng, len, start: total });
    total += len;
  }
  let best = { d: Infinity, at: 0 };
  for (const s of segs) {
    const ax = s.aLng * k, ay = s.aLat, bx = s.bLng * k, by = s.bLat;
    const px = lng * k, py = lat;
    const dx = bx - ax, dy = by - ay;
    const tt = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const d = Math.hypot(px - (ax + tt * dx), py - (ay + tt * dy)) * 111320;
    if (d < best.d) best = { d, at: s.start + tt * s.len };
  }
  return { f: total ? best.at / total : 0, off: best.d, totalM: total };
}

export function pointAt(path, f) {
  if (!path?.length) return null;
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const len = distM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    segs.push({ a: path[i - 1], b: path[i], len, start: total });
    total += len;
  }
  const target = Math.max(0, Math.min(1, f)) * total;
  const s = segs.find((x) => target <= x.start + x.len) || segs[segs.length - 1];
  const t = s.len ? (target - s.start) / s.len : 0;
  return [s.a[0] + (s.b[0] - s.a[0]) * t, s.a[1] + (s.b[1] - s.a[1]) * t];
}

// Direction names come from the route's own geometry (forward = path order).
export function directionsOf(route) {
  const p = routeById(route)?.path;
  if (!p?.length) return ['Outbound', 'Inbound'];
  const [a, b] = [p[0], p[p.length - 1]];
  const ns = Math.abs(b[0] - a[0]);
  const ew = Math.abs(b[1] - a[1]) * Math.cos((a[0] * Math.PI) / 180);
  if (ns >= ew) return b[0] > a[0] ? ['Northbound', 'Southbound'] : ['Southbound', 'Northbound'];
  return b[1] > a[1] ? ['Eastbound', 'Westbound'] : ['Westbound', 'Eastbound'];
}

export const stopsOnRoute = (route) => {
  const p = routeById(route)?.path;
  return STOPS.filter((s) => s.routes.includes(String(route)))
    .map((s) => ({ ...s, f: along(p, s.lat, s.lng).f }))
    .sort((a, b) => a.f - b.f);
};

// ---------------------------------------------------------------------------
// Simulated service (stands in for GTFS stop_times + AVL vehicle positions)
// ---------------------------------------------------------------------------
const LAYOVER = 8 * MIN;
const schedOf = (route) => opsData.schedule[String(route)] || { headwayMin: 30, runMin: 50 };

function busCycle(bus) {
  const v = vehicleOf(bus);
  const route = v?.route || '461';
  const run = schedOf(route).runMin * MIN;
  const cycle = 2 * run + 2 * LAYOVER;
  const mates = busesOnRoute(route);
  const i = Math.max(0, mates.indexOf(String(bus)));
  const offset = (i * cycle) / Math.max(1, mates.length) + (Number(bus) % 7) * MIN;
  return { route, run, cycle, offset };
}

const serviceStart = (t) => startOfDay(t) + 5 * 60 * MIN;

// Deterministic "schedule adherence" so the demo is stable between refreshes.
function hash(str) {
  let h = 2166136261;
  for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

export function busPosition(bus, now = Date.now()) {
  // The scripted demo bus stays where the operator app shows it.
  if (String(bus) === OPERATOR.bus) return { ...operatorPosition(), layover: false };
  const { route, run, cycle, offset } = busCycle(bus);
  const path = routeById(route)?.path;
  const [fwd, rev] = directionsOf(route);
  const phase = (((now - serviceStart(now) - offset) % cycle) + cycle) % cycle;
  let f, dir, layover = false;
  if (phase < run) { f = phase / run; dir = fwd; }
  else if (phase < run + LAYOVER) { f = 1; dir = fwd; layover = true; }
  else if (phase < 2 * run + LAYOVER) { f = 1 - (phase - run - LAYOVER) / run; dir = rev; }
  else { f = 0; dir = rev; layover = true; }
  const pt = pointAt(path, f) || [42.46, -83.13];
  return { bus: String(bus), route, f, dir, layover, lat: pt[0], lng: pt[1] };
}

export function fleetStatus(now = Date.now()) {
  const s = getState();
  const held = new Set(['4721']);
  return VEHICLES.map((v) => {
    const pos = busPosition(v.fleet_number, now);
    const r = hash(`${v.fleet_number}|${Math.floor(now / (20 * MIN))}`);
    const late = Math.round(r * 10) - 2; // -2..8 min
    const noPing = v.fleet_number === '4077' && r > 0.35;
    const status = held.has(v.fleet_number) ? 'Held' : noPing ? 'No AVL ping' : late >= 5 ? 'Late' : 'On time';
    const checkIn = serviceStart(now) + Math.round(hash(`ci${v.fleet_number}`) * 90) * MIN;
    const open = s.tickets.filter((t) => t.vehicle === v.fleet_number && isOpen(t) && t.ai.category !== 'facilities').length;
    return {
      bus: v.fleet_number, route: v.route, garage: v.garage, operatorId: OPERATOR_OF[v.fleet_number] || null,
      ...pos, late: status === 'Held' ? null : late, status, noPingMin: noPing ? 4 + Math.round(r * 6) : 0,
      checkIn: Math.min(checkIn, now - 20 * MIN), openIssues: open,
    };
  });
}

// When did a given bus pass a stop in a direction, nearest to `at`?
function passTime(bus, stopId, direction, at) {
  const { route, run, cycle, offset } = busCycle(bus);
  const stop = stopById(stopId);
  if (!stop) return null;
  const path = routeById(route)?.path;
  const { f, off } = along(path, stop.lat, stop.lng);
  if (off > 800) return null;
  const [fwd] = directionsOf(route);
  if (String(bus) === OPERATOR.bus && direction === fwd) {
    // Demo bus: derive from where the operator app shows it right now.
    const pos = operatorPosition();
    const tp = Date.now() + (f - pos.f) * run;
    return { tp, tripStart: tp - f * run };
  }
  const base = serviceStart(at) + offset;
  const inTrip = direction === fwd ? f * run : run + LAYOVER + (1 - f) * run;
  const k = Math.round((at - base - inTrip) / cycle);
  let best = null;
  for (const kk of [k - 1, k, k + 1]) {
    const tp = base + kk * cycle + inTrip;
    const tripStart = base + kk * cycle + (direction === fwd ? 0 : run + LAYOVER);
    if (!best || Math.abs(tp - at) < Math.abs(best.tp - at)) best = { tp, tripStart };
  }
  return best;
}

// Lost & Found trip matching: which buses could have carried this passenger?
export function matchTrips({ route, direction, at, stopId }) {
  const stop = stopById(stopId);
  const routes = new Set([String(route)]);
  // Corridor routes sharing the stop (e.g. 461/462 on Woodward) also qualify.
  if (stop) stop.routes.forEach((r) => { if (routeById(r)?.path?.length) routes.add(String(r)); });
  const candidates = [];
  for (const r of routes) {
    const [fwd, rev] = directionsOf(r);
    const dir = direction === fwd || direction === rev ? direction : fwd;
    for (const bus of busesOnRoute(r)) {
      const p = passTime(bus, stopId, dir, at);
      if (!p) continue;
      const diff = Math.abs(p.tp - at) / MIN;
      if (diff > 45) continue;
      const score = Math.max(0.05, 1 - diff / 45) * (String(r) === String(route) ? 1 : 0.85);
      candidates.push({
        bus, route: r, operatorId: OPERATOR_OF[bus] || null,
        trip: `Route ${r} ${dir} · ${fmtTime(p.tripStart)} trip`,
        passAt: p.tp, diffMin: Math.round(diff), score: Math.round(score * 100) / 100,
        likelihood: diff <= 6 ? 'High' : diff <= 15 ? 'Medium' : 'Low',
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 4);
}

// A lost-item report the scripted demo can fill in: a time the demo operator's
// bus really did pass Woodward & Warren northbound on its current trip.
export function demoLostItemDraft(now = Date.now()) {
  const route = OPERATOR.route;
  const [fwd] = directionsOf(route);
  const stopId = '4610';
  // The time Bus 4602 passed Woodward & Warren on its current trip.
  const p = passTime(OPERATOR.bus, stopId, fwd, now);
  const at = Math.min(p?.tp ?? now - 8 * MIN, now - 4 * MIN) - 2 * MIN;
  return { item: 'Blue backpack with laptop', category: 'Bag', route, direction: fwd, stopId, approxAt: Math.round(at / MIN) * MIN, customer: 'Jordan M. (demo customer)', contact: '(313) 555-0142 (demo)' };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export function recipientsFor(to) {
  if (to.kind === 'all') return allBuses();
  if (to.kind === 'route') return VEHICLES.filter((v) => v.route === to.id || routeById(v.route)?.sharesPathWith === to.id || routeById(to.id)?.sharesPathWith === v.route).map((v) => v.fleet_number);
  if (to.kind === 'bus') return [String(to.id)];
  if (to.kind === 'terminal') return [`T:${to.id}`];
  if (to.kind === 'terminals') return TERMINALS.map((t) => `T:${t.id}`);
  if (to.kind === 'dispatch') return ['DISPATCH'];
  return [];
}

export function toLabel(to) {
  if (to.kind === 'all') return 'All operators';
  if (to.kind === 'route') return `Route ${to.id} operators`;
  if (to.kind === 'bus') return `Bus ${to.id}`;
  if (to.kind === 'terminal') return terminalName(to.id);
  if (to.kind === 'terminals') return 'All terminals';
  if (to.kind === 'dispatch') return 'Central Dispatch';
  return '—';
}

const nextId = (o, key, prefix, pad = 3) => {
  const n = o.seq?.[key] || 1;
  return { id: `${prefix}-${String(n).padStart(pad, '0')}`, seq: { ...o.seq, [key]: n + 1 } };
};

export function sendMessage({ to, text, priority = 'normal', from = 'Central Dispatch', fromKind = 'dispatch', fromBus = null, ref = null }) {
  let msg = null;
  setOps((o) => {
    const { id, seq } = nextId(o, 'msg', 'MSG');
    msg = { id, at: Date.now(), from, fromKind, fromBus, priority, to: { ...to, label: toLabel(to) }, recipients: recipientsFor(to), text, acks: {}, ref };
    return { ...o, seq, messages: [msg, ...o.messages] };
  });
  emitEvent({ type: 'ops', kind: 'message', item: msg });
  return msg;
}

export function ackMessage(id, recipient, by) {
  setOps((o) => ({ ...o, messages: o.messages.map((m) => (m.id === id && !m.acks?.[recipient] ? { ...m, acks: { ...m.acks, [recipient]: { at: Date.now(), by } } } : m)) }));
}

export const inboxFor = (ops, recipient) => ops.messages.filter((m) => m.recipients.includes(recipient));
export const unackedFor = (ops, recipient) => inboxFor(ops, recipient).filter((m) => !m.acks?.[recipient]);
export const ackProgress = (m) => {
  const n = m.recipients.length;
  const a = m.recipients.filter((r) => m.acks?.[r]).length;
  return { n, a, pending: m.recipients.filter((r) => !m.acks?.[r]) };
};

// ---------------------------------------------------------------------------
// Bus motion (demo toggle). Production reads speed from AVL / the vehicle CAN bus.
// ---------------------------------------------------------------------------
export const isMoving = (ops, bus) => ops?.motion?.[bus] === 'moving';
export function setMotion(bus, value) {
  setOps((o) => ({ ...o, motion: { ...o.motion, [bus]: value } }));
}

// ---------------------------------------------------------------------------
// Lost & Found
// ---------------------------------------------------------------------------
export function createLostItem(d) {
  const now = Date.now();
  const matches = matchTrips({ route: d.route, direction: d.direction, at: d.approxAt, stopId: d.stopId });
  const alerted = matches.filter((m) => m.likelihood !== 'Low').map((m) => m.bus);
  const targets = alerted.length ? alerted : matches.slice(0, 1).map((m) => m.bus);
  let item = null;
  setOps((o) => {
    const n = o.seq?.lf || 1;
    const id = `LF-${yymmdd(now)}-${String(n).padStart(3, '0')}`;
    item = {
      id, createdAt: now, ...d, status: targets.length ? 'Driver Searching' : 'Reported', matches, alerted: targets,
      responses: {}, terminal: null, foundBy: null, foundWhere: null, shelf: null,
      chain: [
        { at: now, stage: 'Reported', by: 'Customer Service' },
        ...(targets.length ? [{ at: now + 1000, stage: 'Driver Searching', by: `SMART Ops AI · ${targets.length} bus${targets.length > 1 ? 'es' : ''} alerted (${targets.join(', ')})` }] : []),
      ],
    };
    return { ...o, seq: { ...o.seq, lf: n + 1 }, lost: [item, ...o.lost] };
  });
  emitEvent({ type: 'ops', kind: 'lost-new', item });
  return item;
}

const updLost = (id, fn) => {
  let out = null;
  setOps((o) => ({ ...o, lost: o.lost.map((l) => (l.id === id ? (out = fn(l)) : l)) }));
  if (out) emitEvent({ type: 'ops', kind: 'lost-stage', item: out });
  return out;
};

export function driverResponse(id, bus, { found, where, photo }) {
  return updLost(id, (l) => {
    const responses = { ...l.responses, [bus]: { found, at: Date.now(), where: where || null } };
    if (!found) return { ...l, responses, chain: [...l.chain, { at: Date.now(), stage: 'Driver Searching', by: `Bus ${bus}: not found on board` }] };
    const term = vehicleOf(bus)?.garage || 'oakland';
    return {
      ...l, responses, status: 'Found', foundBy: bus, foundWhere: where || 'On board', photo: photo || null, terminal: term,
      chain: [...l.chain, { at: Date.now(), stage: 'Found', by: `Bus ${bus} operator · ${where || 'on board'} · bringing to ${terminalName(term)}` }],
    };
  });
}

export function terminalCheckIn(id, terminal, shelf, by) {
  return updLost(id, (l) => ({ ...l, status: 'At Terminal', terminal, shelf, chain: [...l.chain, { at: Date.now(), stage: 'At Terminal', by: `${by || terminalName(terminal)} · ${shelf}` }] }));
}
export function customerVerified(id, by) {
  return updLost(id, (l) => ({ ...l, status: 'Customer Verified', chain: [...l.chain, { at: Date.now(), stage: 'Customer Verified', by: by || 'Terminal · ID checked' }] }));
}
export function returnItem(id, by) {
  return updLost(id, (l) => ({ ...l, status: 'Returned', chain: [...l.chain, { at: Date.now(), stage: 'Returned', by: by || terminalName(l.terminal) }] }));
}

// Operator found something nobody has reported yet.
export function driverFoundItem({ item, where, bus, route, photo }) {
  const now = Date.now();
  const term = vehicleOf(bus)?.garage || 'oakland';
  let rec = null;
  setOps((o) => {
    const n = o.seq?.lf || 1;
    rec = {
      id: `LF-${yymmdd(now)}-${String(n).padStart(3, '0')}`, createdAt: now, item, category: 'Found on bus', route, direction: null, approxAt: now, stopId: null,
      customer: 'Not yet claimed', contact: '', status: 'Found', matches: [], alerted: [], responses: { [bus]: { found: true, at: now, where } },
      foundBy: bus, foundWhere: where, photo: photo || null, terminal: term, shelf: null,
      chain: [{ at: now, stage: 'Found', by: `Bus ${bus} operator · ${where} · bringing to ${terminalName(term)}` }],
    };
    return { ...o, seq: { ...o.seq, lf: n + 1 }, lost: [rec, ...o.lost] };
  });
  emitEvent({ type: 'ops', kind: 'lost-new', item: rec });
  return rec;
}

export const openLostForBus = (ops, bus) => ops.lost.filter((l) => l.status === 'Driver Searching' && (l.alerted || []).includes(String(bus)) && !l.responses?.[bus]);

// ---------------------------------------------------------------------------
// Operator field reports → Operator Knowledge Map
// ---------------------------------------------------------------------------
export function createFieldReport({ text, bus, route, by, lat, lng, kind }) {
  const c = classifyField(text);
  const k = kind || c.kind;
  const meta = FIELD_KINDS[k];
  const now = Date.now();
  // Attach restroom reports to the nearest relief point.
  let reliefId = null;
  if (k === 'restroom_closed') {
    let best = null;
    for (const r of RELIEF) {
      const d = distM(lat, lng, r.lat, r.lng);
      if (!best || d < best.d) best = { r, d };
    }
    const named = RELIEF.find((r) => text.toLowerCase().includes(r.name.toLowerCase().split(' ')[0]));
    reliefId = (named || (best && best.d < 3000 ? best.r : null))?.id || null;
  }
  const template = k === 'road_blocked' ? suggestDetour(text, route) : null;
  let report = null;
  setOps((o) => {
    const { id, seq } = nextId(o, 'fr', 'FR');
    report = { id, at: now, bus, route, by, text, lat, lng, kind: k, label: meta.label, routedTo: meta.to, sev: meta.sev, confidence: c.confidence, direction: c.direction, reliefId, suggestedDetour: template?.id || null, status: 'Open' };
    return { ...o, seq, field: [report, ...o.field] };
  });
  emitEvent({ type: 'ops', kind: 'field', item: report });
  // Facilities work still flows through the normal ticket system.
  if (k === 'shelter_damaged' || k === 'stop_inaccessible' || (k === 'restroom_closed' && reliefId)) {
    const relief = RELIEF.find((r) => r.id === reliefId);
    createTicket({
      text: relief ? `Operator relief point "${relief.name}" reported: ${text}` : text,
      reportType: 'stop', inputMode: 'voice', vehicle: bus, route, operatorId: by, operatorName: `Bus ${bus} operator`,
      position: { stopId: nearestStop(lat, lng)?.id, lat, lng, source: 'bus GPS' },
    });
  }
  return report;
}

export function setFieldStatus(id, status) {
  setOps((o) => ({ ...o, field: o.field.map((f) => (f.id === id ? { ...f, status } : f)) }));
}

export function suggestDetour(text, route) {
  const t = String(text || '').toLowerCase();
  let best = null;
  for (const d of DETOUR_TEMPLATES) {
    const routeHit = !route || d.routes.includes(String(route));
    const hits = d.match.filter((m) => t.includes(m)).length;
    const score = hits + (routeHit ? 1 : 0);
    if (hits && (!best || score > best.score)) best = { d, score };
  }
  return best?.d || DETOUR_TEMPLATES.find((d) => d.routes.includes(String(route))) || null;
}

// ---------------------------------------------------------------------------
// Detours (dispatch-published; production publishes through SMART's CAD/AVL)
// ---------------------------------------------------------------------------
export function publishDetour(templateId, { by = 'Central Dispatch', fromReport = null } = {}) {
  const tpl = DETOUR_TEMPLATES.find((d) => d.id === templateId);
  if (!tpl) return null;
  const recipients = [...new Set(tpl.routes.flatMap((r) => busesOnRoute(r)))];
  const terminals = [...new Set(recipients.map((b) => vehicleOf(b)?.garage).filter(Boolean))];
  let det = null;
  setOps((o) => {
    const { id, seq } = nextId(o, 'dt', 'DET');
    det = { id, templateId, at: Date.now(), by, fromReport, active: true, recipients, terminals, acks: {}, ...pickTpl(tpl) };
    return {
      ...o, seq,
      detours: [det, ...o.detours.filter((d) => !(d.active && d.templateId === templateId))],
      field: o.field.map((f) => (f.id === fromReport ? { ...f, status: 'Detour published' } : f)),
    };
  });
  emitEvent({ type: 'ops', kind: 'detour', item: det });
  return det;
}

const pickTpl = (t) => ({ routes: t.routes, direction: t.direction, closure: t.closure, closedPath: t.closedPath, detourPath: t.detourPath, steps: t.steps, fromStop: t.fromStop, rejoinStop: t.rejoinStop, bypassed: t.bypassed, temporary: t.temporary, delayMin: t.delayMin });

export function ackDetour(id, bus) {
  setOps((o) => ({ ...o, detours: o.detours.map((d) => (d.id === id && !d.acks?.[bus] ? { ...d, acks: { ...d.acks, [bus]: Date.now() } } : d)) }));
}
export function clearDetour(id, by = 'Central Dispatch') {
  setOps((o) => ({ ...o, detours: o.detours.map((d) => (d.id === id ? { ...d, active: false, clearedAt: Date.now(), clearedBy: by } : d)) }));
}
export const activeDetourFor = (ops, route) => ops.detours.find((d) => d.active && d.routes.includes(String(route))) || null;

// ---------------------------------------------------------------------------
// Relief finder
// ---------------------------------------------------------------------------
const fmtH = (h) => {
  const hh = Math.floor(h) % 24, mm = Math.round((h % 1) * 60);
  const d = new Date(); d.setHours(hh, mm, 0, 0);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: mm ? '2-digit' : undefined });
};

// true / false / null (hours unknown for today)
function openNow(r, now) {
  if (r.open24) return true;
  const d = new Date(now);
  const h = d.getHours() + d.getMinutes() / 60;
  if (r.hoursByDay) {
    const today = r.hoursByDay[d.getDay()];
    if (today === undefined) return null;
    if (today === null) return null; // unknown or unconfirmed for today
    return h >= today[0] && h < today[1];
  }
  if (r.openFrom == null) return null;
  return h >= r.openFrom && h < r.openTo;
}

function closesAt(r, now) {
  if (r.open24) return null;
  const today = r.hoursByDay ? r.hoursByDay[new Date(now).getDay()] : r.openFrom != null ? [r.openFrom, r.openTo] : null;
  return today ? today[1] : null;
}

export function reliefStatus(r, ops, now = Date.now()) {
  const reports = (ops.field || []).filter((f) => f.reliefId === r.id && f.kind === 'restroom_closed' && f.status !== 'Resolved' && now - f.at < 24 * 60 * MIN);
  if (reports.length) return { code: 'closed', label: 'Reported closed', reports };
  if (r.verifyRestroom) return { code: 'verify', label: 'Restroom to confirm', reports };
  const o = openNow(r, now);
  if (o === null) return { code: 'verify', label: 'Hours to verify today', reports };
  if (!o) return { code: 'hours', label: 'Closed now', reports };
  const c = closesAt(r, now);
  const h = new Date(now).getHours() + new Date(now).getMinutes() / 60;
  if (c != null && c - h < 1) return { code: 'open', label: `Open · closes ${fmtH(c)}`, reports, closingSoon: true };
  return { code: 'open', label: r.open24 ? 'Open 24 hours' : `Open until ${fmtH(c)}`, reports };
}

// How long the operator has gone without a relief break, and the stretch ahead.
export function reliefClock(ops, bus, now = Date.now()) {
  const last = ops.lastBreak?.[bus] ?? now - 112 * MIN;
  return { last, minutes: Math.max(0, Math.round((now - last) / MIN)) };
}
export function markBreak(bus) {
  setOps((o) => ({ ...o, lastBreak: { ...(o.lastBreak || {}), [bus]: Date.now() } }));
}

// Relief points laid out along the whole route (0 = path start, 1 = path end).
export const routeRunMin = (route) => schedOf(route).runMin;
export function routeEnds(route) {
  const list = stopsOnRoute(route);
  const [fwd] = directionsOf(route);
  const r = String(route);
  if (r === '461' || r === '462') return fwd === 'Northbound' ? ['Downtown Detroit', 'Troy'] : ['Troy', 'Downtown Detroit'];
  return [list[0]?.name || 'Start', list[list.length - 1]?.name || 'End'];
}

export function routeReliefStrip(route, ops, now = Date.now()) {
  const path = routeById(route)?.path;
  const run = schedOf(route).runMin;
  return RELIEF.filter((r) => r.routes.includes(String(route)))
    .map((r) => {
      const a = along(path, r.lat, r.lng);
      return { ...r, f: a.f, offM: a.off, atMin: Math.round(a.f * run), status: reliefStatus(r, ops, now) };
    })
    .sort((a, b) => a.f - b.f);
}

// Approved relief points for the operator's route, ordered by distance ahead.
export function reliefFor({ route, lat, lng, ops, now = Date.now(), f = null, dir = null }) {
  const det = activeDetourFor(ops, route);
  const path = routeById(route)?.path;
  const [fwd] = directionsOf(route);
  return RELIEF.filter((r) => r.routes.includes(String(route)) || distM(lat, lng, r.lat, r.lng) < 2500)
    .map((r) => {
      const st = reliefStatus(r, ops, now);
      const dist = distM(lat, lng, r.lat, r.lng);
      let detourNote = null;
      if (det) {
        const onDetour = along(det.detourPath, r.lat, r.lng).off < 250;
        const onClosed = along(det.closedPath, r.lat, r.lng).off < 250;
        if (onDetour) detourNote = 'On your detour path';
        else if (onClosed) detourNote = 'Not reachable during detour';
      }
      const usable = st.code === 'open' && r.busPull !== 'no' && detourNote !== 'Not reachable during detour';
      let ahead = true;
      if (f != null && path?.length) {
        const rf = along(path, r.lat, r.lng).f;
        ahead = dir && dir !== fwd ? rf <= f + 0.005 : rf >= f - 0.005;
      }
      return { ...r, status: st, dist, miles: dist / 1609.34, mins: Math.max(1, Math.round((dist / 1609.34) * 3)), detourNote, usable, ahead };
    })
    .sort((a, b) => (b.usable - a.usable) || (b.ahead - a.ahead) || (a.detourNote === 'On your detour path' ? -1 : 0) - (b.detourNote === 'On your detour path' ? -1 : 0) || a.dist - b.dist);
}

// Demo operator position: Bus 4602 northbound on Woodward between 7 Mile and
// 8 Mile, about to reach the Jason Hargrove Transit Center, with the 12 Mile
// area (detour scenario) further ahead.
export function operatorPosition() {
  const route = OPERATOR.route;
  const path = routeById(route)?.path;
  const a = stopById('7010');
  const b = stopById('1045');
  const fa = along(path, a.lat, a.lng).f;
  const fb = along(path, b.lat, b.lng).f;
  const f = fa + (fb - fa) * 0.6;
  const pt = pointAt(path, f) || [a.lat, a.lng];
  const [fwd] = directionsOf(route);
  return { bus: OPERATOR.bus, route, lat: pt[0], lng: pt[1], f, dir: fwd };
}

export function nextStops(pos, n = 4) {
  const list = stopsOnRoute(pos.route);
  const [fwd] = directionsOf(pos.route);
  const ahead = pos.dir === fwd ? list.filter((s) => s.f > pos.f + 0.001) : list.filter((s) => s.f < pos.f - 0.001).reverse();
  return ahead.slice(0, n);
}

// ---------------------------------------------------------------------------
// Central Dispatch search — one box over the whole operation.
// ---------------------------------------------------------------------------
const COLORS = ['black', 'blue', 'red', 'green', 'white', 'gray', 'grey', 'brown', 'pink', 'purple', 'yellow', 'orange', 'silver'];
const ITEMS = ['backpack', 'bag', 'phone', 'iphone', 'wallet', 'keys', 'umbrella', 'laptop', 'purse', 'jacket', 'coat', 'glasses', 'headphones', 'airpods', 'id', 'card'];

export function searchOps(q, now = Date.now()) {
  const s = getState();
  const ops = s.ops;
  const t = ` ${q.toLowerCase().replace(/[?.!,]/g, ' ')} `;
  const bus = t.match(/\b(\d{4})\b/)?.[1];
  const route = t.match(/route\s*(\d{3})/)?.[1];

  // Lost items
  const itemWord = ITEMS.find((w) => t.includes(` ${w}`));
  if (itemWord || /lost|found|left (on|behind)|claim|lf-/.test(t)) {
    const color = COLORS.find((c) => t.includes(` ${c} `));
    const terminalQ = /which terminal|where is|terminal (has|received|got)/.test(t);
    const list = ops.lost.filter((l) => {
      const hay = `${l.item} ${l.category} ${l.id}`.toLowerCase();
      if (itemWord && !hay.includes(itemWord.replace('iphone', 'phone')) && !hay.includes(itemWord)) return false;
      if (color && !hay.includes(color)) return false;
      if (route && l.route !== route) return false;
      return true;
    });
    if (!list.length) return { kind: 'lost', text: `No lost-item reports match${color ? ` "${color}"` : ''}${itemWord ? ` "${itemWord}"` : ''}${route ? ` on Route ${route}` : ''}.`, items: [] };
    const lines = list.map((l) => {
      const where = l.terminal ? ` · ${terminalName(l.terminal)}${l.shelf ? `, ${l.shelf}` : ''}` : '';
      const by = l.foundBy ? ` · found on Bus ${l.foundBy}` : l.alerted?.length ? ` · drivers alerted: ${l.alerted.join(', ')}` : '';
      return { label: `${l.id} · ${l.item} · Route ${l.route} · ${l.status}${by}${where}`, to: '/lost-found', id: l.id };
    });
    const head = terminalQ && list[0].terminal ? `${list[0].item}: ${list[0].status === 'Returned' ? 'returned to the customer from' : 'held at'} ${terminalName(list[0].terminal)}${list[0].shelf ? ` (${list[0].shelf})` : ''}.` : `${list.length} matching lost-item report${list.length > 1 ? 's' : ''}:`;
    return { kind: 'lost', text: head, items: lines };
  }

  // Restrooms
  if (/restroom|bathroom|relief|washroom/.test(t)) {
    const pos = bus ? (bus === OPERATOR.bus ? operatorPosition() : busPosition(bus, now)) : operatorPosition();
    const list = reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, now, f: pos.f, dir: pos.dir }).slice(0, 4);
    return {
      kind: 'relief', text: `Approved operator relief points near Bus ${pos.bus} (Route ${pos.route}):`,
      items: list.map((r) => ({ label: `${r.name} · ${r.miles.toFixed(1)} mi · ${r.status.label}${r.detourNote ? ` · ${r.detourNote}` : ''} · bus pull-in: ${r.busPull === 'safe' ? 'yes' : r.busPull === 'caution' ? 'limited' : 'no'}`, to: '/dispatch' })),
    };
  }

  // Road reports
  if (/pothole|road|hazard|construction|blocked|closure|closed/.test(t)) {
    const today = startOfDay(now);
    const want = /pothole|hazard/.test(t) ? ['road_hazard'] : /construction/.test(t) ? ['construction'] : ['road_blocked', 'construction', 'road_hazard'];
    const list = ops.field.filter((f) => f.at >= today && want.includes(f.kind));
    const fromTickets = s.tickets.filter((x) => x.createdAt >= today && /pothole/.test(x.originalText?.toLowerCase() || '') && want.includes('road_hazard'));
    const buses = [...new Set([...list.map((f) => f.bus), ...fromTickets.map((x) => x.vehicle)])];
    return {
      kind: 'road', text: list.length ? `${buses.length} bus${buses.length === 1 ? '' : 'es'} reported ${want.includes('road_hazard') && want.length === 1 ? 'potholes / road hazards' : 'road issues'} today: ${buses.join(', ')}.` : 'No operator road reports match today.',
      items: list.map((f) => ({ label: `${f.id} · Bus ${f.bus} · Route ${f.route} · ${f.label} · ${fmtTime(f.at)} · “${f.text}”`, to: '/dispatch' })),
    };
  }

  // Detours
  if (/detour/.test(t)) {
    const act = ops.detours.filter((d) => d.active);
    return { kind: 'detour', text: act.length ? `${act.length} active detour${act.length > 1 ? 's' : ''}:` : 'No active detours.', items: act.map((d) => ({ label: `${d.id} · Routes ${d.routes.join('/')} ${d.direction} · ${d.closure} · ${Object.keys(d.acks).length}/${d.recipients.length} buses acknowledged`, to: '/dispatch' })) };
  }

  // Messages / acknowledgement
  if (/ack|acknowledg|message|who hasn/.test(t)) {
    const pend = ops.messages.filter((m) => m.fromKind === 'dispatch').map((m) => ({ m, p: ackProgress(m) })).filter((x) => x.p.pending.length);
    return { kind: 'msg', text: pend.length ? `${pend.length} dispatch message${pend.length > 1 ? 's' : ''} still waiting on acknowledgement:` : 'Every dispatch message has been acknowledged.', items: pend.map(({ m, p }) => ({ label: `${m.id} → ${m.to.label}: ${p.a}/${p.n} acknowledged · waiting on ${p.pending.map((x) => (x.startsWith('T:') ? terminalName(x.slice(2)) : `Bus ${x}`)).join(', ')}`, to: '/dispatch' })) };
  }

  // Where is bus N
  if (bus && /where|location|position|bus/.test(t)) {
    const fs = fleetStatus(now).find((x) => x.bus === bus);
    if (!fs) return { kind: 'bus', text: `Bus ${bus} isn't in the demo fleet.`, items: [] };
    const near = nearestStopName(fs.lat, fs.lng);
    return {
      kind: 'bus', text: `Bus ${bus} · Route ${fs.route} ${fs.dir}${fs.layover ? ' · at layover' : ''} · near ${near} · ${fs.status}${fs.late != null && fs.status !== 'No AVL ping' ? ` (${fs.late > 0 ? `${fs.late} min late` : fs.late < 0 ? `${-fs.late} min early` : 'on schedule'})` : ''}${fs.noPingMin ? ` · last ping ${fs.noPingMin} min ago` : ''}. Garage: ${terminalName(fs.garage)}.`,
      items: [{ label: `Open Bus ${bus} fleet record`, to: `/fleet/${bus}` }],
      focus: { lat: fs.lat, lng: fs.lng },
    };
  }
  return null;
}

export function nearestStopName(lat, lng) {
  let best = null;
  for (const s of STOPS) {
    const d = distM(lat, lng, s.lat, s.lng);
    if (!best || d < best.d) best = { s, d };
  }
  return best ? `${best.s.name}${best.d > 900 ? ` (${(best.d / 1609.34).toFixed(1)} mi)` : ''}` : 'route';
}

export const ROUTE_LIST = ROUTES.filter((r) => r.path?.length > 1);
