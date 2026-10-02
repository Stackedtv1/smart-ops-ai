import { useState } from 'react';
import { useNav } from '../lib/router.jsx';
import { searchOps } from '../services/ops.js';
import { answerLocal } from '../services/copilot.js';
import { Icon } from './ui.jsx';

const EXAMPLES = [
  'Where is bus 4602?',
  'Did anyone find a blue backpack on Route 461?',
  'Show restroom locations near bus 4602',
  'Which buses reported potholes today?',
  'Which terminal received the lost iPhone?',
  'Who hasn’t acknowledged dispatch messages?',
];

// One box for Central Dispatch. Operational lookups are answered from live
// SMART Ops data; anything else falls through to Copilot.
export default function DispatchSearch({ onFocus }) {
  const { go } = useNav();
  const [q, setQ] = useState('');
  const [ans, setAns] = useState(null);

  function run(text) {
    const query = (text ?? q).trim();
    if (!query) return;
    setQ(query);
    let a = searchOps(query);
    if (!a) {
      const c = answerLocal(query);
      a = { kind: 'copilot', text: c.text, items: (c.items || []).map((i) => ({ label: i.label, to: i.ticketId ? `/ticket/${i.ticketId}` : i.bus ? `/fleet/${i.bus}` : null })) };
    }
    setAns({ q: query, ...a });
    if (a.focus) onFocus?.(a.focus);
  }

  return (
    <section className="dsearch">
      <form className="dsearch-box" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about any bus, item, restroom, road report or message…" aria-label="Dispatch search" />
        <button className="btn btn-primary btn-sm" type="submit">Search</button>
      </form>
      <div className="script-chips">
        {EXAMPLES.map((e) => <button key={e} className="chip" onClick={() => run(e)}>{e}</button>)}
      </div>
      {ans && (
        <div className="dsearch-ans" role="status">
          <div className="xs muted">“{ans.q}” · {ans.kind === 'copilot' ? 'answered by Copilot' : 'from live SMART Ops data'}</div>
          <div style={{ fontWeight: 700, whiteSpace: 'pre-line' }}>{ans.text}</div>
          {ans.items?.length > 0 && (
            <ul>
              {ans.items.map((i, n) => (
                <li key={n}>{i.to ? <button className="linkbtn" onClick={() => go(i.to)}>{i.label}</button> : i.label}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
