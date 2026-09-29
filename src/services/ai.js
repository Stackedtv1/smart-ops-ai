import { CONFIG } from '../lib/config.js';
import { findStopInText, stopById } from './maps.js';

// ---------------------------------------------------------------------------
// On-device demo classifier. Mirrors the JSON contract the Netlify function
// asks the LLM for, so the demo keeps working with no network or API key.
// ---------------------------------------------------------------------------

const VEHICLE_RULES = [
  { re: /\b(door|doors)\b/, sub: 'passenger_door', component: 'Passenger Door', title: 'Door', priority: 'high' },
  { re: /\b(brake|brakes|braking)\b/, sub: 'brakes', component: 'Service Brakes', title: 'Brakes', priority: 'high' },
  { re: /\b(tire|tires|flat|blowout)\b/, sub: 'tires', component: 'Tires', title: 'Tire', priority: 'high' },
  { re: /\b(steering)\b/, sub: 'steering', component: 'Steering', title: 'Steering', priority: 'high' },
  { re: /\b(wheelchair|ramp|lift|kneel|kneeling|securement)\b/, sub: 'accessibility_equipment', component: 'Wheelchair / Accessibility Equipment', title: 'Accessibility equipment', priority: 'high' },
  { re: /\b(warning light|check engine|engine light|abs|dash light|dashboard|indicator|stop engine)\b/, sub: 'warning_indicator', component: 'Dashboard Warning Indicator', title: 'Warning light', priority: 'medium' },
  { re: /\b(mirror|mirrors)\b/, sub: 'mirrors', component: 'Exterior Mirror', title: 'Mirror', priority: 'medium' },
  { re: /\b(wiper|wipers)\b/, sub: 'wipers', component: 'Windshield Wiper', title: 'Wiper', priority: 'medium' },
  { re: /\b(windshield)\b/, sub: 'windshield', component: 'Windshield', title: 'Windshield', priority: 'medium' },
  { re: /\b(headlight|headlights|tail ?light|turn signal|interior lights?)\b/, sub: 'lights', component: 'Vehicle Lighting', title: 'Lights', priority: 'medium' },
  { re: /\b(leak|leaking|fluid|coolant|oil)\b/, sub: 'fluid_leak', component: 'Fluid System', title: 'Fluid leak', priority: 'medium' },
  { re: /\b(hvac|a ?c|air conditioning|heat|heater|defrost|cooling)\b/, sub: 'hvac', component: 'HVAC', title: 'HVAC', priority: 'low' },
  { re: /\b(chime|stop request|pull cord)\b/, sub: 'passenger_equipment', component: 'Stop Request System', title: 'Stop request', priority: 'low' },
];

const FACILITY_RULES = [
  { re: /\b(broken glass|glass|shattered|cracked panel)\b/, sub: 'broken_glass', label: 'Broken Glass', priority: 'medium' },
  { re: /\b(trash|garbage|litter|overflowing|overflow)\b/, sub: 'trash', label: 'Trash', priority: 'low' },
  { re: /\b(graffiti|tag|tagged|vandal)\b/, sub: 'graffiti', label: 'Graffiti', priority: 'low' },
  { re: /\b(light out|lights out|dark|lighting|no light)\b/, sub: 'lighting', label: 'Lighting', priority: 'medium' },
  { re: /\b(sign|signage|schedule sign|pole)\b/, sub: 'sign_damage', label: 'Sign Damage', priority: 'low' },
  { re: /\b(snow|ice|icy|unplowed|flood|flooded|puddle)\b/, sub: 'snow_ice', label: 'Snow / Ice / Water', priority: 'medium' },
  { re: /\b(bench|shelter damage|damaged shelter|roof)\b/, sub: 'stop_damage', label: 'Stop Damage', priority: 'low' },
];

const SAFETY_RE = /\b(aggressive|agitated|fight|fighting|assault|weapon|gun|knife|threat|threatening|altercation|harass|harassing|injur|injured|fell|fall|medical|unconscious|police|suspicious|intoxicated|drunk|unsafe|fire|smoke|emergency)\b/;
const OPS_RE = /\b(detour|construction|blocked|road closed|lane closed|running late|behind schedule|bunching|missed trip|traffic)\b/;
const FARE_RE = /\b(farebox|fare box|card reader|fare equipment)\b/;
const VEHICLE_HINT_RE = /\b(bus|coach|engine|vehicle)\b/;
const STOP_HINT_RE = /\b(shelter|stop|bench|sidewalk)\b/;

