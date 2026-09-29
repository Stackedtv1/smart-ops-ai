// SMART Ops AI Guardian — the 24/7 monitoring and automation layer.
// (SMART Ops AI Copilot, in copilot.js, is the staff-facing assistant.)
//
// Watches tickets and system health on a schedule and, for each problem:
//   Detect -> Diagnose -> Correct workflow (or escalate) -> Follow up
// Every change is written to an audit trail with the reason, who was
// notified, and an undo snapshot.
//
// GUARDRAILS (enforced here, not just shown in the UI):
//   Guardian MAY: merge duplicate reports, reroute misfiled tickets,
//   assign unowned work, fill missing fields from system records, raise
//   priority, notify and escalate.
//   Guardian MAY NOT: resolve a vehicle or safety ticket, lower the
//   priority of a vehicle or safety ticket, or state that a bus is repaired
//   or safe to operate. Those always need a qualified human.
//
// In this demo Guardian runs in the browser every 15 seconds while the app
// is open. In production it would run server-side on a schedule.
import vehicleData from '../data/demoVehicles.json';
import { getState, updateTicket, setGuardian, emitEvent, restoreTickets, createTicket, isOpen, patternAlerts, getTicket } from './store.js';
import { DEPARTMENTS, deptLabel } from '../lib/config.js';
import { GTFS_META, MAP_STOPS, stopById } from './maps.js';
import { recommendedAction } from './ai.js';
import { MIN, fmtTime, fmtDate } from '../lib/time.js';

export const GUARDIAN = 'SMART Ops AI Guardian';
export const SWEEP_MS = 15000;
export const THRESHOLDS = {
  safetyAckMin: 10, // safety report with no human acknowledgement
  highStartMin: 45, // high-priority job assigned but not started
  newAssignMin: 15, // any other ticket still unowned
  duplicateWindowHrs: 48,
  repeatCount: 3,
  followUpMin: 2, // demo: accelerated. Production would be 15-30 min.
  deviceOfflineMin: 60,
};

const EXPECTED_DEPT = { vehicle_defect: ['maintenance'], facilities: ['facilities'], safety: ['supervisor', 'safety'], operations: ['operations'], other: ['operations'] };
const ESCALATION = {
  maintenance: ['Maintenance Supervisor', 'Operations Manager'],
  facilities: ['Facilities Supervisor', 'Operations Manager'],
  supervisor: ['Safety Officer on duty', 'Operations Manager'],
  safety: ['Safety Officer on duty', 'Operations Manager'],
  operations: ['Dispatch Supervisor', 'Operations Manager'],
};

// Simulated operator-tablet heartbeats (in production: device check-ins).
const T0 = Date.now();
export const DEVICES = [
  { id: 'TAB-4602', bus: '4602', seen: T0 - 1 * MIN },
  { id: 'TAB-4128', bus: '4128', seen: T0 - 2 * MIN },
  { id: 'TAB-4210', bus: '4210', seen: T0 - 1 * MIN },
  { id: 'TAB-3852', bus: '3852', seen: T0 - 4 * MIN },
  { id: 'TAB-3987', bus: '3987', seen: T0 - 3 * MIN },
  { id: 'TAB-3990', bus: '3990', seen: T0 - 192 * MIN },
  { id: 'TAB-4490', bus: '4490', seen: T0 - 2 * MIN },
  { id: 'TAB-4731', bus: '4731', seen: T0 - 1 * MIN },
  { id: 'TAB-4415', bus: '4415', seen: T0 - 76 * MIN },
  { id: 'TAB-4588', bus: '4588', seen: T0 - 2 * MIN },
  { id: 'TAB-4077', bus: '4077', seen: T0 - 5 * MIN },
  { id: 'TAB-4721', bus: '4721', seen: T0 - 3 * MIN },
];

