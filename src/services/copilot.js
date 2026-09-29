// SMART Ops AI Copilot — the staff-facing assistant. Answers questions from
// live ticket data and from what Guardian has detected and changed.
import { getState, isOpen, patternAlerts } from './store.js';
import { deptLabel } from '../lib/config.js';
import { GTFS_META } from './maps.js';
import { MIN, fmtTime } from '../lib/time.js';
import { DEVICES, THRESHOLDS } from './guardian.js';
import { fleetHealth, vehicleHealth, repairHistory } from './fleet.js';
import { fmtDate } from '../lib/time.js';

const unit = (t) => (t.ai.category === 'facilities' ? `Stop ${t.stopId}` : t.vehicle ? `Bus ${t.vehicle}` : 'Unknown bus');
const ageMin = (t, now) => (now - t.createdAt) / MIN;

// ---------------------------------------------------------------------------
// Ask Copilot
// ---------------------------------------------------------------------------
const PRI = { high: 0, medium: 1, low: 2 };
export function answerLocal(q) {
  const s = getState();
  const now = Date.now();
  const open = s.tickets.filter(isOpen);
  const text = q.toLowerCase();
  const item = (t) => ({ ticketId: t.id, label: `${t.priority.toUpperCase()} · ${unit(t)} · ${t.ai.title} · ${t.status}${t.assignee ? ` (${t.assignee})` : ''} · ${Math.round(ageMin(t, now))} min old` });

  const bus = text.match(/\b(\d{4})\b/)?.[1];
  if (bus && /bus|vehicle|\d{4}/.test(text)) {
    const list = s.tickets.filter((t) => t.vehicle === bus).sort((a, b) => b.createdAt - a.createdAt);
    const vh = vehicleHealth(bus, s, now);
    if (!list.length && !vh) return { intent: 'bus', text: `No reports or fleet record for bus ${bus}.` };
    const o = list.filter(isOpen);
    const lines = [];
    if (vh) {
      const r = vh.rec;
      const why = vh.reasons[vh.status]?.[0];
      lines.push(`Bus ${bus} (VIN ${r.vin}) is in ${vh.status}${why ? `: ${why}` : ''}.`);
      lines.push(`Mileage ${r.mileage.toLocaleString()} mi. Next PM ${r.pmRemainingMi < 0 ? `overdue by ${Math.abs(r.pmRemainingMi).toLocaleString()} mi` : `in ${r.pmRemainingMi.toLocaleString()} mi`}.${r.faults.length ? ` Active fault ${r.faults.map((f) => `${f.code} (${f.desc})`).join(', ')}.` : ''}`);
      lines.push(r.openWorkOrders.length ? `Open work order${r.openWorkOrders.length > 1 ? 's' : ''}: ${r.openWorkOrders.map((w) => `${w.id} — ${w.desc} (${w.status.toLowerCase()})`).join('; ')}.` : 'No open work orders.');
      if (vh.repeats.length) lines.push(`Repeat problem: ${vh.repeats.map((a) => `${a.component.toLowerCase()} ${a.detail}`).join('; ')}.`);
      const last = repairHistory(r, s.tickets)[0];
      if (last) lines.push(`Last repair: ${last.desc.replace(/\.$/, '')} (${last.ref}, ${fmtDate(last.at)}).`);
    }
    lines.push(`${o.length} open defect${o.length === 1 ? '' : 's'} in SMART Ops, ${list.length} report${list.length === 1 ? '' : 's'} on file. Maintenance makes the return-to-service call.`);
    return { intent: 'bus', text: lines.join('\n'), items: [...(vh ? [{ bus, label: `Open bus ${bus} fleet record` }] : []), ...o.slice(0, 5).map(item)] };
  }
  if (/high[- ]?priority|\bhigh\b|urgent|critical tickets/.test(text)) {
    const list = open.filter((t) => t.priority === 'high').sort((a, b) => (a.ai.category === 'safety' ? -1 : 0) - (b.ai.category === 'safety' ? -1 : 0) || a.createdAt - b.createdAt);
    const unowned = list.filter((t) => !t.assignee).length;
    return { intent: 'high', text: list.length ? `${list.length} high-priority ticket${list.length > 1 ? 's are' : ' is'} open${unowned ? `, ${unowned} without an owner` : ', all assigned'}:` : 'No high-priority tickets are open right now.', items: list.slice(0, 8).map(item) };
  }
  if (/attention|right now|what should|focus|biggest|most important|priorit/.test(text)) {
    const esc = s.guardian.followups.filter((f) => !f.closed).map((f) => s.tickets.find((t) => t.id === f.ticketId)).filter(Boolean);
    const hi = open.filter((t) => t.priority === 'high' && !esc.some((e) => e.id === t.id));
    const crit = fleetHealth(s, now).filter((h) => h.status === 'Critical Review');
    const parts = [
      `${open.length} open issues, ${open.filter((t) => t.priority === 'high').length} high priority.`,
      esc.length ? `${esc.length} Guardian escalation${esc.length > 1 ? 's are' : ' is'} waiting for a person to accept.` : 'No escalations waiting.',
      crit.length ? `Critical Review: bus ${crit.map((h) => h.rec.bus).join(', ')}.` : '',
    ].filter(Boolean);
    return {
      intent: 'attention',
      text: `${parts.join(' ')} Start here:`,
      items: [
        ...esc.slice(0, 3).map((t) => ({ ticketId: t.id, label: `Escalated · ${unit(t)} · ${t.ai.title} · waiting on ${t.assignee || 'an owner'}` })),
        ...crit.slice(0, 2).map((h) => ({ bus: h.rec.bus, label: `Bus ${h.rec.bus} · Critical Review · ${h.reasons['Critical Review'][0]}` })),
        ...hi.slice(0, 4).map(item),
      ].slice(0, 8),
    };
  }
  if (/\bpm\b|preventive|maintenance due|due for|fleet health|vin|mileage|overdue (pm|maintenance)|critical review|fault code|dtc/.test(text)) {
    const fh = fleetHealth(s, now).filter((h) => h.status !== 'Normal');
    if (!fh.length) return { intent: 'fleet', text: 'Every demo bus is Normal: no PM due, no active faults, no repeat defects.' };
    return {
      intent: 'fleet',
      text: `${fh.length} bus${fh.length === 1 ? ' needs' : 'es need'} maintenance attention (from maintenance records + operator reports):`,
      items: fh.map((h) => ({ bus: h.rec.bus, label: `Bus ${h.rec.bus} · ${h.status} · ${h.reasons[h.status][0]}` })),
    };
  }
  const route = text.match(/route\s*(\d{3})/)?.[1];
  if (route) {
    const list = open.filter((t) => t.route === route).sort((a, b) => PRI[a.priority] - PRI[b.priority]);
    return { text: list.length ? `${list.length} open issue${list.length > 1 ? 's' : ''} on route ${route}.` : `No open issues on route ${route}.`, items: list.map(item) };
  }
  if (/repeat|pattern|recurring|same (defect|problem)/.test(text)) {
    const al = patternAlerts(s.tickets, now);
    if (!al.length) return { text: 'No repeat defects detected in the last 30 days.' };
    return {
      text: `${al.filter((a) => a.kind === 'vehicle').length} bus${al.filter((a) => a.kind === 'vehicle').length === 1 ? '' : 'es'} and ${al.filter((a) => a.kind === 'location').length} stop${al.filter((a) => a.kind === 'location').length === 1 ? '' : 's'} have repeat problems.`,
      items: al.map((a) => ({ ticketId: a.ticketIds[a.ticketIds.length - 1], label: `${a.title} — ${a.kind === 'vehicle' ? a.component.toLowerCase() : 'facilities'}: ${a.detail}` })),
    };
  }
  if (/stall|stuck|overdue|sla|late|waiting|unacknowledged|not started/.test(text)) {
    const list = open.filter((t) => (t.status === 'New' && ageMin(t, now) > THRESHOLDS.newAssignMin) || (t.ai.category === 'safety' && t.status === 'New' && ageMin(t, now) > THRESHOLDS.safetyAckMin) || (t.priority === 'high' && t.status === 'Assigned' && ageMin(t, now) > THRESHOLDS.highStartMin));
    const esc = s.guardian.followups.filter((f) => !f.closed);
    return { text: list.length ? `${list.length} ticket${list.length > 1 ? 's are' : ' is'} past a response threshold; ${esc.length} escalation${esc.length === 1 ? ' is' : 's are'} awaiting acknowledgement.` : 'Nothing is past its response threshold right now.', items: list.map(item) };
  }
  if (/safety|incident|security|aggressive/.test(text)) {
    const list = open.filter((t) => t.ai.category === 'safety');
    return { text: list.length ? `${list.length} open safety report${list.length > 1 ? 's' : ''}. Existing SMART safety procedures apply to each.` : 'No open safety reports.', items: list.map(item) };
  }
  if (/offline|device|tablet|gtfs|feed|data/.test(text)) {
    const off = DEVICES.filter((d) => (now - d.seen) / MIN >= THRESHOLDS.deviceOfflineMin);
    return {
      text: `${DEVICES.length - off.length} of ${DEVICES.length} operator tablets online. ${GTFS_META.live ? `SMART GTFS feed ${GTFS_META.feedVersion} loaded (${GTFS_META.stopCount} stops, valid through ${GTFS_META.feedEnd?.replace(/(\d{4})(\d\d)(\d\d)/, '$2/$3/$1')}).` : 'SMART GTFS feed not loaded; using simplified routes.'}`,
      items: off.map((d) => ({ label: `${d.id} on bus ${d.bus} — offline since ${fmtTime(d.seen)}` })),
    };
  }
  if (/change|did you|audit|fix|corrected|what have you/.test(text)) {
    const a = s.guardian.audit.slice(0, 8);
    return { text: a.length ? `Guardian's last ${a.length} actions:` : 'Guardian has not changed anything yet.', items: a.map((e) => ({ ticketId: e.ticketIds[0], label: `${fmtTime(e.at)} · ${e.title}${e.undone ? ' (undone)' : ''}` })) };
  }
  if (/maintenance|facilit|garage|crew/.test(text)) {
    const dep = /facilit/.test(text) ? 'facilities' : 'maintenance';
    const list = open.filter((t) => t.department === dep).sort((a, b) => PRI[a.priority] - PRI[b.priority] || a.createdAt - b.createdAt);
    return { text: `${list.length} open ${deptLabel(dep)} jobs.`, items: list.slice(0, 8).map(item) };
  }
  // default: biggest unresolved issues
  const list = [...open].sort((a, b) => PRI[a.priority] - PRI[b.priority] || (a.ai.category === 'safety' ? -1 : 0) - (b.ai.category === 'safety' ? -1 : 0) || a.createdAt - b.createdAt).slice(0, 6);
  const hi = open.filter((t) => t.priority === 'high').length;
  return { intent: 'default', text: `${open.length} open issues, ${hi} high priority. The biggest right now:`, items: list.map(item) };
}

