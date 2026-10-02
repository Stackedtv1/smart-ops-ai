import { useMemo, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore } from '../services/store.js';
import { fmtTime } from '../lib/time.js';
import { stopById, routeById } from '../services/maps.js';
import {
  operatorPosition, reliefFor, activeDetourFor, nextStops, openLostForBus, driverResponse, driverFoundItem,
  inboxFor, sendMessage, createFieldReport, FIELD_KINDS, terminalName, vehicleOf, isMoving, RELIEF,
  reliefClock, markBreak, routeReliefStrip, directionsOf, routeRunMin, routeEnds, TIERS, BUS_ACCESS,
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
  const list = useMemo(() => reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, f: pos.f, dir: pos.dir }), [ops, pos.f]); // eslint-disable-line react-hooks/exhaustive-deps
  const [sel, setSel] = useState(null);
  const [sent, setSent] = useState(null);
  const [more, setMore] = useState(false);
  const detour = activeDetourFor(ops, pos.route);
  const best3 = list.filter((r) => r.ahead !== false && r.status.code !== 'closed' && r.status.code !== 'hours').slice(0, 3);
  const cur = list.find((r) => r.id === sel);
  const clock = reliefClock(ops, OPERATOR.bus);
  const hrs = `${Math.floor(clock.minutes / 60)} hr ${clock.minutes % 60} min`;
  const fit = [[pos.lat, pos.lng], ...best3.map((r) => [r.lat, r.lng])];

  return (
    <OperatorShell title="Restroom" back="/operator">
      <StoppedOnly what="Restroom options">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <h2 className="display" style={{ fontSize: 26 }}>Best options ahead</h2>
          <span className={`small ${clock.minutes >= 90 ? '' : 'muted'}`} style={clock.minutes >= 90 ? { color: 'var(--med)', fontWeight: 800 } : null}>{hrs} since break</span>
        </div>
        {detour && <div className="notice notice-warn"><b>Detour active.</b> Options recalculated for the detour route.</div>}

        <div className="best3">
          {best3.map((r, i) => (
            <button key={r.id} onClick={() => go(`/operator/navigate?to=${r.id}`)} aria-label={`Navigate to ${r.name}`}>
              <span className="n">{i + 1}</span>
              <span style={{ minWidth: 0 }}>
                <span className="nm" style={{ display: 'block' }}>{r.name}</span>
                <span className="ln" style={{ display: 'block' }}>{r.mins} min · {BUS_ACCESS[r.busPull]} · {r.status.label}</span>
                <span className={`tier tier-${r.tier}`}>{TIERS[r.tier]?.label}</span>
              </span>
              <span className="go">GO</span>
            </button>
          ))}
          {best3.length === 0 && <div className="notice notice-warn">No open options ahead on this trip. Tell Dispatch you need relief.</div>}
        </div>
        <button className="btn" onClick={() => { const r = best3[0]; sendMessage({ to: { kind: 'dispatch' }, from: `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`, fromKind: 'operator', fromBus: OPERATOR.bus, text: r ? `Taking a relief break at ${r.name} (${r.address || r.hours}).` : 'Need a relief break, no open option ahead.' }); setSent(true); }}>Tell Dispatch I'm taking a break</button>
        {sent && <span className="small" style={{ color: 'var(--ok)', fontWeight: 700 }}>✓ Dispatch knows.</span>}

        <div className="notice notice-info small">
          <b>SMART Verified</b> = SMART confirmed operator access. <b>Pending verification</b> = facility exists, access not yet confirmed by SMART. <b>Public backup</b> = public restroom during open hours.
        </div>

        <button className="btn btn-ghost" onClick={() => setMore((m) => !m)}>{more ? 'Hide' : 'Show'} map, full list and coverage</button>
        {more && (
          <>
            <RouteReliefStrip route={pos.route} pos={pos} ops={ops} />
            <OpsMap routes={[pos.route]} relief={list} you={pos} fit={fit} detours={detour ? [detour] : []} height={240} label="Relief options map" legend={false} />
            <div className="stack-sm">
              {list.map((r) => <ReliefRow key={r.id} r={r} active={cur?.id === r.id} onPick={() => setSel(r.id)} />)}
            </div>
            {cur && (
              <section className="panel panel-b stack-sm">
                <div className="row between" style={{ gap: 8 }}>
                  <b style={{ fontSize: 17 }}>{cur.name}</b>
                  <span className={`tier tier-${cur.tier}`}>{TIERS[cur.tier]?.label}</span>
                </div>
                <dl className="kv">
                  {cur.address && <><dt>Address</dt><dd>{cur.address}</dd></>}
                  <dt>Hours</dt><dd>{cur.hours}</dd>
                  <dt>Bus access</dt><dd>{cur.busPullNote}</dd>
                  <dt>Access</dt><dd>{cur.access}</dd>
                  <dt>Accessible</dt><dd>{cur.accessible ? 'Yes' : 'No'}</dd>
                </dl>
                {cur.status.reports.length > 0 && (
                  <div className="notice notice-safety"><b>Operators reported a problem:</b> {cur.status.reports.map((f) => `“${f.text}” (Bus ${f.bus}, ${fmtTime(f.at)})`).join(' ')}</div>
                )}
                <div className="row wrap" style={{ gap: 8 }}>
                  <button className="btn btn-primary" onClick={() => go(`/operator/navigate?to=${cur.id}`)}><Icon name="nav" size={16} /> Navigate</button>
                  <button className="btn" onClick={() => markBreak(OPERATOR.bus)}>I took my break</button>
                  <button className="btn" onClick={() => go(`/operator/field?relief=${cur.id}`)}>Report a problem</button>
                </div>
                {cur.source && <span className="xs muted">Source: <a href={cur.source} target="_blank" rel="noreferrer">{cur.sourceLabel || 'public listing'}</a></span>}
              </section>
            )}
          </>
        )}
        <p className="xs muted">Route {pos.route} locations are real places with public addresses and hours (hours can change). None is promised to operators until SMART verifies access. Bus position and other routes' points are simulated.</p>
      </StoppedOnly>
    </OperatorShell>
  );
}