const chainFor = (t) => {
  const base = ESCALATION[t.department] || ESCALATION.operations;
  const g = (t.garage || '').replace(' Terminal', '');
  return t.department === 'maintenance' && g ? [`${base[0]} (${g})`, base[1]] : base;
};
const unit = (t) => (t.ai.category === 'facilities' ? `Stop ${t.stopId}` : t.vehicle ? `Bus ${t.vehicle}` : 'Unknown bus');
const ageMin = (t, now) => (now - t.createdAt) / MIN;
const lastHumanAction = (t, since) => t.timeline.filter((e) => e.at >= since && e.by !== GUARDIAN && e.by !== 'SMART Ops AI');
const uid = () => Math.random().toString(36).slice(2, 10);

// ---------------------------------------------------------------------------
// Guardrail check. Throws in development if a rule tries something forbidden.
// ---------------------------------------------------------------------------
function guard(action, t, patch = {}) {
  const critical = t.ai.category === 'vehicle_defect' || t.ai.category === 'safety';
  if (critical && patch.status === 'Resolved') throw new Error('Guardian may not resolve vehicle or safety tickets');
  const rank = { low: 0, medium: 1, high: 2 };
  if (critical && patch.priority && rank[patch.priority] < rank[t.priority]) throw new Error('Guardian may not lower priority on vehicle or safety tickets');
  return true;
}

