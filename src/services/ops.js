// SMART Ops AI — operations communication layer.
// Operator ↔ Bus ↔ Terminal ↔ Central Dispatch ↔ Maintenance ↔ Facilities ↔ Customer Service.
// Everything lives in the shared store (state.ops) so every screen sees the
// same messages, lost items, detours and operator field reports in real time.
import opsData from '../data/demoOps.json';
import vehicleData from '../data/demoVehicles.json';
import { getState, setOps, createTicket, emitEvent, isOpen } from './store.js';
import { ROUTES, STOPS, MAP_STOPS, routeById, stopById, nearestStop } from './maps.js';
import { MIN, fmtTime, yymmdd, startOfDay } from '../lib/time.js';
import { OPERATOR } from '../lib/config.js';
import { classifyField, FIELD_KINDS, LF_STAGES } from './opsSeed.js';

export { FIELD_KINDS, LF_STAGES, classifyField };
export const TERMINALS = opsData.terminals;
export const RELIEF = opsData.relief;
export const TIERS = {
  smart: { label: 'SMART Verified', short: 'SMART Verified', rank: 0 },
  partner: { label: 'Partner Access – Pending Verification', short: 'Pending verification', rank: 1 },
  public: { label: 'Public Backup', short: 'Public backup', rank: 2 },
};
export const BUS_ACCESS = { safe: 'Bus access', caution: 'Limited bus access', no: 'Walk-up only' };
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
  const aff = k === 'road_blocked' || k === 'construction' ? affectedBy(lat, lng) : null;
  let report = null;
  setOps((o) => {
    const { id, seq } = nextId(o, 'fr', 'FR');
    report = { id, at: now, bus, route, by, text, lat, lng, kind: k, label: meta.label, routedTo: meta.to, sev: meta.sev, confidence: c.confidence, direction: c.direction, reliefId, suggestedDetour: template?.id || null, affectedRoutes: aff?.routes || null, affectedBuses: aff ? aff.buses.map((x) => x.bus) : null, status: 'Open' };
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
// Detour engine (dispatch-published; production publishes through SMART's CAD/AVL)
// Geometry is built on the route's real shape: the closed section is cut from
// the route itself, the detour runs on a parallel street and rejoins.
// ---------------------------------------------------------------------------
const M_PER_DEG = 111320;
const toXY = (lat, lng, k) => [lng * k * M_PER_DEG, lat * M_PER_DEG];
const toLL = (x, y, k) => [y / M_PER_DEG, x / (k * M_PER_DEG)];

export function polyLen(pts) {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  return t;
}

export function pointAtDist(pts, d) {
  if (!pts?.length) return null;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (acc + len >= d) {
      const t = len ? (d - acc) / len : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    acc += len;
  }
  return pts[pts.length - 1];
}

// Part of a path between two fractions (f0 > f1 returns it reversed).
export function slicePath(path, f0, f1) {
  const rev = f0 > f1;
  const [a, b] = rev ? [f1, f0] : [f0, f1];
  const total = polyLen(path);
  const da = a * total, db = b * total;
  const out = [pointAtDist(path, da)];
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    acc += distM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
    if (acc > da && acc < db) out.push(path[i]);
  }
  out.push(pointAtDist(path, db));
  return rev ? out.reverse() : out;
}

// Offset a polyline sideways by `meters`, toward the given compass side.
function offsetToward(pts, meters, side) {
  const k = Math.cos((pts[0][0] * Math.PI) / 180);
  const xy = pts.map(([la, lo]) => toXY(la, lo, k));
  const [x0, y0] = xy[0], [x1, y1] = xy[xy.length - 1];
  const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  let nx = dy / L, ny = -dx / L; // right-hand normal of travel
  const want = { east: [1, 0], west: [-1, 0], north: [0, 1], south: [0, -1] }[side] || [1, 0];
  if (nx * want[0] + ny * want[1] < 0) { nx = -nx; ny = -ny; }
  return xy.map(([x, y]) => toLL(x + nx * meters, y + ny * meters, k));
}

const CARD = (from, to) => {
  const k = Math.cos((from[0] * Math.PI) / 180);
  const dx = (to[1] - from[1]) * k, dy = to[0] - from[0];
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'east' : 'west') : dy > 0 ? 'north' : 'south';
};
const TURN = (a, b, c) => {
  const k = Math.cos((b[0] * Math.PI) / 180);
  const v1 = [(b[1] - a[1]) * k, b[0] - a[0]], v2 = [(c[1] - b[1]) * k, c[0] - b[0]];
  return v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 'left' : 'right';
};
const ftOrMi = (m) => (m < 300 ? `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft` : `${(m / 1609.34).toFixed(1)} mi`);
export { ftOrMi };

