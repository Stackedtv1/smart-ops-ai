import { useMemo, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore } from '../services/store.js';
import { fmtTime } from '../lib/time.js';
import { stopById, routeById } from '../services/maps.js';
import {
  operatorPosition, reliefFor, activeDetourFor, nextStops, openLostForBus, driverResponse, driverFoundItem,
  inboxFor, sendMessage, createFieldReport, FIELD_KINDS, terminalName, vehicleOf, isMoving, RELIEF,
} from '../services/ops.js';
import { Icon, readPhoto } from '../components/ui.jsx';
import OpsMap from '../components/OpsMap.jsx';
import { DetourBanner, MessageCard, ReliefRow } from '../components/OpsWidgets.jsx';
import OperatorShell, { StoppedOnly } from './OperatorShell.jsx';

const BY = `Bus ${OPERATOR.bus} · ${OPERATOR.name}`;

// ---------------------------------------------------------------------------
// RESTROOM / RELIEF FINDER
// ---------------------------------------------------------------------------
export function OperatorRelief() {
  const { go } = useNav();
  const ops = useStore((s) => s.ops);
  const pos = operatorPosition();
  const list = useMemo(() => reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, f: pos.f, dir: pos.dir }), [ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(null);
  const detour = activeDetourFor(ops, pos.route);
  const best = list.find((r) => r.usable && r.ahead) || list.find((r) => r.usable);
  const cur = list.find((r) => r.id === sel) || best;
  const fit = [[pos.lat, pos.lng], ...list.slice(0, 4).map((r) => [r.lat, r.lng])];

  return (
    <OperatorShell title="Restroom / Relief" back="/operator">
      <StoppedOnly what="Relief Finder">
        <div className="stack-sm" style={{ gap: 4 }}>
          <h2 className="display" style={{ fontSize: 26 }}>Operator Relief Points</h2>
          <div className="small muted">Approved, bus-friendly locations on or near Route {pos.route}. Not random public restrooms.</div>
        </div>
        {detour && <div className="notice notice-warn"><b>Detour active.</b> Relief points recalculated for the detour path.</div>}
        {best && (
          <div className="relief-best">
            <span className="eyebrow">Closest available</span>
            <b style={{ fontSize: 18 }}>{best.name}</b>
            <span className="small">{best.miles.toFixed(1)} mi ahead · about {best.mins} min · {best.busPullNote}</span>
          </div>
        )}
        <OpsMap routes={[pos.route]} relief={list} you={pos} fit={fit} detours={detour ? [detour] : []} height={250} label="Relief points map" legend={false} />
        <div className="stack-sm">
          {list.map((r) => <ReliefRow key={r.id} r={r} active={cur?.id === r.id} onPick={() => setSel(r.id)} />)}
        </div>
        {cur && (
          <section className="panel panel-b stack-sm">
            <b style={{ fontSize: 17 }}>{cur.name}</b>
            <dl className="kv">
              <dt>Hours</dt><dd>{cur.hours}</dd>
              <dt>Bus pull-in</dt><dd>{cur.busPullNote}</dd>
              <dt>Access</dt><dd>{cur.access}</dd>
              <dt>Type</dt><dd>{cur.type}</dd>
              <dt>Accessible</dt><dd>{cur.accessible ? 'Yes' : 'No'}</dd>
            </dl>
            {cur.status.reports.length > 0 && (
              <div className="notice notice-safety">
                <b>Operators reported a problem:</b> {cur.status.reports.map((f) => `“${f.text}” (Bus ${f.bus}, ${fmtTime(f.at)})`).join(' ')}
              </div>
            )}
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={() => go(`/operator/navigate?to=${cur.id}`)}><Icon name="nav" size={16} /> Navigate</button>
              <button className="btn" onClick={() => sendMessage({ to: { kind: 'dispatch' }, from: `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`, fromKind: 'operator', fromBus: OPERATOR.bus, text: `Requesting relief break at ${cur.name}.` })}>Notify dispatch</button>
              <button className="btn" onClick={() => go(`/operator/field?relief=${cur.id}`)}>Report a problem</button>
            </div>
          </section>
        )}
        <p className="xs muted">Relief points and partner businesses are simulated. In production SMART supplies its approved operator relief list, and operator reports keep it current.</p>
      </StoppedOnly>
    </OperatorShell>
  );
}

