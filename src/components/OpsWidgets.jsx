import { useNav } from '../lib/router.jsx';
import { OPERATOR } from '../lib/config.js';
import { fmtTime, ago } from '../lib/time.js';
import { ackDetour, ackMessage, terminalName, LF_STAGES, riderAlertText } from '../services/ops.js';
import { useStore } from '../services/store.js';
import { stopById } from '../services/maps.js';
import { Icon } from './ui.jsx';

// The one-line summary that sits directly above every detour map.
export function DetourSummary({ d }) {
  if (!d) return null;
  return (
    <div className="dsum" role="status">
      <span><b>{d.bypassed.length}</b> stops bypassed</span>
      <span className="dot">•</span>
      <span><b>{d.temporary.length}</b> temporary stops</span>
      <span className="dot">•</span>
      <span className="delay">+{d.delayMin} min</span>
    </div>
  );
}

export function TurnIcon({ turn, size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {turn === 'left' ? <path d="M17 20v-8a3 3 0 0 0-3-3H6M10 5L6 9l4 4" /> : <path d="M7 20v-8a3 3 0 0 1 3-3h8M14 5l4 4-4 4" />}
    </svg>
  );
}

export function DetourBanner({ detour, bus = OPERATOR.bus, compact = false, onMap }) {
  if (!detour) return null;
  const acked = !!detour.acks?.[bus];
  return (
    <section className={`detour ${compact ? 'compact' : ''}`} aria-live="assertive">
      <div className="detour-h">
        <span className="detour-tag">DETOUR ACTIVE</span>
        <span className="mono xs">{detour.id}</span>
      </div>
      <div className="detour-t">Route {detour.routes.join('/')} {detour.direction}</div>
      <div className="detour-why">{detour.closure}</div>
      {!compact && (
        <ol className="detour-steps">
          {detour.steps.map((s, i) => (
            <li key={i}><b>{s.text}</b><span>{s.at}{s.then ? ` · then ${s.then}` : ''}</span></li>
          ))}
        </ol>
      )}
      <div className="detour-meta">
        <span><b>{detour.bypassed.length}</b> stops bypassed</span>
        <span><b>{detour.temporary.length}</b> temporary stops</span>
        <span><b>+{detour.delayMin} min</b></span>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        {onMap && <button className="btn btn-sm" onClick={onMap}>Open navigation</button>}
        {acked ? (
          <span className="tag tag-ok">✓ Acknowledged {fmtTime(detour.acks[bus])}</span>
        ) : (
          <button className="btn btn-sm btn-primary" onClick={() => ackDetour(detour.id, bus)}>Acknowledge detour</button>
        )}
      </div>
    </section>
  );
}

export function MessageCard({ m, recipient, by }) {
  const acked = m.acks?.[recipient];
  return (
    <div className={`msg-card ${m.priority === 'high' ? 'high' : ''}`}>
      <div className="row between">
        <span className="eyebrow">{m.from} → {m.to.label}</span>
        <span className="xs muted">{fmtTime(m.at)}</span>
      </div>
      <div style={{ fontWeight: 700, marginTop: 4 }}>{m.text}</div>
      {recipient && (
        <div style={{ marginTop: 8 }}>
          {acked ? <span className="tag tag-ok">✓ Acknowledged {fmtTime(acked.at)}</span> : <button className="btn btn-sm btn-primary" onClick={() => ackMessage(m.id, recipient, by)}>Acknowledge</button>}
        </div>
      )}
    </div>
  );
}

export function LostAlertCard({ item, bus = OPERATOR.bus }) {
  const { go } = useNav();
  const m = item.matches?.find((x) => x.bus === bus);
  return (
    <div className="lost-alert">
      <div className="row between">
        <span className="eyebrow" style={{ color: 'var(--accent)' }}>Lost item reported</span>
        <span className="mono xs">{item.id}</span>
      </div>
      <div style={{ fontWeight: 800, fontSize: 17 }}>{item.item}</div>
      <div className="small">{m ? m.trip : `Route ${item.route} ${item.direction}`} · near {stopById(item.stopId)?.name || 'route'} · around {fmtTime(item.approxAt)}</div>
      <div className="small muted">Check seats and floor at your next layover.</div>
      <button className="btn btn-sm btn-primary" style={{ marginTop: 8 }} onClick={() => go('/operator/lost')}>Respond: Found / Not on bus</button>
    </div>
  );
}

