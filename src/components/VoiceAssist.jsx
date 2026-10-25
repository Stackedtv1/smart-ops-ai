import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { CONFIG, OPERATOR } from '../lib/config.js';
import { useStore } from '../services/store.js';
import { isMoving } from '../services/ops.js';
import { transcribeAudio } from '../services/ai.js';
import { runOperatorVoice, SCOPES } from '../services/operatorVoice.js';
import { speak } from '../pages/OperatorNavigate.jsx';
import { Icon } from './ui.jsx';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// One tap, then talk. Works while the bus is moving: the operator never has to
// read or type, and every answer is spoken back.
export default function VoiceAssist({ scope = 'home', big = false }) {
  const { go } = useNav();
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const moving = useStore((st) => isMoving(st.ops, OPERATOR.bus));
  const recRef = useRef(null);
  const mediaRef = useRef(null);
  const timer = useRef(null);
  useEffect(() => () => { stopAll(); clearTimeout(timer.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handle(text) {
    const t = String(text || '').trim();
    if (!t) { setErr('Didn\'t hear anything. Tap and try again.'); return; }
    setHeard(t);
    const r = runOperatorVoice(t, scope);
    setResult(r);
    speak(r.say);
    if (r.to) { clearTimeout(timer.current); timer.current = setTimeout(() => go(r.to), 1400); }
  }

  function stopAll() {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    try { if (mediaRef.current?.state === 'recording') mediaRef.current.stop(); } catch { /* ignore */ }
  }

  function start() {
    if (listening) { stopAll(); return; }
    setErr(null); setResult(null); setHeard('');
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    if (SR) {
      try {
        const rec = new SR();
        rec.lang = 'en-US';
        rec.interimResults = true;
        rec.continuous = false;
        let finalText = '';
        rec.onresult = (e) => {
          let fin = ''; let tmp = '';
          for (let i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) fin += e.results[i][0].transcript; else tmp += e.results[i][0].transcript;
          }
          finalText = fin;
          setHeard((fin + tmp).trim());
        };
        rec.onerror = (e) => {
          if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
            recRef.current = null; setListening(false); record(); return;
          }
          setListening(false);
          setErr(e.error === 'no-speech' ? 'Didn\'t hear anything. Tap and try again.' : 'Voice stopped. Tap and try again.');
        };
        rec.onend = () => {
          if (recRef.current !== rec) return;
          recRef.current = null;
          setListening(false);
          if (finalText.trim()) handle(finalText);
        };
        recRef.current = rec;
        rec.start();
        setListening(true);
        return;
      } catch { /* fall back to recording */ }
    }
    record();
  }

  async function record() {
    if (!(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined') || CONFIG.aiMode === 'offline') {
      setErr(moving ? 'Voice isn\'t available in this browser. Use the buttons when stopped.' : 'Voice isn\'t available in this browser. Type instead.'); setTyping(true); return;
    }
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (e) {
      setErr(e?.name === 'NotAllowedError' ? 'Microphone is blocked. On iPhone: aA → Website Settings → Microphone → Allow.' : 'No microphone found. Type instead.');
      setTyping(true); return;
    }
    const chunks = [];
    const mr = new MediaRecorder(stream);
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setListening(false); setBusy(true);
      try { handle(await transcribeAudio(new Blob(chunks, { type: mr.mimeType || 'audio/mp4' }))); } catch { setErr('Couldn\'t understand that. Try again or type.'); }
      setBusy(false);
    };
    mediaRef.current = mr;
    mr.start();
    setListening(true);
    setTimeout(() => { if (mr.state === 'recording') mr.stop(); }, 7000); // hands-free: stops on its own
  }

  const label = listening ? 'LISTENING… TAP TO STOP' : busy ? 'THINKING…' : big ? 'TALK TO SMART OPS' : 'TALK';

  return (
    <section className={`voice ${big ? 'voice-big' : ''} ${listening ? 'on' : ''}`} aria-live="polite">
      <button className="voice-btn" onClick={start} disabled={busy} aria-pressed={listening} aria-label={listening ? 'Stop listening' : 'Talk to SMART Ops'}>
        <Icon name={listening ? 'stop' : 'mic'} size={big ? 34 : 22} />
        <span>{label}</span>
      </button>
      {!heard && !result && !err && <div className="voice-hint">{SCOPES[scope]?.hint}</div>}
      {heard && <div className="voice-heard">“{heard}”</div>}
      {result && <div className={`voice-result ${result.tone === 'danger' ? 'danger' : ''}`}>{result.detail}{result.to ? ' · opening…' : ''}</div>}
      {err && <div className="voice-err">{err}</div>}
      {moving ? null : typing ? (
        <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); handle(typed); setTyped(''); }}>
          <input className="input grow" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="e.g. nearest restroom" aria-label="Type a request" />
          <button className="btn btn-primary" disabled={!typed.trim()}>Go</button>
        </form>
      ) : (
        <button className="linkbtn xs" onClick={() => setTyping(true)}>Type instead</button>
      )}
    </section>
  );
}