function leastLoadedCrew(dept, tickets) {
  const crews = DEPARTMENTS[dept]?.crews || [];
  const load = (c) => tickets.filter((t) => isOpen(t) && t.assignee === c).length;
  return [...crews].sort((a, b) => load(a) - load(b))[0];
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
function record({ key, rule, kind, ticketIds = [], title, detect, diagnose, correct, notified = [], changes = [], undo = null, followUp = null, humanRequired = false, severity = 'medium', now }) {
  const incident = {
    id: uid(), key, rule, kind, ticketIds, title, severity, at: now,
    stages: { detect, diagnose, correct, followUp: followUp ? followUp.text : 'No follow-up needed.' },
    state: kind === 'escalation' ? 'Awaiting acknowledgement' : kind === 'auto-fix' ? 'Auto-corrected' : kind === 'data' ? 'Needs attention' : kind === 'flag' ? 'Flagged for review' : 'Logged',
    humanRequired,
  };
  const entry = { id: uid(), at: now, incidentId: incident.id, rule, kind, ticketIds, title, why: diagnose, changes, notified, undo, undone: false, humanRequired };
  setGuardian((c) => ({
    ...c,
    handled: { ...c.handled, [key]: now },
    incidents: [incident, ...c.incidents].slice(0, 60),
    audit: [entry, ...c.audit].slice(0, 200),
    followups: followUp ? [...c.followups, { id: uid(), incidentId: incident.id, ticketId: followUp.ticketId, level: 0, since: now, dueAt: now + THRESHOLDS.followUpMin * MIN, chain: followUp.chain, closed: false }] : c.followups,
  }));
  if ((getState().guardian?.sweeps || 0) > 0) emitEvent({ type: 'guardian', incident }); // no toasts for the start-up sweep
  return incident;
}

function log(entry) {
  setGuardian((c) => ({ ...c, audit: [{ id: uid(), undone: false, undo: null, ticketIds: [], notified: [], changes: [], ...entry }, ...c.audit].slice(0, 200) }));
}

const handled = (key) => !!getState().guardian?.handled?.[key];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
function ruleDuplicates(now) {
  const { tickets } = getState();
  const win = THRESHOLDS.duplicateWindowHrs * 60 * MIN;
  const groups = new Map();
  for (const t of tickets) {
    if (t.ai.category !== 'vehicle_defect' || !t.vehicle || now - t.createdAt > win || t.status === 'Merged') continue;
    const k = `${t.vehicle}|${t.ai.subcategory}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  for (const [k, list] of groups) {
    const open = list.filter(isOpen).sort((a, b) => a.createdAt - b.createdAt);
    if (open.length < 2) continue;
    const primary = open[0];
    const dups = open.slice(1);
    const key = `dup:${k}:${dups.map((d) => d.id).join(',')}`;
    if (handled(key)) continue;

    const all = list.sort((a, b) => a.createdAt - b.createdAt);
    const repeat = all.length >= THRESHOLDS.repeatCount;
    const priorFix = all.find((t) => t.status === 'Resolved');
    const prev = [primary, ...dups].map((t) => structuredClone(t));
    const chain = chainFor({ ...primary, department: 'maintenance' });
    const comp = primary.ai.component.toLowerCase();

    for (const d of dups) {
      guard('merge', d, { status: 'Merged' });
      updateTicket(d.id, (x) => ({ ...x, status: 'Merged', mergedInto: primary.id }), [{ label: `Merged into ${primary.id} (duplicate report)`, by: GUARDIAN }]);
    }
    const raise = repeat && primary.priority !== 'high';
    guard('upgrade', primary, raise ? { priority: 'high' } : {});
    updateTicket(
      primary.id,
      (x) => ({
        ...x,
        priority: raise ? 'high' : x.priority,
        department: 'maintenance',
        linkedReports: [...(x.linkedReports || []), ...dups.map((d) => ({ id: d.id, at: d.createdAt, text: d.originalText, by: d.operatorName }))],
        notes: [...x.notes, { at: now, by: GUARDIAN, text: `${dups.length} duplicate report${dups.length > 1 ? 's' : ''} merged. ${all.length} ${comp} reports on bus ${primary.vehicle} in ${THRESHOLDS.duplicateWindowHrs} hours${priorFix ? `; earlier report ${priorFix.id} was closed as "${(priorFix.resolution?.note || '').replace(/\.$/, '')}"` : ''}. Supervisor/maintenance review required before next trip.` }],
      }),
      [
        ...(raise ? [{ label: 'Priority raised to HIGH (repeat defect)', by: GUARDIAN }] : []),
        { label: `${chain[0]} alerted`, by: GUARDIAN },
      ]
    );
    record({
      key, rule: 'duplicate-repeat', kind: 'escalation', severity: 'high', now,
      ticketIds: [primary.id, ...dups.map((d) => d.id)],
      title: `Bus ${primary.vehicle}: ${comp} reported ${all.length} times in ${THRESHOLDS.duplicateWindowHrs} hours`,
      detect: `Bus ${primary.vehicle} has submitted the same ${comp} report ${all.length} times in ${THRESHOLDS.duplicateWindowHrs} hours (${all.map((t) => fmtTime(t.createdAt)).join(', ')}).`,
      diagnose: `${repeat ? 'Repeat high-priority maintenance issue' : 'Duplicate report of an open issue'}${priorFix ? `. The earlier fix ("${(priorFix.resolution?.note || '').replace(/\.$/, '')}") did not hold` : ''}. ${dups.length} open duplicate${dups.length > 1 ? 's' : ''} would split the work.`,
      correct: `Merged ${dups.length} duplicate${dups.length > 1 ? 's' : ''} into ${primary.id}${raise ? ', raised priority to HIGH' : ''}, kept routing to Maintenance, alerted ${chain[0]}.`,
      changes: [...dups.map((d) => `${d.id}: status → Merged`), ...(raise ? [`${primary.id}: priority ${primary.priority.toUpperCase()} → HIGH`] : []), `${primary.id}: linked ${dups.length} report(s)`],
      notified: [chain[0], primary.assignee].filter(Boolean),
      undo: { tickets: prev },
      followUp: { ticketId: primary.id, chain, text: `Watching for maintenance to start work. If not acknowledged in ${THRESHOLDS.followUpMin} min (demo timer), escalate to ${chain[1]}.` },
      humanRequired: true,
    });
    setGuardian((c) => ({ ...c, handled: { ...c.handled, [`repeat:${k}`]: now } }));
  }
}

function ruleMisrouted(now) {
  for (const t of getState().tickets) {
    if (!isOpen(t)) continue;
    const ok = EXPECTED_DEPT[t.ai.category] || ['operations'];
    if (ok.includes(t.department)) continue;
    if (t.timeline.some((e) => e.label.startsWith('Rerouted') && e.by !== GUARDIAN)) continue; // a human chose this
    const key = `route:${t.id}:${t.department}`;
    if (handled(key)) continue;
    const to = ok[0];
    const prev = structuredClone(t);
    updateTicket(t.id, (x) => ({ ...x, department: to, assignee: null, status: 'New' }), [{ label: `Rerouted to ${deptLabel(to)} (was ${deptLabel(t.department)})`, by: GUARDIAN }]);
    record({
      key, rule: 'misrouted', kind: 'auto-fix', now, ticketIds: [t.id],
      title: `${unit(t)}: ${t.ai.title.toLowerCase()} was routed to ${deptLabel(t.department)}`,
      detect: `${t.id} is a ${t.ai.category === 'facilities' ? 'stop/shelter' : t.ai.category} issue sitting in the ${deptLabel(t.department)} queue.`,
      diagnose: `"${t.originalText}" describes ${t.ai.component.toLowerCase()}, which ${deptLabel(to)} handles. Left here it would wait in the wrong queue.`,
      correct: `Rerouted to ${deptLabel(to)} and notified the ${deptLabel(to)} queue.`,
      changes: [`department: ${deptLabel(t.department)} → ${deptLabel(to)}`],
      notified: [`${deptLabel(to)} queue`],
      undo: { tickets: [prev] },
    });
  }
}

function ruleMissingInfo(now) {
  const assignments = vehicleData.assignments || {};
  for (const t of getState().tickets) {
    if (!isOpen(t) || t.ai.category !== 'vehicle_defect' || t.vehicle) continue;
    const key = `missing:${t.id}`;
    if (handled(key)) continue;
    const bus = assignments[t.operatorId];
    const prev = structuredClone(t);
    if (bus) {
      updateTicket(t.id, (x) => ({ ...x, vehicle: bus }), [{ label: `Bus number filled in: ${bus} (from operator sign-on)`, by: GUARDIAN }]);
      record({
        key, rule: 'missing-info', kind: 'auto-fix', now, ticketIds: [t.id],
        title: `${t.id}: vehicle defect reported with no bus number`,
        detect: `${t.id} ("${t.originalText}") has no bus number, so maintenance can't find the vehicle.`,
        diagnose: `Operator ${t.operatorName} (${t.operatorId}) is signed on to bus ${bus} today per the vehicle assignment record.`,
        correct: `Filled in bus ${bus} from the sign-on record and told the operator which bus was used.`,
        changes: [`vehicle: (blank) → ${bus}`],
        notified: [t.operatorName],
        undo: { tickets: [prev] },
      });
    } else {
      record({
        key, rule: 'missing-info', kind: 'escalation', now, ticketIds: [t.id],
        title: `${t.id}: vehicle defect with no bus number`,
        detect: `${t.id} has no bus number and no sign-on record to recover it from.`,
        diagnose: 'Maintenance cannot act without the vehicle.',
        correct: `Sent a request to ${t.operatorName} to confirm the bus number.`,
        notified: [t.operatorName, 'Dispatch'],
        humanRequired: true,
      });
    }
  }
}

