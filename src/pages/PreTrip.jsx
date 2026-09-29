import { useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { stopById } from '../services/maps.js';
import { createTicket } from '../services/store.js';
import { deptLabel } from '../lib/config.js';
import { Icon } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

const ITEMS = [
  { id: 'brakes', label: 'Brakes', sub: 'brakes', component: 'Service Brakes', priority: 'high', hint: 'Brake pedal soft on air check' },
  { id: 'lights', label: 'Lights', sub: 'lights', component: 'Exterior Lighting', priority: 'medium', hint: 'Right rear tail light out' },
  { id: 'doors', label: 'Doors', sub: 'passenger_door', component: 'Rear Passenger Door', priority: 'high', hint: 'Rear door slow to close, sticks on second cycle' },
  { id: 'mirrors', label: 'Mirrors', sub: 'mirrors', component: 'Exterior Mirror', priority: 'medium', hint: 'Left mirror loose' },
  { id: 'tires', label: 'Tires', sub: 'tires', component: 'Tires', priority: 'high', hint: 'Right front tire looks low' },
  { id: 'lift', label: 'Wheelchair Lift / Ramp', sub: 'accessibility_equipment', component: 'Wheelchair Ramp', priority: 'high', hint: 'Ramp slow to deploy' },
  { id: 'warn', label: 'Warning Indicators', sub: 'warning_indicator', component: 'Dashboard Warning Indicator', priority: 'medium', hint: 'ABS lamp stays on after start' },
  { id: 'emerg', label: 'Emergency Equipment', sub: 'emergency_equipment', component: 'Emergency Equipment', priority: 'medium', hint: 'Fire extinguisher tag expired' },
];

export default function PreTrip() {
  const { go } = useNav();
  const [state, setState] = useState({});
  const [notes, setNotes] = useState({});
  const [done, setDone] = useState(null);

  const set = (id, v) => setState((s) => ({ ...s, [id]: v }));
  const complete = ITEMS.every((i) => state[i.id]);
  const defects = ITEMS.filter((i) => state[i.id] === 'bad');

  function submit() {
    const s = stopById(OPERATOR.stopId);
    const created = defects.map((i) => {
      const note = (notes[i.id] || i.hint).trim();
      const ai = {
        category: 'vehicle_defect', subcategory: i.sub, component: i.component, title: i.label.replace(' / Ramp', ''),
        issue: note, condition: 'Defect found at pre-trip inspection', priority: i.priority, department: 'maintenance',
        summary: `Pre-trip defect (${i.component.toLowerCase()}): ${note.replace(/\.$/, '')}.`,
        safety_review_required: i.priority === 'high', confidence: 0.99, engine: 'pre-trip checklist',
      };
      return createTicket({
        text: `Pre-trip: ${note}`, reportType: 'pretrip', inputMode: 'pretrip', photo: null,
        vehicle: OPERATOR.bus, route: OPERATOR.route, operatorId: OPERATOR.id, operatorName: OPERATOR.name,
        position: { stopId: s.id, lat: s.lat, lng: s.lng, source: 'Garage / pull-out' }, ai,
        location: { stopId: s.id, lat: s.lat, lng: s.lng, label: s.name, source: 'Bus position' },
      });
    });
    setDone(created);
  }

  if (done) {
    return (
      <OperatorShell back="/operator" title="Pre-Trip Inspection">
        <div className="created">
          <Icon name="check" size={32} stroke={3} />
          <div className="display">Inspection Submitted</div>
          <div className="small">Bus {OPERATOR.bus} · {ITEMS.length} items checked · {done.length} defect{done.length === 1 ? '' : 's'}</div>
        </div>
        {done.map((t) => (
          <div key={t.id} className="check">
            <div className="grow">
              <div style={{ fontWeight: 800 }}>{t.ai.title}</div>
              <div className="mono xs muted">{t.id}</div>
              <div className="small">Maintenance ticket created · {deptLabel(t.department)} notified</div>
            </div>
            <span className={`pill p-${t.priority}`}>{t.priority}</span>
          </div>
        ))}
        {done.some((t) => t.priority === 'high') && (
          <div className="notice notice-warn"><b>Supervisor / Maintenance Review Required</b> before pull-out. SMART Ops AI does not determine whether a bus is safe to operate.</div>
        )}
        <button className="btn btn-primary btn-lg" onClick={() => go('/operator')}>Back to Home</button>
      </OperatorShell>
    );
  }

  return (
    <OperatorShell back="/operator" title="Pre-Trip Inspection">
      <div className="row between">
        <div>
          <div className="eyebrow">Start pre-trip</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>Bus {OPERATOR.bus} · {OPERATOR.garage}</div>
        </div>
        <button className="btn btn-sm" onClick={() => setState(Object.fromEntries(ITEMS.map((i) => [i.id, state[i.id] === 'bad' ? 'bad' : 'ok'])))}>Mark rest OK</button>
      </div>
      <div className="stack-sm">
        {ITEMS.map((i) => (
          <div key={i.id} className={`check ${state[i.id] === 'bad' ? 'defect' : ''}`} style={{ flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700 }}>
              {state[i.id] === 'ok' ? '✓ ' : state[i.id] === 'bad' ? '⚠️ ' : ''}{i.label}
            </span>
            <span className="seg">
              <button className={state[i.id] === 'ok' ? 'on-ok' : ''} onClick={() => set(i.id, 'ok')} aria-pressed={state[i.id] === 'ok'}>OK</button>
              <button className={state[i.id] === 'bad' ? 'on-bad' : ''} onClick={() => set(i.id, 'bad')} aria-pressed={state[i.id] === 'bad'}>Defect</button>
            </span>
            {state[i.id] === 'bad' && (
              <input
                className="input"
                id={`note-${i.id}`}
                style={{ flexBasis: '100%' }}
                placeholder={i.hint}
                value={notes[i.id] ?? i.hint}
                onChange={(e) => setNotes((n) => ({ ...n, [i.id]: e.target.value }))}
                aria-label={`${i.label} defect description`}
              />
            )}
          </div>
        ))}
      </div>
      <p className="xs muted">Demonstrates the workflow only. Not a DOT-compliant DVIR.</p>
      <button className="btn btn-primary btn-lg btn-block" disabled={!complete} onClick={submit}>
        {defects.length ? `Submit & Create ${defects.length} Issue${defects.length > 1 ? 's' : ''}` : 'Submit Inspection'}
      </button>
    </OperatorShell>
  );
}