export function planDetour({ templateId, route, fromStop, toStop } = {}) {
  const tpl = DETOUR_TEMPLATES.find((d) => d.id === templateId) || DETOUR_TEMPLATES.find((d) => d.routes.includes(String(route))) || null;
  const r = String(route || tpl?.routes[0]);
  const path = routeById(r)?.path;
  const a = stopById(fromStop || tpl?.fromStop);
  const b = stopById(toStop || tpl?.rejoinStop);
  if (!path?.length || !a || !b) return null;
  const [fwd] = directionsOf(r);
  let fa = along(path, a.lat, a.lng).f, fb = along(path, b.lat, b.lng).f;
  // Travel is in path order (the demo bus runs the forward direction).
  let first = a, last = b;
  if (fa > fb) { [fa, fb] = [fb, fa]; [first, last] = [b, a]; }
  const closed = slicePath(path, fa, fb);
  const side = tpl?.side || 'east';
  const par = offsetToward(closed, 650, side);
  const detourPath = [closed[0], ...par, closed[closed.length - 1]];
  const crossOf = (s) => tpl?.cross?.[s.demoId] || tpl?.cross?.[s.id] || s.name.split('&').pop().trim();
  const main = tpl?.main || first.name.split('&')[0].trim();
  const parallel = tpl?.parallel || 'approved parallel street';
  const v = [closed[0], par[0], par[par.length - 1], closed[closed.length - 1]];
  const prevPt = pointAtDist(slicePath(path, Math.max(0, fa - 0.02), fa), 0) || closed[0];
  const nextPt = pointAt(path, Math.min(1, fb + 0.02));
  const legs = [polyLen([v[0], v[1]]), polyLen(par), polyLen([v[2], v[3]])];
  const steps = [
    { turn: TURN(prevPt, v[0], v[1]), onto: crossOf(first), heading: CARD(v[0], v[1]), at: first.name, pt: v[0] },
    { turn: TURN(v[0], v[1], par[1] || v[2]), onto: parallel, heading: CARD(v[1], v[2]), at: `${crossOf(first)} & ${parallel}`, pt: v[1] },
    { turn: TURN(par[par.length - 2] || v[1], v[2], v[3]), onto: crossOf(last), heading: CARD(v[2], v[3]), at: `${parallel} & ${crossOf(last)}`, pt: v[2] },
    { turn: TURN(v[2], v[3], nextPt), onto: main, heading: CARD(v[3], nextPt), at: last.name, pt: v[3], rejoin: true },
  ].map((st, i) => ({
    ...st,
    text: `${st.turn === 'right' ? 'Turn right' : 'Turn left'} on ${st.onto}${st.rejoin ? `. Rejoin route at Stop ${last.id}` : ''}`,
    then: i < 3 ? ftOrMi(legs[i]) : null,
  }));

  // Stops on the closed section (real GTFS stops when the feed is loaded).
  const seen = new Set();
  const bypassed = MAP_STOPS.filter((st) => (st.routes || []).map(String).includes(r))
    .map((st) => ({ st, a: along(path, st.lat, st.lng) }))
    .filter(({ a: x }) => x.f > fa + 0.002 && x.f < fb - 0.002 && x.off < 90)
    .sort((x, y) => x.a.f - y.a.f)
    .map(({ st }) => ({ name: st.name, pt: [st.lat, st.lng], real: true }))
    .filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
  const closedLen0 = polyLen(closed);
  const fallback = (tpl?.bypassedFallback || []).map((name, i, arr) => ({ name, pt: pointAtDist(closed, closedLen0 * (i + 1) / (arr.length + 1)), real: false }));
  const bypassedList = bypassed.length ? bypassed.slice(0, 8) : fallback;
  const tempNames = tpl?.temporary || [`${parallel} & ${crossOf(first)} (temporary)`, `${parallel} & ${crossOf(last)} (temporary)`];
  const parLen = polyLen(par);
  const temporary = tempNames.map((name, i) => ({ name, pt: pointAtDist(par, parLen * (i + 1) / (tempNames.length + 1)) }));

  // Delay: extra distance at average bus speed + time per turn + temp stops − skipped stops.
  const closedLen = polyLen(closed), detLen = polyLen(detourPath);
  const extraMin = Math.max(0, (detLen - closedLen) / 8 / 60);
  const turnMin = (4 * 40) / 60;
  const stopMin = (temporary.length * 30 - bypassedList.length * 20) / 60;
  const delayMin = Math.max(2, Math.round(extraMin + turnMin + stopMin));

  // Other closures already reported on the detour path (a real check against live data).
  const conflicts = (getState().ops?.field || []).filter((f) => ['road_blocked', 'construction'].includes(f.kind) && along(par, f.lat, f.lng).off < 150);
  const checks = [
    { ok: true, label: 'Matches pre-approved SMART detour plan', detail: tpl?.plan || 'Ad-hoc plan: needs supervisor approval' },
    { ok: true, label: 'Turn restrictions', detail: '4 turns, none marked “No buses / No trucks”' },
    { ok: true, label: 'Clearance', detail: 'No low bridges or underpasses on the path' },
    { ok: true, label: 'Weight limits', detail: 'No posted limits below a loaded 40 ft bus' },
    { ok: true, label: 'Road width & turn radius', detail: 'Arterial lanes; 40 ft bus turn radius fits at all 4 turns' },
    { ok: !conflicts.length, label: 'Construction / other closures', detail: conflicts.length ? `${conflicts.length} operator report(s) on this path — review` : 'No other closures reported on the detour path (live SMART Ops data)' },
  ];
  const rejected = { label: 'Fastest car route (what Google Maps would pick)', detail: 'Cuts through residential side streets: 25 mph, tight corners, speed humps, no bus stops. Rejected for a 40 ft bus.' };

  return {
    templateId: tpl?.id || null, route: r, routes: tpl?.routes || [r], direction: fwd,
    closure: tpl?.closure || `${main} closed between ${crossOf(first)} and ${crossOf(last)}`,
    fromStop: first.id, rejoinStop: last.id, fromName: first.name, rejoinName: last.name,
    closedPath: closed, detourPath, steps, bypassed: bypassedList, temporary, delayMin,
    delayParts: { extraMi: (detLen - closedLen) / 1609.34, extraMin: Math.round(extraMin), turnMin: Math.round(turnMin) },
    checks, rejected, plan: tpl?.plan || null, fa, fb,
  };
}