function ruleStalled(now) {
  const { tickets, guardian } = getState();
  const watched = new Set(guardian.followups.filter((f) => !f.closed).map((f) => f.ticketId));
  for (const t of tickets) {
    if (!isOpen(t) || watched.has(t.id)) continue;
    const age = ageMin(t, now);
    const chain = chainFor(t);

    if (t.ai.category === 'safety' && t.status === 'New' && age > THRESHOLDS.safetyAckMin) {
      const key = `safety-ack:${t.id}`;
      if (handled(key)) continue;
      updateTicket(t.id, (x) => x, [{ label: `Escalated to ${chain[0]} (no acknowledgement in ${Math.round(age)} min)`, by: GUARDIAN }]);
      record({
        key, rule: 'sla-safety', kind: 'escalation', severity: 'high', now, ticketIds: [t.id],
        title: `${unit(t)}: safety report unacknowledged for ${Math.round(age)} min`,
        detect: `${t.id} (${t.ai.title.toLowerCase()}) has been New for ${Math.round(age)} minutes. Safety reports should be acknowledged within ${THRESHOLDS.safetyAckMin}.`,
        diagnose: 'No supervisor has picked it up. The AI does not replace emergency procedures; it makes sure a person owns the response.',
        correct: `Escalated to ${chain[0]}.`,
        notified: [chain[0]],
        followUp: { ticketId: t.id, chain, text: `If no one acknowledges in ${THRESHOLDS.followUpMin} min (demo timer), escalate to ${chain[1]}.` },
        humanRequired: true,
      });
      continue;
    }

    if (t.priority === 'high' && t.status === 'Assigned' && age > THRESHOLDS.highStartMin) {
      const key = `high-start:${t.id}`;
      if (handled(key)) continue;
      updateTicket(t.id, (x) => x, [{ label: `Escalated to ${chain[0]} (assigned ${Math.round(age)} min, not started)`, by: GUARDIAN }]);
      record({
        key, rule: 'sla-high', kind: 'escalation', now, ticketIds: [t.id],
        title: `${unit(t)}: high-priority ${t.ai.title.toLowerCase()} not started after ${Math.round(age)} min`,
        detect: `${t.id} is HIGH priority, assigned to ${t.assignee}, and work hasn't started after ${Math.round(age)} minutes (threshold ${THRESHOLDS.highStartMin}).`,
        diagnose: `${t.assignee} may be tied up. ${recommendedAction(t.ai)}`,
        correct: `Escalated to ${chain[0]} to confirm who takes it.`,
        notified: [chain[0], t.assignee],
        followUp: { ticketId: t.id, chain, text: `If still not started in ${THRESHOLDS.followUpMin} min (demo timer), escalate to ${chain[1]}.` },
        humanRequired: true,
      });
      continue;
    }

    if (t.status === 'New' && t.ai.category !== 'safety' && age > THRESHOLDS.newAssignMin) {
      const key = `assign:${t.id}:${t.department}`;
      if (handled(key)) continue;
      const crew = leastLoadedCrew(t.department, tickets);
      if (!crew) continue;
      const prev = structuredClone(t);
      updateTicket(t.id, (x) => ({ ...x, assignee: crew, status: 'Assigned' }), [{ label: `Assigned to ${crew} (least loaded crew)`, by: GUARDIAN }]);
      record({
        key, rule: 'unowned', kind: 'auto-fix', now, ticketIds: [t.id],
        title: `${unit(t)}: ${t.ai.title.toLowerCase()} unassigned for ${Math.round(age)} min`,
        detect: `${t.id} has had no owner for ${Math.round(age)} minutes (threshold ${THRESHOLDS.newAssignMin}).`,
        diagnose: `${deptLabel(t.department)} has capacity: ${crew} has the fewest open jobs.`,
        correct: `Assigned to ${crew}.`,
        changes: [`assignee: (none) → ${crew}`, 'status: New → Assigned'],
        notified: [crew],
        undo: { tickets: [prev] },
      });
    }
  }
}

