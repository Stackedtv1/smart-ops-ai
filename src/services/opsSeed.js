// Seed + pure helpers for the operations communication layer (dispatch
// messages, lost & found, field reports, detours). Kept free of store imports
// so store.js can seed it without a circular import.
import { MIN, yymmdd } from '../lib/time.js';

export const LF_STAGES = ['Reported', 'Driver Searching', 'Found', 'At Terminal', 'Customer Verified', 'Returned'];

export const FIELD_KINDS = {
  road_blocked: { label: 'Road blocked', short: 'Road blocked', to: 'Central Dispatch', icon: 'block', sev: 'high' },
  construction: { label: 'Construction', short: 'Construction', to: 'Central Dispatch', icon: 'cone', sev: 'medium' },
  road_hazard: { label: 'Road hazard / pothole', short: 'Hazard', to: 'Central Dispatch → road agency', icon: 'alert', sev: 'medium' },
  restroom_closed: { label: 'Restroom closed / problem', short: 'Restroom', to: 'Relief coordinator + Facilities', icon: 'restroom', sev: 'medium' },
  stop_inaccessible: { label: 'Stop inaccessible', short: 'Stop blocked', to: 'Facilities + Dispatch', icon: 'shelter', sev: 'medium' },
  shelter_damaged: { label: 'Shelter damaged', short: 'Shelter', to: 'Facilities', icon: 'shelter', sev: 'low' },
  safe_parking: { label: 'Safe bus parking', short: 'Safe parking', to: 'Operator Knowledge Map', icon: 'pin', sev: 'low' },
  other: { label: 'Other location note', short: 'Note', to: 'Central Dispatch', icon: 'pin', sev: 'low' },
};