export function CustodyChain({ item }) {
  const reached = new Set(item.chain.map((c) => c.stage));
  const cur = LF_STAGES.indexOf(item.status);
  return (
    <div className="custody">
      <ol className="custody-steps">
        {LF_STAGES.map((s, i) => (
          <li key={s} className={`${reached.has(s) || i <= cur ? 'done' : ''} ${i === cur ? 'cur' : ''}`}>
            <span className="dot">{reached.has(s) || i < cur ? '✓' : i + 1}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <ul className="timeline" style={{ marginTop: 10 }}>
        {item.chain.map((c, i) => (
          <li key={i} className={i === item.chain.length - 1 ? 'last' : ''}>
            <span className="tt">{fmtTime(c.at)}</span>
            <span className="tdot" />
            <span><span className="tl">{c.stage}</span><span className="tb" style={{ display: 'block' }}>{c.by}</span></span>
          </li>
        ))}
      </ul>
      {item.terminal && <div className="small muted">Custody: {terminalName(item.terminal)}{item.shelf ? ` · ${item.shelf}` : ''} · updated {ago(item.chain[item.chain.length - 1].at)}</div>}
    </div>
  );
}

export function ReliefRow({ r, onPick, active }) {
  const pull = { safe: ['Bus can pull in', 'ok'], caution: ['Limited pull-in', 'warn'], no: ['No bus parking', 'bad'] }[r.busPull];
  return (
    <button className={`relief ${active ? 'on' : ''} ${r.usable ? '' : 'dim'}`} onClick={onPick}>
      <span className="relief-ico"><Icon name="restroom" size={22} /></span>
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="row between" style={{ gap: 8 }}>
          <b className="relief-n">{r.name}</b>
          <span className="num relief-d">{r.miles.toFixed(1)} mi</span>
        </span>
        <span className="relief-tags">
          <span className={`tier tier-${r.tier}`}>{r.tier === 'smart' ? 'SMART Verified' : r.tier === 'partner' ? 'Pending verification' : 'Public backup'}</span>
          <span className={`rt rt-${r.status.code}`}>{r.status.label}</span>
          <span className={`rt rt-${pull[1]}`}>{pull[0]}</span>
          {r.accessible && <span className="rt">♿ Accessible</span>}
          {r.ahead === false && <span className="rt">Behind you</span>}
          {r.detourNote && <span className={`rt ${r.detourNote.startsWith('On') ? 'rt-detour' : 'rt-bad'}`}>{r.detourNote}</span>}
        </span>
        <span className="xs muted">{r.type}{r.address ? ` · ${r.address}` : ''}</span>
      </span>
    </button>
  );
}

// Same detour update, shown on Command Center and Customer Service screens.
export function ServiceAlerts({ audience = 'command' }) {
  const detours = useStore((s) => s.ops.detours.filter((d) => d.active));
  if (!detours.length) return null;
  return detours.map((d) => (
    <div key={d.id} className="detour compact">
      <div className="detour-h"><span className="detour-tag">SERVICE ALERT · DETOUR</span><span className="mono xs">{d.id} · {fmtTime(d.at)}</span></div>
      <div className="detour-t" style={{ fontSize: 20 }}>Routes {d.routes.join('/')} {d.direction}: {d.closure}</div>
      <div className="detour-meta"><span><b>{d.bypassed.length}</b> stops bypassed</span><span><b>{d.temporary.length}</b> temporary stops</span><span><b>+{d.delayMin} min</b></span><span>{Object.keys(d.acks).length}/{d.recipients.length} operators acknowledged</span></div>
      {audience === 'customer' && <div className="rider-alert" style={{ color: 'var(--ink)' }}><b>Tell riders:</b> {riderAlertText(d)}</div>}
    </div>
  ));
}