function ruleRepeatDefects(now) {
  for (const a of patternAlerts(getState().tickets, now)) {
    if (a.kind !== 'vehicle') continue;
    const sub = getTicket(a.ticketIds[a.ticketIds.length - 1])?.ai.subcategory;
    if (handled(`repeat:${a.bus}|${sub}`) || handled(`flag:${a.id}`)) continue;
    const latest = [...a.ticketIds].reverse().map(getTicket).find((t) => t && isOpen(t));
    if (!latest) continue;
    updateTicket(latest.id, (x) => ({ ...x, notes: [...x.notes, { at: now, by: GUARDIAN, text: `Repeat defect: ${a.ticketIds.length} ${a.component.toLowerCase()} reports on bus ${a.bus} (${a.dates.join(', ')}). Flagged for maintenance review.` }] }), [{ label: 'Flagged for maintenance review (repeat defect)', by: GUARDIAN }]);
    record({
      key: `flag:${a.id}`, rule: 'repeat-defect', kind: 'flag', now, ticketIds: [latest.id, ...a.ticketIds.filter((x) => x !== latest.id)],
      title: `Bus ${a.bus}: ${a.component.toLowerCase()} — ${a.detail}`,
      detect: `${a.ticketIds.length} ${a.component.toLowerCase()} reports on bus ${a.bus}: ${a.dates.join(', ')}.`,
      diagnose: 'Pattern suggests the underlying cause has not been fixed. Guardian identifies the pattern; repair decisions stay with maintenance.',
      correct: `Flagged ${latest.id} for maintenance review and notified the Maintenance Supervisor.`,
      notified: ['Maintenance Supervisor'],
      humanRequired: true,
    });
  }
}

