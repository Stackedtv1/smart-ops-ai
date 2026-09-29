import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { OPERATOR, CONFIG } from '../lib/config.js';
import { routeLabel, stopById, nearestStop, findStopInText } from '../services/maps.js';
import { saveDraft, DEMO_SCRIPTS } from '../services/store.js';
import { transcribeAudio } from '../services/ai.js';
import { fmtTime } from '../lib/time.js';
import { Icon, readPhoto } from '../components/ui.jsx';
import OperatorShell from './OperatorShell.jsx';

const TYPES = {
  vehicle: { title: 'Vehicle Issue', scripts: [['Rear door sticking', 'door'], ['Warning light', 'warning']] },
  stop: { title: 'Stop / Shelter Issue', scripts: [['Broken shelter glass + trash', 'shelter'], ['Overflowing trash', 'trash']] },
  safety: { title: 'Safety / Incident', scripts: [['Aggressive passenger', 'safety']] },
};

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

export default function ReportIssue({ type = 'vehicle' }) {
  const { go } = useNav();
  const cfg = TYPES[type] || TYPES.vehicle;
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('typed');
  const [micMsg, setMicMsg] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [now] = useState(Date.now());
  const home = stopById(OPERATOR.stopId);
  const [pos, setPos] = useState({ lat: home.lat, lng: home.lng, stopId: home.id, source: 'Simulated on-route position' });
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const typer = useRef(null);
  const fileRef = useRef(null);

  useEffect(() => () => {
    clearInterval(typer.current);
    try { recRef.current?.abort(); } catch { /* ignore */ }
    try { mediaRef.current?.stop(); } catch { /* ignore */ }
  }, []);

  const named = findStopInText(text);
  const locLabel = named ? named.name : stopById(pos.stopId)?.name;

  function playScript(key) {
    clearInterval(typer.current);
    const full = DEMO_SCRIPTS[key];
    setMode('voice');
    setText('');
    setListening(true);
    setMicMsg(null);
    let i = 0;
    typer.current = setInterval(() => {
      i += 2;
      setText(full.slice(0, i));
      if (i >= full.length) {
        clearInterval(typer.current);
        setListening(false);
      }
    }, 38);
  }

  async function startMic() {
    if (listening) return stopMic();
    setMicMsg(null);
    if (SR) {
      try {
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = false;
        const base = text ? `${text.trim()} ` : '';
        rec.onresult = (e) => {
          let fin = '';
          let tmp = '';
          for (let i = 0; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) fin += r[0].transcript;
            else tmp += r[0].transcript;
          }
          setText((base + fin).replace(/\s+/g, ' ').trimStart());
          setInterim(tmp);
        };
        rec.onerror = (e) => {
          setListening(false);
          setInterim('');
          setMicMsg(e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'Microphone access is blocked here. Type the report below or play a demo script.'
            : e.error === 'no-speech' ? 'No speech heard. Tap the mic and try again, or type below.' : `Voice capture stopped (${e.error}). You can type the report instead.`);
        };
        rec.onend = () => {
          setListening(false);
          setInterim('');
        };
        recRef.current = rec;
        rec.start();
        setMode('voice');
        setListening(true);
        return;
      } catch {
        /* fall through to recorder */
      }
    }
    if (navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined' && CONFIG.aiMode !== 'offline') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks = [];
        const mr = new MediaRecorder(stream);
        mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setListening(false);
          setBusy(true);
          try {
            const out = await transcribeAudio(new Blob(chunks, { type: mr.mimeType }));
            setText((t) => `${t ? t + ' ' : ''}${out}`.trim());
          } catch {
            setMicMsg('Transcription service unavailable. Type the report below.');
          }
          setBusy(false);
        };
        mediaRef.current = mr;
        mr.start();
        setMode('voice');
        setListening(true);
        return;
      } catch {
        /* fall through */
      }
    }
    setMicMsg('Voice input is not available in this browser. Type the report below or play a demo script.');
  }

  function stopMic() {
    clearInterval(typer.current);
    try { recRef.current?.stop(); } catch { /* ignore */ }
    try { mediaRef.current?.state === 'recording' && mediaRef.current.stop(); } catch { /* ignore */ }
    setListening(false);
  }

  function useDeviceGps() {
    if (!navigator.geolocation) return setMicMsg('Device GPS is not available here; using the simulated bus position.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const s = nearestStop(p.coords.latitude, p.coords.longitude);
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, stopId: s?.id, source: 'Device GPS' });
      },
      () => setMicMsg('Location permission was declined; using the simulated bus position.'),
      { timeout: 6000 }
    );
  }

  async function onPhoto(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setPhoto(await readPhoto(f));
    e.target.value = '';
  }

  function submit() {
    stopMic();
    const id = saveDraft({
      text: text.trim(),
      reportType: type,
      inputMode: mode,
      photo,
      vehicle: OPERATOR.bus,
      route: OPERATOR.route,
      operatorId: OPERATOR.id,
      operatorName: OPERATOR.name,
      position: pos,
    });
    go(`/operator/result/${id}`, { replace: true });
  }

  return (
    <OperatorShell back="/operator" title={cfg.title}>
      <div className="mic-wrap">
        <button className={`mic ${listening ? 'on' : ''}`} onClick={startMic} aria-label={listening ? 'Stop recording' : 'Tap to report'} aria-pressed={listening}>
          <Icon name={listening ? 'stop' : 'mic'} size={54} stroke={1.8} />
        </button>
        <div className="mic-label">{listening ? 'LISTENING… TAP TO STOP' : busy ? 'TRANSCRIBING…' : 'TAP TO REPORT'}</div>
        <p className="small muted center" style={{ maxWidth: 320 }}>Describe the issue naturally. SMART Ops AI will structure the report.</p>
      </div>

      <div className="stack-sm">
        <span className="eyebrow">Demo scripts</span>
        <div className="script-chips">
          {cfg.scripts.map(([label, key]) => (
            <button key={key} className="chip" onClick={() => playScript(key)}>▶ {label}</button>
          ))}
        </div>
      </div>

      {micMsg && <div className="notice notice-warn">{micMsg}</div>}

      <div className="field transcript">
        <label htmlFor="report-text" className="row between">
          <span>{mode === 'voice' ? 'Live transcription' : 'Report text'}</span>
          <span className="row xs muted" style={{ gap: 4, fontWeight: 600 }}><Icon name="keyboard" size={14} /> Typing also works</span>
        </label>
        <textarea
          id="report-text"
          className="textarea"
          placeholder="e.g. Rear passenger door on bus 4602 is sticking and won't close properly."
          value={text + (interim ? ` ${interim}` : '')}
          onChange={(e) => { setText(e.target.value); setInterim(''); if (!e.target.value) setMode('typed'); }}
        />
      </div>

      <div className="capture">
        <div><div className="k">Bus</div><div className="v mono">{OPERATOR.bus}</div></div>
        <div><div className="k">Route</div><div className="v">{routeLabel(OPERATOR.route)}</div></div>
        <div><div className="k">GPS</div><div className="v ok">Captured ✓</div><div className="xs muted">{pos.source}</div></div>
        <div><div className="k">Location</div><div className="v">{locLabel}</div>{named && <div className="xs muted">Named in report</div>}</div>
        <div><div className="k">Date / Time</div><div className="v">{fmtTime(now)}</div><div className="xs muted">Automatic</div></div>
        <div><div className="k">Operator</div><div className="v">{OPERATOR.name}</div></div>
      </div>
      <button className="btn btn-sm btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={useDeviceGps}>Use device GPS instead</button>

      {photo ? (
        <div className="photo-thumb">
          <img src={photo} alt="Attached evidence" />
          <div className="grow"><div style={{ fontWeight: 800, color: 'var(--ok)' }}>Photo Attached ✓</div><div className="xs muted">Stored with the report</div></div>
          <button className="btn btn-sm" onClick={() => setPhoto(null)}>Remove</button>
        </div>
      ) : (
        <button className="btn btn-lg btn-block" onClick={() => fileRef.current?.click()}>
          <Icon name="camera" /> Add Photo
        </button>
      )}
      <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
      <p className="xs muted" style={{ marginTop: -6 }}>Photos only when the bus is parked: door, tire, dashboard warning, damage, shelter, trash, broken glass.</p>

      {type === 'safety' && (
        <div className="notice notice-safety"><b>AI does not replace emergency procedures.</b> Follow existing SMART safety procedures and radio dispatch for any emergency.</div>
      )}

      <button className="btn btn-primary btn-lg btn-block" disabled={!text.trim() || busy} onClick={submit}>
        Submit Report
      </button>
    </OperatorShell>
  );
}
