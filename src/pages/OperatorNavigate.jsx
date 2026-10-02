import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { useStore } from '../services/store.js';
import { stopById, routeById } from '../services/maps.js';
import {
  activeDetourFor, driveState, startDrive, stopDrive, resetDrive, operatorPosition, nextStops, reliefFor, ftOrMi, isMoving, sendMessage, ackDetour,
} from '../services/ops.js';
import OpsMap from '../components/OpsMap.jsx';
import { DetourSummary, TurnIcon } from '../components/OpsWidgets.jsx';
import { Icon } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

// ---------------------------------------------------------------------------
// Voice alerts (Web Speech). Audio stays on while moving: eyes on the road.
// ---------------------------------------------------------------------------
let voiceOn = (() => { try { return localStorage.getItem('smart-ops-ai.voice') !== 'off'; } catch { return true; } })();
export function speak(text) {
  if (!voiceOn || typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.02;
    window.speechSynthesis.speak(u);
  } catch { /* audio unavailable */ }
}
export function useVoiceToggle() {
  const [on, setOn] = useState(voiceOn);
  return [on, () => { voiceOn = !voiceOn; setOn(voiceOn); try { localStorage.setItem('smart-ops-ai.voice', voiceOn ? 'on' : 'off'); } catch { /* ignore */ } }];
}

export function useTick(ms = 500) {
  const [n, setN] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setN(Date.now()), ms); return () => clearInterval(id); }, [ms]);
  return n;
}

const spokenDist = (m) => (m < 300 ? `${Math.max(100, Math.round((m * 3.28) / 100) * 100)} feet` : `${(m / 1609).toFixed(1)} miles`);

// One-tap actions that stay available while moving.
export function oneTapDispatch(kind) {
  if (kind === 'emergency') {
    sendMessage({ to: { kind: 'dispatch' }, from: `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`, fromKind: 'operator', fromBus: OPERATOR.bus, priority: 'emergency', text: 'EMERGENCY: operator requests immediate help. GPS attached.' });
    speak('Emergency sent to dispatch. Use the radio emergency button if you can.');
  } else {
    sendMessage({ to: { kind: 'dispatch' }, from: `Bus ${OPERATOR.bus} · Route ${OPERATOR.route}`, fromKind: 'operator', fromBus: OPERATOR.bus, priority: 'high', text: 'Please contact me at my next stop.' });
    speak('Dispatch will contact you at your next stop.');
  }
}