function ruleDataHealth(now) {
  if (!GTFS_META.live) {
    if (!handled('gtfs:fallback')) record({
      key: 'gtfs:fallback', rule: 'data-gtfs', kind: 'data', now, title: 'SMART GTFS feed not loaded',
      detect: 'The last build could not download the SMART GTFS feed.',
      diagnose: 'The map is showing simplified route lines and stop IDs may not match SMART records.',
      correct: 'Notified the data team. The next deploy retries the feed automatically.',
      notified: ['Data team'], humanRequired: true,
    });
  } else {
    const end = GTFS_META.feedEnd ? new Date(`${GTFS_META.feedEnd.slice(0, 4)}-${GTFS_META.feedEnd.slice(4, 6)}-${GTFS_META.feedEnd.slice(6, 8)}T23:59:00`) : null;
    if (end && end - now < 21 * 86400000 && !handled('gtfs:expiring')) record({
      key: 'gtfs:expiring', rule: 'data-gtfs', kind: 'data', now, title: `SMART GTFS feed expires ${fmtDate(end.getTime())}`,
      detect: `Feed ${GTFS_META.feedVersion} is valid through ${fmtDate(end.getTime())}.`,
      diagnose: 'After that date, stops and routes on tickets may not match the published schedule.',
      correct: 'Notified the data team to confirm the next feed is published.', notified: ['Data team'], humanRequired: true,
    });
    const ids = new Set(MAP_STOPS.map((s) => String(s.id)));
    const bad = getState().tickets.filter((t) => isOpen(t) && t.stopId && !ids.has(String(t.stopId)));
    const key = `gtfs:stops:${bad.map((t) => t.id).join(',')}`;
    if (bad.length && !handled(key)) record({
      key, rule: 'data-stop-id', kind: 'data', now, ticketIds: bad.map((t) => t.id),
      title: `${bad.length} open ticket${bad.length > 1 ? 's' : ''} reference stop IDs not in the current SMART feed`,
      detect: `Stop ID${bad.length > 1 ? 's' : ''} ${[...new Set(bad.map((t) => t.stopId))].join(', ')} ${bad.length > 1 ? 'are' : 'is'} not in feed ${GTFS_META.feedVersion}.`,
      diagnose: 'The stop may have been renumbered or removed in the September service change, or the report used an old stop number.',
      correct: 'Flagged for the data team. Tickets stay open with their GPS location, so crews can still find them.',
      notified: ['Data team'], humanRequired: true,
    });
  }
  for (const d of DEVICES) {
    const off = (now - d.seen) / MIN;
    if (off < THRESHOLDS.deviceOfflineMin) continue;
    const key = `device:${d.id}`;
    if (handled(key)) continue;
    record({
      key, rule: 'device-offline', kind: 'data', now, title: `Operator tablet on bus ${d.bus} offline ${Math.round(off)} min`,
      detect: `${d.id} (bus ${d.bus}) last checked in at ${fmtTime(d.seen)}.`,
      diagnose: 'Bus is scheduled in service. Reports from this bus would fall back to paper until the tablet reconnects.',
      correct: 'Opened an IT ticket and notified the garage. Operator reminded that radio/paper reporting still applies.',
      notified: ['Garage IT', `Operator on bus ${d.bus}`], humanRequired: true,
    });
  }
}

