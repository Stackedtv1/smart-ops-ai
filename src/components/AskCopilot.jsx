import { useEffect, useRef, useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { CONFIG } from '../lib/config.js';
import { answerLocal, snapshotForAI } from '../services/copilot.js';

const SUGGESTED = [
  'What are our biggest unresolved issues right now?',
  'Which buses have repeat defects?',
  'What issues need attention right now?',
  "What's stalled or overdue?",
  'What did Guardian change today?',
  'Any offline devices or data problems?',
];

export default function AskCopilot({ tall = false }) {
  const { go } = useNav();
  const [msgs, setMsgs] = useState([{ role: 'ai', text: "I'm SMART Ops AI Copilot. Ask me about open issues, repeat defects, stalled work, or what Guardian has detected and changed." }]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'nearest' }), [msgs]);

  async function ask(question) {
    const text = question.trim();
    if (!text || busy) return;
    setQ('');
    setMsgs((m) => [...m, { role: 'me', text }]);
    setBusy(true);
    let reply = null;
    if (CONFIG.aiMode !== 'offline') {
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 9000);
        const res = await fetch(`${CONFIG.functionsBase}/ask-copilot`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: text, snapshot: snapshotForAI() }), signal: ctl.signal,
        });
        clearTimeout(tm);
        if (res.ok) {
          const d = await res.json();
          if (d.answer) reply = { text: d.answer, items: (d.ticket_ids || []).map((id) => ({ ticketId: id, label: id })) };
        }
      } catch { /* fall back to local answer */ }
    }
    if (!reply) {
      await new Promise((r) => setTimeout(r, 450));
      reply = answerLocal(text);
    }
    setMsgs((m) => [...m, { role: 'ai', ...reply }]);
    setBusy(false);
  }

  return (
    <section className={`panel cp-chat ${tall ? 'tall' : ''}`}>
      <div className="panel-h"><h2>Ask SMART Ops AI Copilot</h2><span className="small muted">Answers from live ticket data</span></div>
      <div className="cp-msgs" aria-live="polite">
        {msgs.map((m, i) => (
          <div key={i} className={`cp-msg ${m.role}`}>
            <div>{m.text}</div>
            {m.items?.length > 0 && (
              <ul className="cp-items">
                {m.items.map((it, j) => (
                  <li key={j}>
                    {it.ticketId ? <a href={`#/ticket/${it.ticketId}`} onClick={(e) => { e.preventDefault(); go(`/ticket/${it.ticketId}`); }}>{it.label}</a> : it.label}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {busy && <div className="cp-msg ai muted">Checking live data…</div>}
        <div ref={endRef} />
      </div>
      <div className="panel-b stack-sm" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="script-chips">
          {SUGGESTED.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); ask(q); }}>
          <input id="copilot-q" className="input grow" placeholder="e.g. Which buses have repeat defects?" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Ask Copilot" />
          <button className="btn btn-primary" disabled={!q.trim() || busy}>Ask</button>
        </form>
      </div>
    </section>
  );
}

