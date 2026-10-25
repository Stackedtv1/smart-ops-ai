// Operator voice assistant: the operator taps once and talks. The AI works out
// what they want (restroom, navigation, dispatch, report, emergency) and does it,
// answering out loud so eyes stay on the road.
import { OPERATOR } from '../lib/config.js';
import { getState, createTicket, saveDraft } from './store.js';
import { classifyLocal } from './ai.js';
import {
  operatorPosition, reliefFor, activeDetourFor, nextStops, sendMessage, createFieldReport, isMoving,
} from './ops.js';

const EMERGENCY_RE = /\b(emergency|911|help me|need help now|gun|knife|weapon|shot|shooting|stab|stabbed|fight|fighting|fought|attack|attacked|assault|assaulted|punch|punched|bleeding|unconscious|not breathing|overdose|seizure|fire|smoke|crash|accident|collision)\b/;
const DISPATCH_RE = /\b(dispatch|dispatcher|tell (them|dispatch|control)|let (dispatch|control|them) know|call me|contact me|radio me|supervisor|road sup|relief (driver|operator)|swap|running (late|behind|early)|\d+ (min|mins|minutes) (late|behind)|late|behind schedule|delay|delayed|message)\b/;
const RESTROOM_RE = /\b(restroom|rest room|bathroom|toilet|washroom|lavatory|relief point|pee|potty|break|wash my hands)\b/;
const NAV_RE = /\b(navigat\w*|directions?|detour|next stop|where am i|which way|turn|route|reroute|get me to|take me to|how do i get)\b/;
const REPORT_RE = /\b(report|broken|not working|won'?t (close|open|work|start)|stuck|leak\w*|trash|garbage|overflowing|shelter|glass|graffiti|pothole|blocked|closed|light\w* out|door|brakes?|ramp|lift|wheelchair|mirror|hvac|heat|a\/c|ac|air conditioning|tire|warning light|engine|smell|spill|sign)\b/;

export const SCOPES = {
  home: { hint: 'Say what you need: restroom, navigation, a message to dispatch, or an issue to report.' },
  restroom: { hint: 'Say "nearest restroom" or "a restroom near 12 Mile".', fallback: 'restroom' },
  navigate: { hint: 'Say "start navigation", "next stop" or "where\'s the detour".', fallback: 'navigate' },
  dispatch: { hint: 'Say your message, e.g. "Running 5 minutes late, heavy boarding."', fallback: 'dispatch' },
};

// Order matters: an emergency always wins; naming dispatch beats the topic
// ("tell dispatch I need a restroom" is a message, not a restroom search).
export function operatorIntent(text, scope = 'home') {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return 'none';
  if (EMERGENCY_RE.test(t)) return 'emergency';
  if (/\b(dispatch|dispatcher|tell (them|dispatch|control)|let (dispatch|control|them) know|call me|contact me|radio me)\b/.test(t)) return 'dispatch';
  // "The library restroom is closed" is a report about a restroom, not a search.
  if (RESTROOM_RE.test(t) && /\b(is |was )?(closed|locked|out of order|dirty|no access|not open)\b/.test(t)) return 'report';
  if (RESTROOM_RE.test(t)) return 'restroom';
  if (NAV_RE.test(t)) return 'navigate';
  if (REPORT_RE.test(t)) return 'report';
  if (DISPATCH_RE.test(t)) return 'dispatch';
  return SCOPES[scope]?.fallback || 'unknown';
}

const FROM = () => `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`;
const clean = (t) => String(t).trim().replace(/\s+/g, ' ').replace(/^./, (c) => c.toUpperCase());

function reportTypeFor(text) {
  const c = classifyLocal({ text }).category;
  return c === 'facilities' ? 'stop' : c === 'safety' ? 'safety' : 'vehicle';
}

// Runs the request. Returns { intent, say, detail, to } — the caller speaks
// `say`, shows `detail`, and navigates to `to` when present.
export function runOperatorVoice(text, scope = 'home') {
  const s = getState();
  const ops = s.ops;
  const moving = isMoving(ops, OPERATOR.bus);
  const intent = operatorIntent(text, scope);
  const pos = operatorPosition();
  const words = clean(text);

  if (intent === 'emergency') {
    sendMessage({ to: { kind: 'dispatch' }, from: FROM(), fromKind: 'operator', fromBus: OPERATOR.bus, priority: 'emergency', text: `EMERGENCY (voice): "${words}". GPS attached.` });
    const ai = classifyLocal({ text: words, reportType: 'safety' });
    const t = ai.category === 'safety' ? createTicket({ text: words, reportType: 'safety', inputMode: 'voice', vehicle: OPERATOR.bus, route: OPERATOR.route, operatorId: OPERATOR.id, operatorName: OPERATOR.name, position: pos, ai }) : null;
    return {
      intent,
      say: 'Emergency sent to dispatch with your location. Use the radio emergency button if you can.',
      detail: `Emergency sent to Central Dispatch with GPS${t ? ` · Safety ticket ${t.id} opened for Supervisor / Safety` : ''}.`,
      tone: 'danger',
    };
  }

  if (intent === 'restroom') {
    const list = reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, f: pos.f, dir: pos.dir });
    const best = list.find((r) => r.usable && r.ahead !== false) || list.find((r) => r.usable);
    if (!best) {
      return { intent, say: 'No open restroom found ahead on your route. Opening restroom options.', detail: 'No open restroom ahead right now.', to: moving ? null : '/operator/relief' };
    }
    const where = best.detourNote === 'On your detour path' ? ', on your detour path' : '';
    return {
      intent,
      say: `Best restroom: ${best.name}, about ${best.mins} minute${best.mins === 1 ? "" : "s"} ${best.ahead !== false ? 'ahead' : 'away'}${where}. Starting navigation.`,
      detail: `${best.name} · ~${best.mins} min · ${best.status.label || 'Open'}`,
      to: `/operator/navigate?to=${best.id}`,
    };
  }

  if (intent === 'navigate') {
    const det = activeDetourFor(ops, OPERATOR.route);
    const nxt = nextStops(pos, 1)[0]?.name;
    const say = det
      ? `Detour active: ${det.closure}. Follow navigation. Plus ${det.delayMin} minutes.`
      : `Navigation on.${nxt ? ` Next stop ${nxt}.` : ''}`;
    return { intent, say, detail: det ? `Detour ${det.id} · ${det.closure}` : nxt ? `Next stop: ${nxt}` : 'Navigation on', to: '/operator/navigate' };
  }

  if (intent === 'dispatch') {
    const urgent = /\b(call me|contact me|radio me|supervisor|asap|now|urgent)\b/i.test(words);
    const m = sendMessage({ to: { kind: 'dispatch' }, from: FROM(), fromKind: 'operator', fromBus: OPERATOR.bus, priority: urgent ? 'high' : 'normal', text: words });
    return { intent, say: 'Sent to dispatch.', detail: `Sent to Central Dispatch (${m.id}): "${words}"` };
  }

  if (intent === 'report') {
    if (moving) {
      const r = createFieldReport({ text: words, bus: OPERATOR.bus, route: OPERATOR.route, by: OPERATOR.id, lat: pos.lat, lng: pos.lng });
      return { intent, say: 'Got it. Flagged with your location. Add details at your next stop.', detail: `Flagged (${r.id}): "${words}"` };
    }
    const id = saveDraft({ text: words, reportType: reportTypeFor(words), inputMode: 'voice', photo: null, vehicle: OPERATOR.bus, route: OPERATOR.route, operatorId: OPERATOR.id, operatorName: OPERATOR.name, position: pos });
    return { intent, say: 'Got it. Creating your report.', detail: `Reporting: "${words}"`, to: `/operator/result/${id}` };
  }

  return {
    intent: 'unknown',
    say: 'I can find a restroom, start navigation, message dispatch, or report an issue. Try again.',
    detail: `Didn't catch a request in "${words}". Try "nearest restroom", "next stop", or "tell dispatch I'm running late".`,
  };
}