// ---------------------------------------------------------------------------
// NAVIGATION (route-aware, detour-aware)
// ---------------------------------------------------------------------------
export function OperatorNavigate({ to }) {
  const { go } = useNav();
  const ops = useStore((s) => s.ops);
  const moving = isMoving(ops, OPERATOR.bus);
  const pos = operatorPosition();
  const detour = activeDetourFor(ops, pos.route);
  const stops = nextStops(pos, 4);
  const relief = useMemo(() => reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, f: pos.f, dir: pos.dir }), [ops]); // eslint-disable-line react-hooks/exhaustive-deps
  const dest = to ? relief.find((r) => r.id === to) || null : null;
  const field = ops.field.filter((f) => f.route === pos.route).slice(0, 6);
  const nextStop = stops[0];
  const fit = [[pos.lat, pos.lng], ...stops.slice(0, 3).map((s) => [s.lat, s.lng]), ...(detour ? detour.detourPath : []), ...(dest ? [[dest.lat, dest.lng]] : [])];

  // While moving, only the glanceable next-turn card shows.
  if (moving) {
    return (
      <OperatorShell title="Navigation" back="/operator">
        <div className="glance">
          {detour ? (
            <>
              <span className="detour-tag">DETOUR</span>
              <div className="glance-turn">{detour.steps[0].text}</div>
              <div className="glance-at">at {detour.steps[0].at}</div>
            </>
          ) : (
            <>
              <span className="eyebrow">Next stop</span>
              <div className="glance-turn">{nextStop?.name || 'End of line'}</div>
            </>
          )}
        </div>
        <div className="locked" style={{ marginTop: 0 }}>
          <div>Map controls lock while moving. Glance view only.</div>
        </div>
      </OperatorShell>
    );
  }

  return (
    <OperatorShell title="Navigation" back="/operator">
      {detour && (
        <div className="next-turn">
          <span className="detour-tag">DETOUR · NEXT TURN</span>
          <b>{detour.steps[0].text}</b>
          <span className="small">at {detour.steps[0].at} · then {detour.steps.length - 1} more turns · rejoin at Stop {stopById(detour.rejoinStop)?.id}</span>
        </div>
      )}
      <OpsMap routes={[pos.route]} you={pos} fit={fit} detours={detour ? [detour] : []} relief={dest ? [dest] : relief.slice(0, 3)} field={field} height={300} label="Route navigation map" legend={false} />
      <div className="nav-legend xs muted">
        <span><i style={{ background: routeById(pos.route)?.color }} />Normal route</span>
        {detour && <span><i style={{ background: 'var(--flag)' }} />Detour</span>}
        {detour && <span><i style={{ background: 'var(--high)' }} />Closed</span>}
      </div>

      {dest && (
        <section className="panel panel-b stack-sm">
          <span className="eyebrow">Relief destination</span>
          <b style={{ fontSize: 17 }}>{dest.name}</b>
          <span className="small">{dest.miles.toFixed(1)} mi · about {dest.mins} min · {dest.status.label}{dest.detourNote ? ` · ${dest.detourNote}` : ''}</span>
          <span className="small"><b>Pull-in:</b> {dest.busPullNote}</span>
          <span className="small"><b>Access:</b> {dest.access}</span>
          <span className="xs muted">Directions follow bus-legal streets. Production uses SMART's approved bus routing from CAD/AVL or a bus-routing engine.</span>
        </section>
      )}

      <section className="panel">
        <div className="panel-h"><h2>Next stops</h2><span className="small muted">{pos.dir}</span></div>
        <ul className="nav-stops">
          {stops.map((s, i) => {
            const isRejoin = detour && s.id === stopById(detour.rejoinStop)?.id;
            return (
              <li key={s.id}>
                <span className="mono xs muted">{s.id}</span>
                <span className="grow">{s.name}</span>
                {i === 0 && <span className="tag">Next</span>}
                {isRejoin && <span className="tag" style={{ background: 'var(--flag)', color: 'var(--flag-ink)' }}>Rejoin</span>}
              </li>
            );
          })}
          {detour && detour.bypassed.map((b) => (
            <li key={b} className="bypassed"><span className="mono xs">—</span><span className="grow">{b}</span><span className="tag" style={{ background: 'var(--high-soft)', color: 'var(--high)' }}>Bypassed</span></li>
          ))}
          {detour && detour.temporary.map((b) => (
            <li key={b}><span className="mono xs">TMP</span><span className="grow">{b}</span><span className="tag" style={{ background: 'var(--flag)', color: 'var(--flag-ink)' }}>Temporary</span></li>
          ))}
        </ul>
      </section>

      {detour && <DetourBanner detour={detour} />}

      <div className="nav-actions">
        <button onClick={() => go('/operator/relief')}><Icon name="restroom" size={22} />Restroom</button>
        <button onClick={() => go('/operator/field')}><Icon name="cone" size={22} />Hazard</button>
        <button onClick={() => go('/operator/field?kind=road_blocked')}><Icon name="block" size={22} />Road blocked</button>
        <button onClick={() => go('/operator/dispatch')}><Icon name="radio" size={22} />Dispatch</button>
      </div>
      <p className="xs muted">Positions and timing are simulated for the demo. SMART Ops reads them from the agency's existing AVL in production, and detours publish through the CAD/AVL SMART already owns.</p>
    </OperatorShell>
  );
}

