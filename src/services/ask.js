// "Ask SMART Ops": one question box for every role. Exact operational
// lookups are answered from live data first; anything else goes to Copilot.
import { getState, isOpen, patternAlerts } from './store.js';
import { searchOps } from './ops.js';
import { answerLocal } from './copilot.js';
import { SAFETY_RE, classifyLocal } from './ai.js';
import { fleetStatus } from './ops.js';
import { MIN } from '../lib/time.js';

const PRI = { high: 0, medium: 1, low: 2 };

function busProblem(bus) {
  const s = getState();
  const mine = s.tickets.filter((t) => t.vehicle === bus && t.ai.category !== 'facilities').sort((a, b) => b.createdAt - a.createdAt);
  const open = mine.filter(isOpen).sort((a, b) => PRI[a.priority] - PRI[b.priority] || b.createdAt - a.createdAt);
  if (!mine.length) return { text: `No reported problems on Bus ${bus}.`, actions: [{ label: 'Bus record', to: `/fleet/${bus}` }] };
  const top = open[0] || mine[0];
  const alert = patternAlerts(s.tickets).find((a) => a.kind === 'vehicle' && a.bus === bus && a.ticketIds.includes(top.id))
    || patternAlerts(s.tickets).find((a) => a.kind === 'vehicle' && a.bus === bus);
  let line;
  if (alert) {
    const ts = alert.ticketIds.map((id) => s.tickets.find((t) => t.id === id)).filter(Boolean).map((t) => t.createdAt);
    const days = Math.max(1, Math.round((Math.max(...ts) - Math.min(...ts)) / (1440 * MIN)));
    line = `${top.ai.title} — repeated issue, ${alert.ticketIds.length} reports in ${days} days. Maintenance review recommended.`;
  } else {
    line = `${top.ai.title} — ${top.priority} priority, ${top.status.toLowerCase()}${top.assignee ? ` (${top.assignee})` : ''}.`;
  }
  const more = open.length > 1 ? `\n${open.length - 1} other open issue${open.length > 2 ? 's' : ''} on this bus.` : '';
  return {
    text: `Bus ${bus}: ${line}${open.length ? '' : ' (no open tickets)'}${more}`,
    actions: [{ label: 'OPEN TICKET', to: `/ticket/${top.id}`, primary: true }, { label: 'Bus record', to: `/fleet/${bus}` }],
  };
}