// Kept for the operator-report flow: the plan Dispatch is offered.
export const recommendedPlan = (report) => {
  const tpl = suggestDetour(report.text, report.route);
  return tpl ? planDetour({ templateId: tpl.id }) : null;
};

// Which routes and buses an operator's road report affects.
export function affectedBy(lat, lng, now = Date.now()) {
  const routes = ROUTES.filter((r) => r.path?.length > 1 && along(r.path, lat, lng).off < 350).map((r) => r.id);
  for (const r of ROUTES) if (r.sharesPathWith && routes.includes(r.sharesPathWith)) routes.push(r.id);
  const uniq = [...new Set(routes)];
  const buses = fleetStatus(now).filter((b) => uniq.includes(b.route));
  return { routes: uniq, buses };
}

export function publishDetour(planOrTemplate, { by = 'Central Dispatch', fromReport = null } = {}) {
  const plan = typeof planOrTemplate === 'string' ? planDetour({ templateId: planOrTemplate }) : planOrTemplate;
  if (!plan) return null;
  const recipients = [...new Set(plan.routes.flatMap((r) => busesOnRoute(r)))];
  const terminals = [...new Set(recipients.map((b) => vehicleOf(b)?.garage).filter(Boolean))];
  const now = Date.now();
  let det = null;
  setOps((o) => {
    const { id, seq } = nextId(o, 'dt', 'DET');
    det = {
      id, at: now, by, fromReport, active: true, recipients, terminals, acks: {},
      delivered: { operators: now, terminals: now, customerService: now + 800, commandCenter: now + 400, riderAlert: 'preview' },
      ...plan, checks: undefined, rejected: undefined,
    };
    return {
      ...o, seq,
      detours: [det, ...o.detours.filter((d) => !(d.active && d.routes.some((r) => plan.routes.includes(r))))],
      field: o.field.map((f) => (f.id === fromReport ? { ...f, status: 'Detour published' } : f)),
    };
  });
  emitEvent({ type: 'ops', kind: 'detour', item: det });
  return det;
}

