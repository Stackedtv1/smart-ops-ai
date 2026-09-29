// SMART Ops AI Copilot — the staff-facing assistant. Answers questions from
// live ticket data and from what Guardian has detected and changed.
import { getState, isOpen, patternAlerts } from './store.js';
import { deptLabel } from '../lib/config.js';
import { GTFS_META } from './maps.js';
import { MIN, fmtTime } from '../lib/time.js';
import { DEVICES, THRESHOLDS } from './guardian.js';

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
    if (!list.length) return { text: `No reports for bus ${bus}.` };
    const o = list.filter(isOpen);
    return { text: `Bus ${bus}: ${list.length} report${list.length > 1 ? 's' : ''} on file, ${o.length} open.`, items: list.slice(0, 6).map(item) };
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
  return { text: `${open.length} open issues, ${hi} high priority. The biggest right now:`, items: list.map(item) };
}

export function snapshotForAI() {
  const s = getState();
  const now = Date.now();
  return {
    now: new Date(now).toISOString(),
    open: s.tickets.filter(isOpen).map((t) => ({ id: t.id, unit: unit(t), route: t.route, category: t.ai.category, title: t.ai.title, priority: t.priority, status: t.status, dept: t.department, assignee: t.assignee, age_min: Math.round(ageMin(t, now)) })),
    repeat: patternAlerts(s.tickets, now).map((a) => ({ title: a.title, detail: a.detail, dates: a.dates })),
    recent_actions: s.guardian.audit.slice(0, 10).map((e) => ({ at: new Date(e.at).toISOString(), title: e.title, why: e.why })),
    devices_offline: DEVICES.filter((d) => (now - d.seen) / MIN >= THRESHOLDS.deviceOfflineMin).map((d) => d.bus),
  };
}