function sideOf(t) {
  if (/\brear\b|\bback\b/.test(t)) return 'Rear';
  if (/\bfront\b/.test(t)) return 'Front';
  if (/\bleft\b|driver side/.test(t)) return 'Left';
  if (/\bright\b|curb side/.test(t)) return 'Right';
  return '';
}

function doorIssue(t) {
  if (/(won.?t|will not|not|fail\w*).{0,12}(close|shut)|sticking|stuck|sticks/.test(t)) return { issue: 'Door sticks / fails to close properly', condition: 'Intermittent failure to close' };
  if (/(won.?t|will not|not).{0,12}open/.test(t)) return { issue: 'Door fails to open', condition: 'Failure to open' };
  if (/slow/.test(t)) return { issue: 'Door slow to operate', condition: 'Slow operation' };
  return { issue: 'Door malfunction reported', condition: 'Malfunction reported' };
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function firstSentence(text) {
  const s = String(text || '').trim().split(/(?<=[.!?])\s/)[0] || '';
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

// Next step for staff. Recommends review and routing only; never a repair
// decision and never a call on whether a bus may operate.
export function recommendedAction(ai) {
  const s = String(ai.subcategory || '');
  const high = ai.priority === 'high';
  if (ai.category === 'safety') {
    if (s === 'medical') return 'Dispatch supervisor and follow SMART medical-emergency procedure; operator contacts dispatch by radio.';
    if (s === 'fire_smoke') return 'Follow SMART fire/smoke procedure immediately; notify dispatch and supervisor.';
    if (s === 'slip_hazard') return 'Supervisor to confirm hazard is cleared at next layover; log for cleaning crew.';
    if (s === 'stop_security') return 'Supervisor to review stop conditions; request lighting check from Facilities.';
    return 'Supervisor to respond or contact operator; operator follows existing SMART safety procedures.';
  }
  if (ai.category === 'vehicle_defect') {
    const comp = (ai.component || 'component').toLowerCase();
    if (s === 'warning_indicator') return 'Maintenance to read fault codes at next layover or pull-in; supervisor decides whether to swap the bus.';
    if (high) return `Maintenance inspection of ${comp} requested; supervisor/maintenance review before next trip.`;
    return `Schedule ${comp} inspection at next pull-in.`;
  }
  if (ai.category === 'facilities') {
    const parts = [];
    if (s.includes('broken_glass')) parts.push('secure broken glass');
    if (s.includes('trash')) parts.push('empty receptacle');
    if (s.includes('lighting')) parts.push('restore shelter lighting');
    if (s.includes('graffiti')) parts.push('remove graffiti');
    if (s.includes('sign_damage')) parts.push('repair or replace stop sign');
    if (s.includes('snow_ice')) parts.push('clear snow/ice');
    const list = parts.length ? parts.join(', ') : 'inspect stop';
    return `Facilities crew to ${list}${ai.priority !== 'low' ? ' within 24 hours' : ' on next scheduled visit'}.`;
  }
  if (ai.category === 'operations') return 'Dispatch to review service impact and post a detour or rider notice if needed.';
  return 'Route to the responsible team for review.';
}

export function classifyLocal(input) {
  const r = classifyCore(input);
  return { ...r, recommended_action: recommendedAction(r) };
}

function classifyCore({ text, reportType }) {
  const t = String(text || '').toLowerCase();
  const scores = { vehicle_defect: 0, facilities: 0, safety: 0, operations: 0, other: 0 };

  const vHits = VEHICLE_RULES.filter((r) => r.re.test(t));
  const fHits = FACILITY_RULES.filter((r) => r.re.test(t));
  const safety = SAFETY_RE.test(t);

  scores.vehicle_defect += vHits.length * 2 + (VEHICLE_HINT_RE.test(t) ? 0.5 : 0);
  scores.facilities += fHits.length * 2 + (STOP_HINT_RE.test(t) ? 1.5 : 0);
  scores.safety += safety ? 4 : 0;
  scores.operations += OPS_RE.test(t) ? 3 : 0;
  scores.other += FARE_RE.test(t) ? 3 : 0;

  const hint = { vehicle: 'vehicle_defect', pretrip: 'vehicle_defect', stop: 'facilities', safety: 'safety' }[reportType];
  if (hint) scores[hint] += 1;

  const category = Object.entries(scores).sort((a, b) => b[1] - a[1])[0][1] > 0
    ? Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0]
    : hint || 'other';
  const top = scores[category];
  const confidence = Math.min(0.97, 0.78 + top * 0.05);

  if (category === 'safety') {
    const aggressive = /aggressive|agitated|fight|assault|weapon|gun|knife|threat|altercation/.test(t);
    const medical = /medical|unconscious|injur|fell|fall/.test(t);
    const fire = /fire|smoke/.test(t);
    const sub = fire ? 'fire_smoke' : medical ? 'medical' : aggressive ? 'passenger_conduct' : /slip|wet/.test(t) ? 'slip_hazard' : 'security_concern';
    const title = { fire_smoke: 'Fire / smoke', medical: 'Medical / injury', passenger_conduct: 'Passenger incident', slip_hazard: 'Slip hazard', security_concern: 'Security concern' }[sub];
    const priority = aggressive || medical || fire || /assistance|help|requested/.test(t) ? 'high' : 'medium';
    let summary = cap(firstSentence(text).replace(/\.$/, ''));
    if (sub === 'passenger_conduct' && /aggressive/.test(t)) {
      const where = /front/.test(t) ? ' near the front of the bus' : /rear|back/.test(t) ? ' near the rear of the bus' : '';
      summary = `Passenger becoming aggressive${where}${/supervisor/.test(t) ? '; operator requests supervisor assistance' : ''}`;
    }
    return {
      category, subcategory: sub, component: title, title,
      issue: summary, condition: 'Active safety concern reported by operator',
      priority, department: 'supervisor', summary: `${summary}.`,
      safety_review_required: true, confidence, engine: 'demo',
    };
  }

  if (category === 'vehicle_defect') {
    const rule = vHits[0] || { sub: 'general_defect', component: 'Vehicle', title: 'Vehicle defect', priority: 'medium' };
    const side = sideOf(t);
    const component = rule.sub === 'passenger_door' ? `${side ? side + ' ' : ''}Passenger Door` : rule.component;
    let issue = cap(firstSentence(text).replace(/\.$/, ''));
    let condition = 'Defect reported by operator';
    let summary = `${issue}.`;
    let title = rule.sub === 'passenger_door' && side ? `${side} door` : rule.title;
    if (rule.sub === 'passenger_door') {
      const d = doorIssue(t);
      issue = d.issue;
      condition = d.condition;
      summary = `${side ? side + ' p' : 'P'}assenger door sticking and failing to close correctly.`;
      if (!/sticking|stuck|sticks|close|shut/.test(t)) summary = `${component}: ${d.issue.toLowerCase()}.`;
    }
    if (rule.sub === 'warning_indicator') {
      const lamp = /check engine/.test(t) ? 'Check engine' : /abs/.test(t) ? 'ABS' : /stop engine/.test(t) ? 'Stop engine' : 'Warning';
      issue = `${lamp} lamp illuminated`;
      title = `${lamp} light`;
      condition = /running normally|still running|drives fine/.test(t) ? 'Lamp on; operator reports normal operation' : 'Lamp illuminated in service';
      summary = `${lamp} warning lamp illuminated in service${/running normally|still running/.test(t) ? '; bus operating normally per operator' : ''}.`;
    }
    const priority = /stop engine|red light|smoke|won.?t stop/.test(t) ? 'high' : rule.priority;
    return {
      category, subcategory: rule.sub, component, title, issue, condition,
      priority, department: 'maintenance', summary,
      safety_review_required: priority === 'high' || rule.sub === 'passenger_door' || rule.sub === 'brakes',
      confidence, engine: 'demo',
    };
  }

  if (category === 'facilities') {
    const hits = fHits.length ? fHits : [{ sub: 'stop_damage', label: 'Stop Damage', priority: 'low' }];
    const labels = hits.map((h) => h.label);
    const rank = { high: 3, medium: 2, low: 1 };
    let priority = hits.reduce((p, h) => (rank[h.priority] > rank[p] ? h.priority : p), 'low');
    if (hits.length >= 2 && priority === 'low') priority = 'medium';
    const isShelter = /shelter/.test(t);
    const summary = `${isShelter ? 'Shelter' : 'Stop'} reported with ${labels.map((l) => l.toLowerCase()).join(' and ')}.`;
    return {
      category, subcategory: hits.map((h) => h.sub).join('+'), subcategoryLabel: labels.join(' + '),
      component: isShelter ? 'Bus Shelter' : 'Bus Stop', title: labels.join(' + '),
      issue: labels.join(' + '), condition: 'Stop amenity condition reported',
      priority, department: 'facilities', summary,
      safety_review_required: hits.some((h) => h.sub === 'broken_glass' || h.sub === 'snow_ice' || h.sub === 'lighting'),
      confidence, engine: 'demo',
    };
  }

  if (category === 'operations') {
    return {
      category, subcategory: 'detour', component: 'Road / Service Condition', title: 'Service disruption',
      issue: cap(firstSentence(text).replace(/\.$/, '')), condition: 'Service impact reported',
      priority: 'medium', department: 'operations', summary: `${cap(firstSentence(text))}`,
      safety_review_required: false, confidence, engine: 'demo',
    };
  }

  return {
    category: 'other', subcategory: FARE_RE.test(t) ? 'fare_equipment' : 'general', component: FARE_RE.test(t) ? 'Farebox' : 'General',
    title: FARE_RE.test(t) ? 'Fare equipment' : 'General report', issue: cap(firstSentence(text).replace(/\.$/, '')),
    condition: 'Reported by operator', priority: 'low', department: 'operations', summary: cap(firstSentence(text)),
    safety_review_required: false, confidence: Math.min(confidence, 0.8), engine: 'demo',
  };
}

// Location: prefer a stop named in the report, otherwise the bus's current position.
export function resolveLocation(text, fallback) {
  const named = findStopInText(text);
  if (named) return { stopId: named.id, lat: named.lat, lng: named.lng, label: named.name, source: 'named in report' };
  const s = stopById(fallback?.stopId);
  return {
    stopId: s?.id || null,
    lat: fallback?.lat ?? s?.lat,
    lng: fallback?.lng ?? s?.lng,
    label: s?.name || 'Captured location',
    source: fallback?.source || 'bus position',
  };
}

const VALID = {
  category: ['vehicle_defect', 'facilities', 'safety', 'operations', 'other'],
  priority: ['high', 'medium', 'low'],
  department: ['maintenance', 'facilities', 'safety', 'operations', 'supervisor'],
};

function isValid(r) {
  return r && VALID.category.includes(r.category) && VALID.priority.includes(r.priority) && VALID.department.includes(r.department) && typeof r.summary === 'string';
}

// Calls the Netlify function (OpenAI structured output). Falls back to the
// on-device classifier on any error, timeout, or invalid JSON.
export async function classifyReport(input) {
  const local = classifyLocal(input);
  if (CONFIG.aiMode === 'offline') return local;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`${CONFIG.functionsBase}/classify-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, reportType: input.reportType, vehicle: input.vehicle, route: input.route }),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const r = data?.result;
    if (!isValid(r)) throw new Error('invalid AI output');
    return {
      ...local,
      ...r,
      recommended_action: r.recommended_action || recommendedAction(r),
      title: r.title || local.title,
      component: r.component || local.component,
      issue: r.issue || local.issue,
      condition: r.condition || local.condition,
      engine: data.model ? `openai:${data.model}` : 'openai',
    };
  } catch {
    return local;
  }
}

export async function transcribeAudio(blob) {
  if (CONFIG.aiMode === 'offline') throw new Error('offline');
  const buf = await blob.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const res = await fetch(`${CONFIG.functionsBase}/transcribe-report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: btoa(bin), mimeType: blob.type || 'audio/webm' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.text || '';
}

// Shape stored with the ticket and shown in "View AI JSON".
export function toContractJson(ai) {
  return {
    category: ai.category,
    subcategory: ai.subcategory,
    priority: ai.priority,
    department: ai.department,
    summary: ai.summary,
    recommended_action: ai.recommended_action || recommendedAction(ai),
    safety_review_required: !!ai.safety_review_required,
    confidence: Number((ai.confidence ?? 0.9).toFixed(2)),
  };
}