export default function OperatorNavigate({ to }) {
  const { go } = useNav();
  const ops = useStore((s) => s.ops);
  const now = useTick(400);
  const moving = isMoving(ops, OPERATOR.bus);
  const detour = activeDetourFor(ops, OPERATOR.route);
  const ds = driveState(ops, now);
  const pos = operatorPosition();
  const stops = nextStops(pos, 3);
  const [voice, toggleVoice] = useVoiceToggle();
  const [sent, setSent] = useState(null);
  const relief = reliefFor({ route: pos.route, lat: pos.lat, lng: pos.lng, ops, f: pos.f, dir: pos.dir });
  const dest = to ? relief.find((r) => r.id === to) : null;
  const said = useRef({});

  // Announce turns at ~1,000 ft and ~300 ft, and the detour once.
  useEffect(() => {
    if (!ds.active || ds.paused || !ds.next) return;
    const key = ds.nextIdx;
    const t = ds.toNext;
    if (t < 320 && !said.current[`${key}n`]) { said.current[`${key}n`] = 1; speak(`${ds.next.turn === 'left' ? 'Turn left' : 'Turn right'} onto ${ds.next.onto}${ds.next.rejoin ? ', rejoining your route' : ''}.`); }
    else if (t < 900 && t >= 320 && !said.current[`${key}f`]) { said.current[`${key}f`] = 1; speak(`In ${spokenDist(t)}, ${ds.next.turn === 'left' ? 'turn left' : 'turn right'} onto ${ds.next.onto}.`); }
  }, [ds.active, ds.paused, ds.nextIdx, Math.round((ds.toNext || 0) / 50)]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ds.done && ds.active && !ds.paused) { stopDrive(); speak('You are back on your normal route.'); } }, [ds.done]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { said.current = {}; }, [detour?.id, ops.drive?.startedAt]);

  // Map follows the bus: a window ahead of the current position.
  const ahead = ds.plan.pts.length ? [ds.lat, ds.lng] : [pos.lat, pos.lng];
  const nextPt = ds.next?.pt || stops[0] && [stops[0].lat, stops[0].lng];
  const fit = detour && !ds.active ? [[pos.lat, pos.lng], ...detour.detourPath, ...detour.closedPath] : [ahead, ...(nextPt ? [nextPt] : []), [ahead[0] + 0.012, ahead[1] - 0.012], [ahead[0] - 0.006, ahead[1] + 0.012]];
  const trail = ds.active ? ds.plan.pts.slice(0, Math.max(1, Math.ceil((ds.traveled / Math.max(1, ds.plan.total)) * ds.plan.pts.length))) : null;

  // Big instruction banner.
  let tbt;
  if (detour && ds.next) {
    tbt = { mode: 'detour-mode', turn: ds.next.turn, dist: ds.active ? ftOrMi(ds.toNext) : null, text: `${ds.next.turn === 'left' ? 'Turn left' : 'Turn right'} on ${ds.next.onto}`, sub: ds.next.rejoin ? `Rejoin route at Stop ${stopById(detour.rejoinStop)?.id}` : `at ${ds.next.at}` };
  } else if (detour && ds.done) {
    tbt = { mode: '', turn: 'right', dist: null, text: `Back on Route ${OPERATOR.route}`, sub: `Detour complete · next stop ${stops[0]?.name || ''}` };
  } else {
    tbt = { mode: '', turn: null, dist: null, text: `Continue on Route ${OPERATOR.route} ${pos.dir}`, sub: `Next stop ${stops[0]?.name || 'end of line'}` };
  }

  const remaining = detour && ds.plan.maneuvers.length ? Math.max(0, ds.plan.maneuvers[3].dist - ds.traveled) : null;

  return (
    <OperatorShell title="Navigation" back="/operator">
      <div className={`tbt ${tbt.mode}`}>
        <span className="ic">{tbt.turn ? <TurnIcon turn={tbt.turn} size={32} /> : <Icon name="nav" size={28} />}</span>
        <span style={{ minWidth: 0 }}>
          {tbt.dist && <span className="d" style={{ display: 'block' }}>{tbt.dist}</span>}
          <span className="t" style={{ display: 'block' }}>{tbt.text}</span>
          <span className="s">{tbt.sub}</span>
        </span>
      </div>

      <div>
        {detour && <DetourSummary d={detour} />}
        <OpsMap routes={[OPERATOR.route]} you={{ ...pos, lat: ds.active ? ds.lat : pos.lat, lng: ds.active ? ds.lng : pos.lng }} fit={fit} detours={detour ? [detour] : []} relief={dest ? [dest] : []} trail={trail} height={300} label="Turn-by-turn navigation map" legend={false} />
      </div>

      <div className="nav-foot">
        {detour ? (
          <>
            <span>Detour<b>+{detour.delayMin} min</b></span>
            <span>To rejoin<b>{remaining != null ? ftOrMi(remaining) : '—'}</b></span>
            <span>Rejoin at<b>Stop {stopById(detour.rejoinStop)?.id}</b></span>
          </>
        ) : (
          <>
            <span>Next stop<b>{stops[0]?.name?.replace('Woodward & ', '') || '—'}</b></span>
            <span>Route<b>{OPERATOR.route} {pos.dir.slice(0, 1)}B</b></span>
            <span>Status<b>{moving ? 'Moving' : 'Stopped'}</b></span>
          </>
        )}
      </div>

      {detour && !detour.acks?.[OPERATOR.bus] && (
        <button className="btn btn-primary btn-lg" onClick={() => { ackDetour(detour.id, OPERATOR.bus); speak('Detour acknowledged. Follow the blue route.'); }}>ACKNOWLEDGE DETOUR</button>
      )}

      {dest && <div className="notice notice-info"><b>Relief stop:</b> {dest.name} · {dest.miles.toFixed(1)} mi · {dest.busPullNote}</div>}

      <div className="nav-actions">
        <button onClick={() => { oneTapDispatch('call'); setSent('Dispatch will contact you at your next stop.'); }}><Icon name="radio" size={22} />Call me</button>
        <button onClick={() => { oneTapDispatch('emergency'); setSent('Emergency sent to Dispatch with your GPS.'); }} style={{ color: 'var(--high)' }}><Icon name="alert" size={22} />Emergency</button>
        <button onClick={toggleVoice}><Icon name="radio" size={22} />Voice {voice ? 'on' : 'off'}</button>
        <button disabled={moving} onClick={() => go('/operator/relief')} style={moving ? { opacity: 0.45 } : null}><Icon name="restroom" size={22} />Restroom</button>
      </div>
      {sent && <div className="notice notice-ok" role="status">{sent}</div>}

      <section className="panel panel-b stack-sm">
        <span className="eyebrow">Demo control · stands in for live AVL</span>
        <div className="row wrap" style={{ gap: 8 }}>
          {!ds.active || ds.paused ? (
            <button className="btn btn-primary" onClick={() => { if (ds.paused) resetDrive(); startDrive(); document.querySelector('[data-phone-screen]')?.scrollTo({ top: 0, behavior: 'smooth' }); window.scrollTo({ top: 0, behavior: 'smooth' }); if (detour) speak(`Detour active. ${detour.steps[0].text.replace('Turn', 'Prepare to turn')} at ${detour.steps[0].at}.`); }}>▶ {ds.paused ? 'Drive again' : 'Start driving'}</button>
          ) : (
            <button className="btn" onClick={() => stopDrive()}>■ Stop the bus</button>
          )}
          {ds.active && <button className="btn" onClick={() => resetDrive()}>Reset position</button>}
        </div>
        <span className="xs muted">Plays Bus {OPERATOR.bus} forward, sped up (about 45 seconds through the detour). Moving locks report forms. Navigation, one-tap Dispatch, Emergency and voice stay on.</span>
      </section>
      <p className="xs muted">Routing for a 40 ft bus, not a car: detours come from Dispatch-approved plans. Street geometry on this demo detour is simulated; route {routeById(OPERATOR.route)?.fromFeed ? 'shape and stops are from SMART’s public GTFS feed' : 'shape is simplified'}.</p>
    </OperatorShell>
  );
}