export function ackDetour(id, bus) {
  setOps((o) => ({ ...o, detours: o.detours.map((d) => (d.id === id && !d.acks?.[bus] ? { ...d, acks: { ...d.acks, [bus]: Date.now() } } : d)) }));
}
export function clearDetour(id, by = 'Central Dispatch') {
  setOps((o) => ({ ...o, detours: o.detours.map((d) => (d.id === id ? { ...d, active: false, clearedAt: Date.now(), clearedBy: by } : d)), drive: o.drive?.detourId === id ? null : o.drive }));
}
export const activeDetourFor = (ops, route) => ops.detours.find((d) => d.active && d.routes.includes(String(route))) || null;

export function riderAlertText(d) {
  return `Route ${d.routes.join('/')} ${d.direction}: ${d.closure}. Buses detour via ${d.steps[1]?.onto || 'a parallel street'}. Stops not served: ${d.bypassed.slice(0, 3).map((b) => b.name).join(', ')}${d.bypassed.length > 3 ? '…' : ''}. Temporary stops: ${d.temporary.map((t) => t.name.replace(' (temporary)', '')).join(', ')}. Expect up to ${d.delayMin} min delay.`;
}

// ---------------------------------------------------------------------------
// Demo drive: plays the bus forward (sped up) so turn-by-turn, the dispatch
// map and restroom options all update live. Production uses AVL position.
// ---------------------------------------------------------------------------
export const DRIVE_SPEED = 55; // m/s of demo time (sped up)

function operatorStart() {
  const route = OPERATOR.route;
  const path = routeById(route)?.path;
  const a = stopById('7010');
  const b = stopById('1045');
  const fa = along(path, a.lat, a.lng).f;
  const fb = along(path, b.lat, b.lng).f;
  return { route, path, f: fa + (fb - fa) * 0.6 };
}

export function drivePlan(ops) {
  const { route, path, f } = operatorStart();
  const det = activeDetourFor(ops, route);
  if (det && det.fa > f) {
    const pre = slicePath(path, f, det.fa);
    const post = slicePath(path, det.fb, Math.min(1, det.fb + 0.05));
    const pts = [...pre, ...det.detourPath.slice(1), ...post.slice(1)];
    const preLen = polyLen(pre);
    let acc = preLen;
    const legLens = [polyLen([det.detourPath[0], det.detourPath[1]]), polyLen(det.detourPath.slice(1, -1)), polyLen(det.detourPath.slice(-2))];
    const maneuvers = det.steps.map((st, i) => {
      const at = i === 0 ? preLen : (acc += legLens[i - 1]);
      return { ...st, dist: at };
    });
    const detLen = polyLen(det.detourPath);
    // Demo pacing: ~14 s to the first turn, ~24 s through the detour, ~8 s after.
    const legs = [{ len: preLen, dur: 14 }, { len: detLen, dur: 24 }, { len: polyLen(post), dur: 8 }];
    return { pts, maneuvers, total: polyLen(pts), detour: det, legs };
  }
  const pts = slicePath(path, f, Math.min(1, f + 0.25));
  const total = polyLen(pts);
  return { pts, maneuvers: [], total, detour: null, legs: [{ len: total, dur: Math.max(20, total / DRIVE_SPEED) }] };
}