// ---------------------------------------------------------------------------
// LOST ITEM (operator)
// ---------------------------------------------------------------------------
const WHERE = ['Front seats', 'Rear seats', 'Under a seat', 'Floor', 'Wheelchair area', 'Bike rack'];

export function OperatorLost() {
  const ops = useStore((s) => s.ops);
  const alerts = openLostForBus(ops, OPERATOR.bus);
  const done = ops.lost.filter((l) => l.responses?.[OPERATOR.bus] && l.status !== 'Returned').slice(0, 4);
  const [sel, setSel] = useState(null);
  const [where, setWhere] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [newItem, setNewItem] = useState('');
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);
  const term = terminalName(vehicleOf(OPERATOR.bus)?.garage);

  const cur = alerts.find((a) => a.id === sel) || alerts[0];

  return (
    <OperatorShell title="Lost Item" back="/operator">
      <StoppedOnly what="Lost Item">
        {msg && <div className="notice notice-ok" role="status">{msg}</div>}
        {cur ? (
          <section className="panel panel-b stack-sm">
            <span className="eyebrow" style={{ color: 'var(--accent)' }}>Lost item reported · {cur.id}</span>
            <b style={{ fontSize: 20 }}>{cur.item}</b>
            <span className="small">{cur.matches.find((m) => m.bus === OPERATOR.bus)?.trip || `Route ${cur.route}`} · near {stopById(cur.stopId)?.name} · around {fmtTime(cur.approxAt)}</span>
            <div className="field">
              <label>Where on the bus?</label>
              <div className="script-chips">
                {WHERE.map((w) => <button key={w} className={`chip ${where === w ? 'on' : ''}`} onClick={() => setWhere(w)}>{w}</button>)}
              </div>
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              <button className="btn" onClick={() => fileRef.current?.click()}><Icon name="camera" size={16} /> {photo ? 'Photo added' : 'Add photo (optional)'}</button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) setPhoto(await readPhoto(f, 640)); }} />
            </div>
            <div className="lost-actions">
              <button className="btn btn-lg btn-ok" onClick={() => { driverResponse(cur.id, OPERATOR.bus, { found: true, where: where || 'On board', photo }); setMsg(`Marked FOUND. Bring it to ${term}. Customer Service has been updated.`); setWhere(null); setPhoto(null); }}>FOUND</button>
              <button className="btn btn-lg" onClick={() => { driverResponse(cur.id, OPERATOR.bus, { found: false }); setMsg('Marked not on bus. Customer Service has been updated.'); }}>NOT ON BUS</button>
            </div>
            {alerts.length > 1 && <div className="small muted">{alerts.length - 1} more alert{alerts.length > 2 ? 's' : ''}: {alerts.filter((a) => a.id !== cur.id).map((a) => <button key={a.id} className="linkbtn" onClick={() => setSel(a.id)}>{a.item}</button>)}</div>}
          </section>
        ) : (
          <div className="notice notice-info">No open lost-item alerts for Bus {OPERATOR.bus}.</div>
        )}

        <section className="panel panel-b stack-sm">
          <b>Found something nobody reported?</b>
          <input className="input" placeholder="e.g. Gray umbrella" value={newItem} onChange={(e) => setNewItem(e.target.value)} />
          <div className="script-chips">
            {WHERE.slice(0, 4).map((w) => <button key={w} className={`chip ${where === w ? 'on' : ''}`} onClick={() => setWhere(w)}>{w}</button>)}
          </div>
          <button className="btn btn-primary" disabled={!newItem.trim()} onClick={() => { const r = driverFoundItem({ item: newItem.trim(), where: where || 'On board', bus: OPERATOR.bus, route: OPERATOR.route }); setNewItem(''); setMsg(`Logged ${r.id}. Bring it to ${term}.`); }}>Log found item</button>
        </section>

        {done.length > 0 && (
          <section className="panel">
            <div className="panel-h"><h2>Your recent responses</h2></div>
            <ul className="nav-stops">
              {done.map((l) => <li key={l.id}><span className="mono xs muted">{l.id}</span><span className="grow">{l.item}</span><span className="tag">{l.status}</span></li>)}
            </ul>
          </section>
        )}
      </StoppedOnly>
    </OperatorShell>
  );
}

