import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { useRole } from '../lib/role.js';
import { askSmartOps, SUGGEST } from '../services/ask.js';
import { Icon } from './ui.jsx';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

// One floating "Ask SMART Ops" button on every staff screen. The AI should
// make screens disappear: ask, get the answer and the one button you need.
export default function AskFab() {
  const { go } = useNav();
  const role = useRole() || 'dispatch';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [log, busy]);

  function ask(text) {
    const question = (text ?? q).trim();
    if (!question) return;
    setQ('');
    setBusy(true);
    setTimeout(() => {
      setLog((l) => [...l.slice(-3), { q: question, a: askSmartOps(question) }]);
      setBusy(false);
    }, 380);
  }

  function mic() {
    if (!SR) return;
    const rec = new SR();
    rec.lang = 'en-US';
    rec.onresult = (e) => ask(e.results[0][0].transcript);
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  return (
    <>
      {!open && (
        <button className="askfab" onClick={() => setOpen(true)} aria-label="Ask SMART Ops">
          <Icon name="sparkle" size={20} /> Ask SMART Ops
        </button>
      )}
      {open && (
        <section className="askpanel" role="dialog" aria-label="Ask SMART Ops">
          <div className="askpanel-h">
            <b><Icon name="sparkle" size={16} /> Ask SMART Ops</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>
          <div className="askpanel-b">
            {log.length === 0 && <div className="small muted">Ask anything about buses, detours, lost items or open work. Answers come from live SMART Ops data.</div>}
            {log.map((x, i) => (
              <div key={i} className="ask-turn">
                <div className="ask-q">{x.q}</div>
                <div className="ask-a">
                  <div style={{ whiteSpace: 'pre-line', fontWeight: 600 }}>{x.a.text}</div>
                  {x.a.list?.length > 0 && <ul>{x.a.list.map((l, j) => <li key={j}>{l}</li>)}</ul>}
                  {x.a.actions?.length > 0 && (
                    <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                      {x.a.actions.map((a) => <button key={a.to + a.label} className={`btn btn-sm ${a.primary ? 'btn-primary' : ''}`} onClick={() => { setOpen(false); go(a.to); }}>{a.label}</button>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && <div className="ask-a muted small">Checking live data…</div>}
            <div ref={end} />
          </div>
          <div className="askpanel-f">
            <div className="script-chips">{(SUGGEST[role] || SUGGEST.dispatch).map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}</div>
            <form className="row" style={{ gap: 6 }} onSubmit={(e) => { e.preventDefault(); ask(); }}>
              <input className="input grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. What's wrong with 3987?" aria-label="Question" autoFocus />
              {SR && <button type="button" className="btn" onClick={mic} disabled={listening} aria-label="Speak"><Icon name="mic" size={16} /></button>}
              <button className="btn btn-primary" disabled={!q.trim()}>Ask</button>
            </form>
          </div>
        </section>
      )}
    </>
  );
}