// On-device categorizer for operator location reports. Production swaps in the
// same AI classify function the ticket flow already uses.
export function classifyField(text) {
  const t = ` ${String(text || '').toLowerCase()} `;
  const has = (re) => re.test(t);
  let kind = 'other';
  if (has(/restroom|bathroom|washroom|toilet|relief (room|point)/)) kind = 'restroom_closed';
  else if (has(/safe (place|spot|parking)|bus parking|can park|room to park|layover spot/)) kind = 'safe_parking';
  else if (has(/pothole|debris|sinkhole|ice on|flooded|flooding|downed (line|tree)/)) kind = 'road_hazard';
  else if (has(/construction|lane (shift|closure|closed)|crew working|cones|barrels/)) kind = 'construction';
  else if (has(/(stop|pole|boarding area).{0,30}(blocked|inaccessible|snow|can'?t)|inaccessible|ramp blocked/)) kind = 'stop_inaccessible';
  else if (has(/shelter|glass|bench/)) kind = 'shelter_damaged';
  else if (has(/closed|blocked|closure|police|accident|crash|detour|can'?t get through/)) kind = 'road_blocked';
  const dir = t.match(/\b(north|south|east|west)bound\b/)?.[1];
  return { kind, ...FIELD_KINDS[kind], direction: dir ? `${dir[0].toUpperCase()}${dir.slice(1)}bound` : null, confidence: kind === 'other' ? 0.55 : 0.9 };
}

export function emptyOps() {
  return { messages: [], lost: [], field: [], detours: [], motion: {}, seq: { msg: 1, lf: 1, fr: 1, dt: 1 } };
}

export function seedOps(now = Date.now()) {
  const ago = (m) => now - m * MIN;
  const allBuses = ['4602', '4128', '4210', '3852', '3987', '3990', '4490', '4731', '4415', '4588', '4077', '4721'];
  const acksFor = (ids, at) => Object.fromEntries(ids.map((id, i) => [id, { at: at + (i + 2) * 45000, by: `Bus ${id}` }]));
  const d = yymmdd(now);
  return {
    seq: { msg: 4, lf: 3, fr: 5, dt: 1 },
    motion: {},
    detours: [],
    messages: [
      {
        id: 'MSG-001', at: ago(140), from: 'Central Dispatch', fromKind: 'dispatch', priority: 'normal',
        to: { kind: 'all', label: 'All operators' }, recipients: allBuses,
        text: 'Reminder: report stop and shelter problems in SMART Ops at layover instead of over the radio. Photos only when parked.',
        acks: acksFor(allBuses.filter((b) => b !== '4077' && b !== '3852'), ago(140)),
      },
      {
        id: 'MSG-002', at: ago(42), from: 'Central Dispatch', fromKind: 'dispatch', priority: 'high',
        to: { kind: 'terminal', id: 'macomb', label: 'Macomb Terminal' }, recipients: ['T:macomb'],
        text: 'Bus 4721 held for brake inspection. Send the spare out on Route 494 for the next block.',
        acks: { 'T:macomb': { at: ago(39), by: 'Terminal Supervisor L. Ortiz' } },
      },
      {
        id: 'MSG-003', at: ago(18), from: 'Bus 4588 · Route 261', fromKind: 'operator', fromBus: '4588', priority: 'normal',
        to: { kind: 'dispatch', label: 'Central Dispatch' }, recipients: ['DISPATCH'],
        text: 'Running about 6 minutes late. Heavy boarding at Michigan & Wyoming.', acks: {},
      },
    ],
    lost: [
      {
        id: `LF-${d}-001`, createdAt: ago(185), item: 'Black iPhone, cracked case', category: 'Phone',
        route: '510', direction: 'Northbound', approxAt: ago(200), stopId: '918', customer: 'Customer (name on file)', contact: 'On file',
        status: 'At Terminal', terminal: 'macomb', foundBy: '3990', foundWhere: 'Under a seat, rear of bus', shelf: 'Shelf B-2',
        matches: [{ bus: '3990', route: '510', trip: 'Route 510 Northbound trip', passAt: ago(201), score: 0.9, likelihood: 'High' }],
        responses: { 3990: { found: true, at: ago(160) } },
        chain: [
          { at: ago(185), stage: 'Reported', by: 'Customer Service' },
          { at: ago(184), stage: 'Driver Searching', by: 'SMART Ops AI · 1 bus alerted' },
          { at: ago(160), stage: 'Found', by: 'Bus 3990 operator' },
          { at: ago(95), stage: 'At Terminal', by: 'Macomb Terminal · Shelf B-2' },
        ],
      },
      {
        id: `LF-${d}-002`, createdAt: ago(300), item: 'Ring of keys with blue lanyard', category: 'Keys',
        route: '461', direction: 'Southbound', approxAt: ago(320), stopId: '1120', customer: 'Customer (name on file)', contact: 'On file',
        status: 'Returned', terminal: 'oakland', foundBy: '4602', foundWhere: 'Front seats', shelf: 'Shelf A-1',
        matches: [{ bus: '4602', route: '461', trip: 'Route 461 Southbound trip', passAt: ago(318), score: 0.9, likelihood: 'High' }],
        responses: { 4602: { found: true, at: ago(280) } },
        chain: [
          { at: ago(300), stage: 'Reported', by: 'Customer Service' },
          { at: ago(299), stage: 'Driver Searching', by: 'SMART Ops AI · 1 bus alerted' },
          { at: ago(280), stage: 'Found', by: 'Bus 4602 operator' },
          { at: ago(210), stage: 'At Terminal', by: 'Oakland Terminal · Shelf A-1' },
          { at: ago(70), stage: 'Customer Verified', by: 'Oakland Terminal · ID checked' },
          { at: ago(68), stage: 'Returned', by: 'Oakland Terminal' },
        ],
      },
    ],
    field: [
      { id: 'FR-001', at: ago(52), bus: '4210', route: '462', by: 'DEMO-2213', text: 'Restroom at the Ferndale community center is closed, sign says plumbing repair.', lat: 42.4618, lng: -83.1352, reliefId: 'R-461-B', ...pick(classifyField('restroom closed plumbing')), status: 'Open' },
      { id: 'FR-002', at: ago(75), bus: '4731', route: '500', by: 'DEMO-3144', text: 'Big pothole in the curb lane on Mound just south of 7 Mile.', lat: 42.4300, lng: -83.0283, ...pick(classifyField('pothole')), status: 'Sent to road agency' },
      { id: 'FR-003', at: ago(33), bus: '3987', route: '510', by: 'DEMO-3021', text: 'Pothole at the Van Dyke and 12 Mile stop, front tire dropped hard.', lat: 42.5045, lng: -83.0268, ...pick(classifyField('pothole')), status: 'Open' },
      { id: 'FR-004', at: ago(120), bus: '4415', route: '261', by: 'DEMO-3310', text: 'Construction lane shift on Michigan at Greenfield, right lane closed.', lat: 42.3180, lng: -83.2000, ...pick(classifyField('construction lane closed')), status: 'Reviewed' },
    ],
  };
}

function pick(c) {
  return { kind: c.kind, label: c.label, routedTo: c.to, sev: c.sev, confidence: c.confidence };
}

// What changed between two ops snapshots, for toasts on other screens.
export function diffOps(prev, next) {
  if (!prev || !next) return [];
  const evs = [];
  const had = (list, id) => (list || []).some((x) => x.id === id);
  (next.field || []).forEach((f) => { if (!had(prev.field, f.id)) evs.push({ kind: 'field', item: f }); });
  (next.messages || []).forEach((m) => { if (!had(prev.messages, m.id)) evs.push({ kind: 'message', item: m }); });
  (next.detours || []).forEach((d) => { if (!had(prev.detours, d.id)) evs.push({ kind: 'detour', item: d }); });
  (next.lost || []).forEach((l) => {
    const p = (prev.lost || []).find((x) => x.id === l.id);
    if (!p) evs.push({ kind: 'lost-new', item: l });
    else if (p.status !== l.status) evs.push({ kind: 'lost-stage', item: l });
  });
  return evs;
}