function ruleFollowUps(now) {
  const c = getState().guardian;
  for (const f of c.followups.filter((x) => !x.closed)) {
    const t = getTicket(f.ticketId);
    if (!t) continue;
    const acted = !isOpen(t) || t.status === 'In Progress' || lastHumanAction(t, f.since).length > 0;
    if (acted) {
      const who = lastHumanAction(t, f.since).slice(-1)[0]?.by || t.assignee || 'staff';
      setGuardian((cc) => ({
        ...cc,
        followups: cc.followups.map((x) => (x.id === f.id ? { ...x, closed: true } : x)),
        incidents: cc.incidents.map((i) => (i.id === f.incidentId ? { ...i, state: 'Acknowledged', stages: { ...i.stages, followUp: `Acknowledged by ${who} at ${fmtTime(now)}. Follow-up closed.` } } : i)),
      }));
      log({ at: now, rule: 'follow-up', kind: 'follow-up', ticketIds: [t.id], title: `${t.id} acknowledged by ${who}`, why: 'Follow-up check found human action on the ticket.', changes: [] });
      continue;
    }
    if (now < f.dueAt) continue;
    const next = f.chain[f.level + 1];
    if (!next) {
      setGuardian((cc) => ({ ...cc, followups: cc.followups.map((x) => (x.id === f.id ? { ...x, closed: true } : x)) }));
      continue;
    }
    updateTicket(t.id, (x) => x, [{ label: `Escalated to ${next} (no acknowledgement after follow-up)`, by: GUARDIAN }]);
    setGuardian((cc) => ({
      ...cc,
      followups: cc.followups.map((x) => (x.id === f.id ? { ...x, level: x.level + 1, since: now, dueAt: now + THRESHOLDS.followUpMin * MIN } : x)),
      incidents: cc.incidents.map((i) => (i.id === f.incidentId ? { ...i, state: `Escalated to ${next}`, stages: { ...i.stages, followUp: `No acknowledgement by ${fmtTime(now)}. Escalated to ${next}.` } } : i)),
    }));
    log({ at: now, rule: 'follow-up', kind: 'escalation', ticketIds: [t.id], title: `${t.id} escalated to ${next}`, why: `No human action since ${fmtTime(f.since)}.`, notified: [next], changes: [], humanRequired: true });
    emitEvent({ type: 'guardian', incident: { title: `${unit(t)}: escalated to ${next}`, severity: 'high', kind: 'escalation', ticketIds: [t.id] } });
  }
}

// ---------------------------------------------------------------------------
export function sweep() {
  const now = Date.now();
  const rules = [ruleDataHealth, ruleMisrouted, ruleMissingInfo, ruleDuplicates, ruleRepeatDefects, ruleStalled, ruleFollowUps];
  for (const r of rules) {
    try {
      r(now);
    } catch (e) {
      console.error('[guardian]', r.name, e);
    }
  }
  const open = getState().tickets.filter(isOpen).length;
  setGuardian((c) => ({ ...c, sweeps: (c.sweeps || 0) + 1, checks: (c.checks || 0) + rules.length * Math.max(1, open), lastSweep: now }));
}

let timer = null;
export function startGuardian() {
  if (timer) return () => {};
  setTimeout(sweep, 1200);
  timer = setInterval(sweep, SWEEP_MS);
  return () => {
    clearInterval(timer);
    timer = null;
  };
}

export function undoEntry(entryId, by = 'Dispatch') {
  const c = getState().guardian;
  const e = c.audit.find((x) => x.id === entryId);
  if (!e?.undo || e.undone) return;
  restoreTickets(e.undo.tickets);
  setGuardian((cc) => ({
    ...cc,
    audit: [{ id: uid(), at: Date.now(), rule: 'undo', kind: 'undo', ticketIds: e.ticketIds, title: `Undone: ${e.title}`, why: `Reverted by ${by}.`, changes: [], notified: [], undo: null, undone: false }, ...cc.audit.map((x) => (x.id === entryId ? { ...x, undone: true } : x))],
    incidents: cc.incidents.map((i) => (i.id === e.incidentId ? { ...i, state: `Undone by ${by}` } : i)),
    followups: cc.followups.map((f) => (f.incidentId === e.incidentId ? { ...f, closed: true } : f)),
  }));
}

// Live scenario: bus 4721 submits the same brake warning a third time.
export function runBrakeScenario() {
  const s = stopById('4940');
  const t = createTicket({
    text: 'Brake warning light is on again, third time this week on 4721.',
    reportType: 'vehicle', inputMode: 'voice', photo: null,
    vehicle: '4721', route: '494', operatorId: 'DEMO-3377', operatorName: 'Victor Sims',
    position: { stopId: s?.id, lat: s?.lat, lng: s?.lng, source: 'bus position' },
  });
  setTimeout(sweep, 2500);
  return t;
}