function traveledAt(plan, t) {
  let d = 0;
  for (const leg of plan.legs) {
    if (t <= leg.dur) return d + leg.len * (t / leg.dur);
    d += leg.len; t -= leg.dur;
  }
  return d;
}

export function startDrive(bus = OPERATOR.bus) {
  setOps((o) => ({ ...o, drive: { bus, startedAt: Date.now() }, motion: { ...o.motion, [bus]: 'moving' } }));
}
export function stopDrive(bus = OPERATOR.bus) {
  setOps((o) => ({ ...o, drive: o.drive ? { ...o.drive, pausedAt: o.drive.pausedAt || Date.now() } : null, motion: { ...o.motion, [bus]: 'stopped' } }));
}
export function resetDrive(bus = OPERATOR.bus) {
  setOps((o) => ({ ...o, drive: null, motion: { ...o.motion, [bus]: 'stopped' } }));
}

export function driveState(ops, now = Date.now()) {
  const plan = drivePlan(ops);
  const d = ops?.drive;
  const t = d ? ((d.pausedAt || now) - d.startedAt) / 1000 : 0;
  const traveled = Math.min(plan.total, traveledAt(plan, t));
  const pt = pointAtDist(plan.pts, traveled) || plan.pts[0];
  const next = plan.maneuvers.find((m) => m.dist > traveled - 5) || null;
  const idx = next ? plan.maneuvers.indexOf(next) : plan.maneuvers.length;
  return {
    active: !!d, paused: !!d?.pausedAt, traveled, lat: pt[0], lng: pt[1], plan, next, nextIdx: idx,
    toNext: next ? Math.max(0, next.dist - traveled) : null,
    onDetour: plan.detour ? traveled >= (plan.maneuvers[0]?.dist ?? Infinity) && traveled <= (plan.maneuvers[3]?.dist ?? 0) : false,
    done: traveled >= plan.total - 1,
  };
}

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

// Relief options for the operator's route: open + bus access first, then tier, then distance ahead.
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
    .sort((a, b) => (b.usable - a.usable) || (b.ahead - a.ahead) || (TIERS[a.tier]?.rank ?? 3) - (TIERS[b.tier]?.rank ?? 3) || (a.detourNote === 'On your detour path' ? -1 : 0) - (b.detourNote === 'On your detour path' ? -1 : 0) || a.dist - b.dist);
}