// The whole route as one line: where relief exists, where the operator is,
// and how long the gaps are. Shows why a driver on a 2-hour stretch needs this.
function RouteReliefStrip({ route, pos, ops }) {
  const pts = routeReliefStrip(route, ops).filter((r) => r.offM < 3500);
  const run = pts.length ? Math.max(...pts.map((p) => p.atMin), 60) : 60;
  const [fwd] = directionsOf(route);
  const youF = pos.f;
  const ahead = pts.filter((p) => (pos.dir === fwd ? p.f > youF : p.f < youF) && p.status.code === 'open');
  const nextMin = ahead.length ? Math.round(Math.abs((pos.dir === fwd ? ahead[0].f : ahead[ahead.length - 1].f) - youF) * routeRunMin(route)) : null;
  const ends = routeEnds(route);
  return (
    <section className="panel panel-b stack-sm">
      <div className="row between"><b>Relief along Route {route}</b><span className="xs muted">{ends[0]} → {ends[1]}</span></div>
      <div className="rstrip" role="img" aria-label={`Route ${route} relief points`}>
        <span className="rstrip-line" />
        {pts.map((p, i) => (
          <span key={p.id} className={`rstrip-pt rs-${p.status.code}`} style={{ left: `${p.f * 100}%`, top: i % 2 ? 36 : 14 }} title={`${p.name} · ${p.status.label}`}>{i + 1}</span>
        ))}
        <span className="rstrip-you" style={{ left: `${youF * 100}%` }}><span>You</span></span>
      </div>
      <div className="xs muted">
        {nextMin != null ? <>Next open relief ahead in about <b style={{ color: 'var(--ink)' }}>{Math.max(1, nextMin)} min</b>. </> : 'No open relief ahead on this trip. '}
        Without this list, the nearest guaranteed restroom is often the terminal at the end of the line.
      </div>
      <ol className="rstrip-list xs">
        {pts.map((p) => <li key={p.id} className={`rs-${p.status.code}`}><b>{shortName(p.name)}</b> · {p.status.label}</li>)}
      </ol>
      <div className="rstrip-key xs"><span><i className="rs-open" />Open now</span><span><i className="rs-verify" />Verify</span><span><i className="rs-hours" />Closed now</span></div>
    </section>
  );
}

const SHORT = { 'Jason Hargrove Transit Center': 'Hargrove TC', 'Detroit Public Library – Main': 'Detroit Library', 'Ferndale Area District Library': 'Ferndale Library', 'SMART Royal Oak Transit Center': 'Royal Oak TC', 'Royal Oak Public Library': 'Royal Oak Library', 'Baldwin Public Library': 'Birmingham Library', 'Troy Public Library': 'Troy Library' };
const shortName = (n) => SHORT[n] || n;

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
  ['Restroom closed', 'Restroom at the library is closed today, door locked.'],
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