// ---------------------------------------------------------------------------
// DISPATCH (operator inbox + quick requests)
// ---------------------------------------------------------------------------
const QUICK = ['Running late, heavy boarding', 'Need a road supervisor', 'Requesting relief break', 'Question about the detour', 'Bus full, passing stops'];

export function OperatorDispatch() {
  const ops = useStore((s) => s.ops);
  const inbox = inboxFor(ops, OPERATOR.bus);
  const sent = ops.messages.filter((m) => m.fromBus === OPERATOR.bus).slice(0, 4);
  const [text, setText] = useState('');
  const [ok, setOk] = useState(null);
  const send = (t) => {
    const m = sendMessage({ to: { kind: 'dispatch' }, from: `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`, fromKind: 'operator', fromBus: OPERATOR.bus, text: t });
    setText('');
    setOk(`Sent to Central Dispatch (${m.id}).`);
  };
  return (
    <OperatorShell title="Dispatch" back="/operator">
      <StoppedOnly what="Dispatch messaging">
        {ok && <div className="notice notice-ok" role="status">{ok}</div>}
        <section className="panel panel-b stack-sm">
          <b>Send to Central Dispatch</b>
          <div className="script-chips">{QUICK.map((q) => <button key={q} className="chip" onClick={() => send(q)}>{q}</button>)}</div>
          <textarea className="textarea" placeholder="Type a message…" value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" disabled={!text.trim()} onClick={() => send(text.trim())}>Send</button>
          <span className="xs muted">Emergencies: use the radio emergency button. This channel is for routine operations.</span>
        </section>
        <div className="eyebrow">From Dispatch</div>
        {inbox.length ? inbox.map((m) => <MessageCard key={m.id} m={m} recipient={OPERATOR.bus} by={BY} />) : <div className="small muted">No messages.</div>}
        {sent.length > 0 && (
          <>
            <div className="eyebrow">You sent</div>
            {sent.map((m) => <MessageCard key={m.id} m={m} />)}
          </>
        )}
      </StoppedOnly>
    </OperatorShell>
  );
}