export function snapshotForAI() {
  const s = getState();
  const now = Date.now();
  return {
    now: new Date(now).toISOString(),
    open: s.tickets.filter(isOpen).map((t) => ({ id: t.id, unit: unit(t), route: t.route, category: t.ai.category, title: t.ai.title, priority: t.priority, status: t.status, dept: t.department, assignee: t.assignee, age_min: Math.round(ageMin(t, now)) })),
    repeat: patternAlerts(s.tickets, now).map((a) => ({ title: a.title, detail: a.detail, dates: a.dates })),
    recent_actions: s.guardian.audit.slice(0, 10).map((e) => ({ at: new Date(e.at).toISOString(), title: e.title, why: e.why })),
    fleet: fleetHealth(s, now).map((h) => ({ bus: h.rec.bus, vin: h.rec.vin, status: h.status, reasons: [...h.reasons['Critical Review'], ...h.reasons['Attention Required'], ...h.reasons['Maintenance Due']].slice(0, 4), mileage: h.rec.mileage, pm_remaining_mi: h.rec.pmRemainingMi, open_work_orders: h.rec.openWorkOrders.map((w) => `${w.id}: ${w.desc}`), faults: h.rec.faults.map((f) => f.code) })),
    escalations_waiting: s.guardian.followups.filter((f) => !f.closed).map((f) => f.ticketId),
    devices_offline: DEVICES.filter((d) => (now - d.seen) / MIN >= THRESHOLDS.deviceOfflineMin).map((d) => d.bus),
  };
}