// Demo operator position: Bus 4602 northbound on Woodward between 7 Mile and
// 8 Mile (about to reach the Jason Hargrove Transit Center), with the 12 Mile
// area further ahead. During a demo drive it follows the drive, detour included.
export function operatorPosition() {
  const { route, path, f } = operatorStart();
  const [fwd] = directionsOf(route);
  const ops = getState().ops;
  if (ops?.drive) {
    const ds = driveState(ops);
    const a = along(path, ds.lat, ds.lng);
    return { bus: OPERATOR.bus, route, lat: ds.lat, lng: ds.lng, f: a.f, dir: fwd, onDetour: ds.onDetour };
  }
  const pt = pointAt(path, f) || [42.43, -83.11];
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
    const l0 = list[0];
    const step = (st) => l0.chain.find((c) => c.stage === st);
    const custody = l0.terminal ? [
      `${l0.item} · claim ${l0.id}`,
      `Custody: ${l0.status === 'Returned' ? 'returned to customer from' : l0.status === 'Found' ? 'on Bus ' + l0.foundBy + ', heading to' : 'held at'} ${terminalName(l0.terminal)}${l0.shelf ? `, ${l0.shelf}` : ''}`,
      step('Found') ? `Found: Bus ${l0.foundBy} · ${l0.foundWhere} · ${fmtTime(step('Found').at)}` : null,
      step('At Terminal') ? `Checked in: ${fmtTime(step('At Terminal').at)}` : null,
      `Next: ${{ Found: 'terminal check-in', 'At Terminal': 'customer ID check at pickup', 'Customer Verified': 'hand to customer', Returned: 'closed' }[l0.status] || 'driver search'}`,
    ].filter(Boolean).join('\n') : null;
    const head = terminalQ && custody ? custody : `${list.length} matching lost-item report${list.length > 1 ? 's' : ''}:`;
    return { kind: 'lost', text: head, items: lines };
  }

  // Restrooms
  if (/restroom|bathroom|relief|washroom/.test(t)) {
    const pos = bus ? (bus === OPERATOR.bus ? operatorPosition() : busPosition(bus, now)) : operatorPosition();
    const list = reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, now, f: pos.f, dir: pos.dir }).slice(0, 4);
    return {
      kind: 'relief', text: `Relief options ahead of Bus ${pos.bus} (Route ${pos.route}):`,
      items: list.map((r) => ({ label: `${r.name} · ${r.mins} min · ${BUS_ACCESS[r.busPull]} · ${r.status.label} · ${TIERS[r.tier]?.label || ''}`, to: '/dispatch' })),
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
  if (bus && /where|location|position|bus|status/.test(t)) {
    const fs = fleetStatus(now).find((x) => x.bus === bus);
    if (!fs) return { kind: 'bus', text: `Bus ${bus} isn't in the demo fleet.`, items: [] };
    const isDemo = bus === OPERATOR.bus;
    const p = isDemo ? operatorPosition() : fs;
    const near = nearestStopName(p.lat, p.lng);
    const det = activeDetourFor(ops, fs.route);
    const ack = det ? (det.acks?.[bus] ? `acknowledged ${fmtTime(det.acks[bus])}` : 'NOT yet acknowledged') : null;
    const gpsSec = fs.noPingMin ? fs.noPingMin * 60 : 4 + Math.round(hash(`${bus}${Math.floor(now / 15000)}`) * 20);
    const sched = fs.status === 'Held' ? 'held at the garage' : fs.noPingMin ? 'no recent GPS ping' : fs.late > 0 ? `${fs.late} min late` : fs.late < 0 ? `${-fs.late} min early` : 'on schedule';
    const nxt = isDemo ? nextStops(p, 1)[0]?.name : null;
    const lines = [
      `Bus ${bus} · Route ${fs.route} ${fs.dir}${isDemo && ops.drive && !ops.drive.pausedAt ? ' · moving' : fs.layover ? ' · at layover' : ''}`,
      `Location: near ${near}${p.onDetour ? ' (on detour)' : ''}${nxt ? ` · next stop ${nxt}` : ''}`,
      `Last GPS update: ${gpsSec < 60 ? `${gpsSec} sec ago` : `${Math.round(gpsSec / 60)} min ago`}`,
      `Schedule: ${sched}`,
      det ? `Active detour ${det.id}: ${det.closure} · +${det.delayMin} min · ${ack}` : 'No active detour on this route',
      `Garage: ${terminalName(fs.garage)}${fs.openIssues ? ` · ${fs.openIssues} open issue${fs.openIssues > 1 ? 's' : ''}` : ''}`,
    ];
    return {
      kind: 'bus', text: lines.join('\n'),
      items: [{ label: `Open Bus ${bus} fleet record`, to: `/fleet/${bus}` }],
      focus: { lat: p.lat, lng: p.lng },
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