// A question asks about data ("any fights on 4602?"); a statement reports
// something happening ("passengers fighting on 4602"). Speech has no "?".
const QUESTION_RE = /\?|^\W*(what|what's|whats|where|which|who|when|how|is|are|was|were|any|anything|did|does|do|has|have|show|list|tell|find|give)\b/;

const DAY = 1440 * MIN;

// Someone told SMART Ops about a live safety incident. Never answer that with
// a bus's maintenance record: surface the incident and a one-tap report.
function incident(q, bus, mode) {
  const s = getState();
  const now = Date.now();
  const tl = q.toLowerCase();
  const asking = QUESTION_RE.test(tl);
  const safetyOpen = s.tickets.filter((t) => t.ai.category === 'safety' && isOpen(t)).sort((a, b) => b.createdAt - a.createdAt);
  const onBus = bus ? safetyOpen.filter((t) => t.vehicle === bus) : safetyOpen;

  if (asking) {
    if (!onBus.length) return { text: bus ? `No open safety incidents on Bus ${bus}.` : 'No open safety incidents.', actions: bus ? [{ label: 'Bus record', to: `/fleet/${bus}` }] : [] };
    return {
      text: `${onBus.length} open safety incident${onBus.length > 1 ? 's' : ''}${bus ? ` on Bus ${bus}` : ''}:`,
      list: onBus.slice(0, 4).map((t) => `${t.priority.toUpperCase()} · Bus ${t.vehicle} · ${t.ai.title} · ${t.status}${t.assignee ? ` (${t.assignee})` : ''}`),
      actions: [{ label: 'OPEN TICKET', to: `/ticket/${onBus[0].id}`, primary: true }],
    };
  }

  if (!bus) {
    return { text: 'That sounds like a safety incident. Which bus? Say or type the bus number with the report (e.g. "fight on bus 4602").\nIf anyone is in immediate danger, call 911 now.', actions: [] };
  }

  const recent = onBus.find((t) => now - t.createdAt < DAY);
  if (recent) {
    return {
      text: `Already reported: ${recent.ai.title} on Bus ${bus} — ${recent.status.toLowerCase()}${recent.assignee ? `, ${recent.assignee} assigned` : ', supervisor/safety notified'}.\nIf anyone is in immediate danger, call 911 now.`,
      actions: [{ label: 'OPEN TICKET', to: `/ticket/${recent.id}`, primary: true }],
    };
  }

  const fs = fleetStatus(now).find((x) => x.bus === bus);
  if (!fs) return { text: `Bus ${bus} isn't in the demo fleet. Check the bus number and report again.\nIf anyone is in immediate danger, call 911 now.`, actions: [] };
  const ai = classifyLocal({ text: q, reportType: 'safety' });
  return {
    text: `Safety incident on Bus ${bus} (Route ${fs.route}): ${ai.title}.\nIf anyone is in immediate danger, call 911 now.\nTap Report to log it and notify Supervisor / Safety.`,
    alert: true,
    actions: [
      { label: 'REPORT INCIDENT', primary: true, create: { text: q, reportType: 'safety', inputMode: mode === 'voice' ? 'voice' : 'typed', vehicle: bus, route: fs.route, operatorId: null, operatorName: 'Central Dispatch (Ask SMART Ops)', position: { lat: fs.lat, lng: fs.lng }, ai } },
      { label: 'Bus record', to: `/fleet/${bus}` },
    ],
  };
}

export function askSmartOps(q, mode = 'typed') {
  const t = q.toLowerCase();
  const bus = t.match(/\b(\d{4})\b/)?.[1];
  if (SAFETY_RE.test(t)) return incident(q, bus, mode);
  if (bus && /wrong|issue|problem|broken|defect|going on|what'?s up|repair|fix/.test(t)) return busProblem(bus);
  const o = searchOps(q);
  if (o) {
    const items = (o.items || []).filter((i) => i.label);
    const primary = items.find((i) => i.to && i.to !== '/dispatch');
    const showList = o.kind !== 'bus' && !(items.length === 1 && o.text.includes('\n'));
    return { text: o.text, list: showList ? items.slice(0, 4).map((i) => i.label) : [], actions: primary ? [{ label: o.kind === 'bus' ? 'Bus record' : 'Open', to: primary.to, primary: true }] : [], focus: o.focus };
  }
  const c = answerLocal(q);
  const items = c.items || [];
  const first = items.find((i) => i.ticketId || i.bus);
  return {
    text: c.text,
    list: items.slice(0, 4).map((i) => i.label),
    actions: first ? [{ label: first.ticketId ? 'OPEN TICKET' : 'Bus record', to: first.ticketId ? `/ticket/${first.ticketId}` : `/fleet/${first.bus}`, primary: true }] : [],
  };
}

export const SUGGEST = {
  dispatch: ['Where is bus 4602?', "What's wrong with 3987?", 'Which terminal has the lost iPhone?', 'What needs attention right now?'],
  terminal: ['Where is bus 4128?', "What's wrong with 3987?", 'Who hasn’t acknowledged dispatch messages?'],
  customer: ['Did anyone find a blue backpack on Route 461?', 'Which terminal has the lost iPhone?'],
  maintenance: ["What's wrong with 3987?", 'Which buses have repeat defects?', 'Which buses are due for maintenance?'],
  facilities: ['What needs attention right now?', 'Which buses reported potholes today?'],
  admin: ['What needs attention right now?', 'Which buses have repeat defects?', "What's wrong with 3987?"],
};