// ---------------------------------------------------------------------------
// ROAD / HAZARD / LOCATION REPORT → Operator Knowledge Map
// ---------------------------------------------------------------------------
const SCRIPTS = [
  ['Road blocked', 'Police have Woodward closed northbound at 12 Mile. Can’t get through.'],
  ['Restroom closed', 'Restroom at the Royal Oak layover room is locked, keypad not working.'],
  ['Construction', 'Construction crew working on Woodward near 10 Mile, right lane closed.'],
  ['Safe bus parking', 'Safe spot to park a 40 foot bus behind the Main St market, plenty of room.'],
  ['Stop inaccessible', 'Stop at Woodward and 9 Mile is blocked by a parked truck, can’t deploy the ramp.'],
  ['Pothole', 'Deep pothole in the curb lane on Woodward just north of 9 Mile.'],
];
const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export function OperatorField({ kind: presetKind, relief }) {
  const { go } = useNav();
  const preRelief = relief ? RELIEF.find((r) => r.id === relief) : null;
  const [text, setText] = useState(presetKind === 'road_blocked' ? SCRIPTS[0][1] : preRelief ? `Restroom at ${preRelief.name} is closed. ` : '');
  const [done, setDone] = useState(null);
  const [listening, setListening] = useState(false);
  const ops = useStore((s) => s.ops);

  function mic() {
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.onresult = (e) => setText((t) => `${t} ${e.results[0][0].transcript}`.trim());
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  function submit() {
    const pos = operatorPosition();
    const at = preRelief ? { lat: preRelief.lat, lng: preRelief.lng } : { lat: pos.lat, lng: pos.lng };
    const r = createFieldReport({ text, bus: OPERATOR.bus, route: OPERATOR.route, by: OPERATOR.id, ...at });
    setDone(r);
  }

  const live = done && ops.field.find((f) => f.id === done.id);
  return (
    <OperatorShell title="Road / Location Report" back="/operator">
      <StoppedOnly what="Location reporting">
        {!done ? (
          <>
            <div className="stack-sm" style={{ gap: 4 }}>
              <h2 className="display" style={{ fontSize: 26 }}>Report a location</h2>
              <div className="small muted">Bus, route, direction and GPS are captured automatically. Speak or type what you see.</div>
            </div>
            <div className="script-chips">{SCRIPTS.map(([l, t]) => <button key={l} className="chip" onClick={() => setText(t)}>▶ {l}</button>)}</div>
            <div className="transcript">
              <textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="“Police have 9 Mile closed eastbound at Evergreen.”" />
            </div>
            <div className="row wrap" style={{ gap: 8 }}>
              {SR && <button className="btn" onClick={mic} disabled={listening}><Icon name="mic" size={16} /> {listening ? 'Listening…' : 'Speak'}</button>}
              <button className="btn btn-primary btn-lg grow" disabled={text.trim().length < 6} onClick={submit}>Submit report</button>
            </div>
            <dl className="kv small">
              <dt>Bus</dt><dd>{OPERATOR.bus}</dd>
              <dt>Route</dt><dd>{OPERATOR.route} {operatorPosition().dir}</dd>
              <dt>Location</dt><dd>{preRelief ? preRelief.name : 'Current GPS position'}</dd>
            </dl>
          </>
        ) : (
          <section className="panel panel-b stack-sm">
            <span className="eyebrow" style={{ color: 'var(--ok)' }}>✓ Report {done.id} sent</span>
            <b style={{ fontSize: 20 }}>{FIELD_KINDS[done.kind].label}</b>
            <span className="small">AI categorized it and routed it to <b>{done.routedTo}</b>. It is on the Operations Map now.</span>
            {done.kind === 'road_blocked' && done.suggestedDetour && (
              <div className="notice notice-warn">Dispatch has a recommended detour ready to approve. You'll get the new routing here the moment it's published.{live?.status === 'Detour published' ? ' ✓ Published.' : ''}</div>
            )}
            {done.kind === 'restroom_closed' && <div className="notice notice-info">Relief Finder updated for every operator on this route. Facilities ticket created.</div>}
            <div className="row" style={{ gap: 8 }}>
              <button className="btn" onClick={() => { setDone(null); setText(''); }}>Report another</button>
              <button className="btn btn-primary" onClick={() => go('/operator')}>Done</button>
            </div>
          </section>
        )}
      </StoppedOnly>
    </OperatorShell>
  );
}
