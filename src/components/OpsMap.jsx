import { useEffect, useMemo, useRef, useState } from 'react';
import { ROUTES, MILE_ROADS, BOUNDS, project, routeById } from '../services/maps.js';
import { RELIEF, TERMINALS } from '../services/ops.js';

// Operations map: routes, live (simulated) bus positions, relief
// points, operator field reports and dispatch detours (normal route vs detour).
// Pure SVG so it works offline on bad venue Wi-Fi.

const FIELD_COLOR = { road_blocked: 'var(--high)', construction: 'var(--med)', road_hazard: 'var(--med)', restroom_closed: 'var(--low)', stop_inaccessible: 'var(--med)', shelter_damaged: 'var(--low)', safe_parking: 'var(--ok)', other: 'var(--muted)' };
const BUS_COLOR = { 'On time': 'var(--ok)', Late: 'var(--med)', Held: 'var(--high)', 'No AVL ping': 'var(--muted)' };

const toPts = (path) => path.map(([la, lo]) => project(la, lo).join(',')).join(' ');

export default function OpsMap({
  routes = null, buses = [], relief = null, field = [], detours = [], you = null, fit = null, height = 360,
  showTerminals = false, onPick, label, legend = true, trail = null, heading = null,
}) {
  const wrap = useRef(null);
  const [w, setW] = useState(600);
  const [pick, setPick] = useState(null);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = routes ? ROUTES.filter((r) => routes.includes(r.id) && r.path?.length > 1) : ROUTES.filter((r) => r.path?.length > 1);
  const reliefPts = relief || [];

  const box = useMemo(() => {
    const pts = fit?.length ? fit : shown.flatMap((r) => r.path);
    if (!pts.length) return { x: 0, y: 0, w: 1000, h: 800 };
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [la, lo] of pts) {
      const [x, y] = project(la, lo);
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const pad = Math.max(14, (x1 - x0) * 0.16, (y1 - y0) * 0.16);
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    // match container aspect
    const aspect = height / Math.max(1, w);
    let bw = x1 - x0, bh = y1 - y0;
    if (bh / bw < aspect) { const nh = bw * aspect; y0 -= (nh - bh) / 2; bh = nh; } else { const nw = bh / aspect; x0 -= (nw - bw) / 2; bw = nw; }
    return { x: x0, y: y0, w: bw, h: bh };
  }, [fit, shown.map((r) => r.id).join(','), w, height]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = box.w / Math.max(1, w); // map units per px
  const px = (n) => n * k;

  const choose = (item) => {
    setPick(item);
    onPick?.(item);
  };

  return (
    <div className="opsmap" ref={wrap} style={{ height }}>
      <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} width="100%" height={height} role="img" aria-label={label || 'Operations map'} onClick={() => setPick(null)}>
        <rect x={box.x} y={box.y} width={box.w} height={box.h} fill="var(--map-bg)" />
        {MILE_ROADS.map((m) => {
          const [, y] = project(m.lat, BOUNDS.west);
          return (
            <g key={m.name}>
              <line x1={box.x} x2={box.x + box.w} y1={y} y2={y} stroke="var(--map-road)" strokeWidth={px(1.5)} />
              <text x={box.x + px(6)} y={y - px(4)} fontSize={px(10)} fill="var(--map-label)" fontWeight="600">{m.name}</text>
            </g>
          );
        })}
        {ROUTES.filter((r) => r.path?.length > 1 && !shown.includes(r)).map((r) => (
          <polyline key={`bg-${r.id}`} points={toPts(r.path)} fill="none" stroke="var(--map-road)" strokeWidth={px(2)} strokeLinejoin="round" />
        ))}
        {shown.map((r) => (
          <polyline key={r.id} points={toPts(r.path)} fill="none" stroke={detours.length ? '#8796ab' : r.color} strokeOpacity=".8" strokeWidth={px(detours.length ? 5 : 4)} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {trail && trail.length > 1 && <polyline points={toPts(trail)} fill="none" stroke="#0a84ff" strokeOpacity=".35" strokeWidth={px(7)} strokeLinecap="round" strokeLinejoin="round" />}

        {detours.map((d) => (
          <g key={d.id || d.templateId || 'plan'}>
            {/* blocked section */}
            <polyline points={toPts(d.closedPath)} fill="none" stroke="#fff" strokeWidth={px(9)} strokeLinecap="round" opacity=".8" />
            <polyline points={toPts(d.closedPath)} fill="none" stroke="#e01e1e" strokeWidth={px(6)} strokeDasharray={`${px(7)} ${px(5)}`} strokeLinecap="round" />
            {/* new bus route */}
            <polyline points={toPts(d.detourPath)} fill="none" stroke="#fff" strokeWidth={px(11)} strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={toPts(d.detourPath)} fill="none" stroke="#0a84ff" strokeWidth={px(7)} strokeLinejoin="round" strokeLinecap="round" />
            {(d.bypassed || []).filter((b) => b.pt).map((b) => {
              const [x, y] = project(b.pt[0], b.pt[1]);
              return (
                <g key={b.name} transform={`translate(${x},${y})`}>
                  <circle r={px(6.5)} fill="#e01e1e" stroke="#fff" strokeWidth={px(1.6)} />
                  <path d={`M${-px(2.6)} ${-px(2.6)} L${px(2.6)} ${px(2.6)} M${px(2.6)} ${-px(2.6)} L${-px(2.6)} ${px(2.6)}`} stroke="#fff" strokeWidth={px(1.6)} />
                </g>
              );
            })}
            {(d.temporary || []).filter((t) => t.pt).map((t) => {
              const [x, y] = project(t.pt[0], t.pt[1]);
              return (
                <g key={t.name} transform={`translate(${x},${y})`}>
                  <rect x={-px(8)} y={-px(8)} width={px(16)} height={px(16)} rx={px(3)} fill="#f2b705" stroke="#1c1600" strokeWidth={px(1.5)} />
                  <text y={px(4)} textAnchor="middle" fontSize={px(10)} fontWeight="900" fill="#1c1600">T</text>
                </g>
              );
            })}
            {(() => {
              const mid = d.closedPath[Math.floor(d.closedPath.length / 2)];
              const [x, y] = project(mid[0], mid[1]);
              return (
                <g transform={`translate(${x + px(16)},${y})`}>
                  <rect x={-px(30)} y={-px(9)} width={px(60)} height={px(18)} rx={px(4)} fill="#e01e1e" />
                  <text y={px(4)} textAnchor="middle" fontSize={px(10)} fontWeight="900" fill="#fff">CLOSED</text>
                </g>
              );
            })()}
          </g>
        ))}

        {showTerminals && TERMINALS.map((t) => {
          const [x, y] = project(t.lat, t.lng);
          return (
            <g key={t.id} transform={`translate(${x},${y})`}>
              <rect x={-px(7)} y={-px(7)} width={px(14)} height={px(14)} rx={px(2)} fill="var(--bar)" stroke="#fff" strokeWidth={px(1.5)} />
              <text x={px(10)} y={px(4)} fontSize={px(11)} fontWeight="700" fill="var(--ink-2)">{t.name}</text>
            </g>
          );
        })}

        {reliefPts.map((r) => {
          const [x, y] = project(r.lat, r.lng);
          const st = r.status?.code;
          const fill = st === 'closed' ? 'var(--high)' : st === 'hours' ? 'var(--muted)' : r.usable === false ? 'var(--low)' : 'var(--ok)';
          return (
            <g key={r.id} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); choose({ type: 'relief', item: r }); }}>
              <circle r={px(9)} fill={fill} stroke="#fff" strokeWidth={px(2)} />
              <text y={px(3.6)} textAnchor="middle" fontSize={px(10)} fontWeight="800" fill="#fff">WC</text>
            </g>
          );
        })}

        {field.map((f) => {
          const [x, y] = project(f.lat, f.lng);
          return (
            <g key={f.id} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); choose({ type: 'field', item: f }); }}>
              <path d={`M0 ${-px(10)} L${px(9)} ${px(7)} L${-px(9)} ${px(7)} Z`} fill={FIELD_COLOR[f.kind] || 'var(--muted)'} stroke="#fff" strokeWidth={px(1.6)} strokeLinejoin="round" />
              <text y={px(5)} textAnchor="middle" fontSize={px(9)} fontWeight="900" fill="#fff">!</text>
            </g>
          );
        })}

        {buses.map((b) => {
          const [x, y] = project(b.lat, b.lng);
          const c = BUS_COLOR[b.status] || 'var(--accent)';
          return (
            <g key={b.bus} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); choose({ type: 'bus', item: b }); }}>
              <rect x={-px(17)} y={-px(9)} width={px(34)} height={px(18)} rx={px(4)} fill={c} stroke="#fff" strokeWidth={px(1.5)} />
              <text y={px(4)} textAnchor="middle" fontSize={px(11)} fontWeight="800" fill="#fff" fontFamily="var(--font-mono)">{b.bus}</text>
            </g>
          );
        })}

        {you && (() => {
          const [x, y] = project(you.lat, you.lng);
          return (
            <g transform={`translate(${x},${y})`}>
              <circle r={px(16)} fill="var(--accent)" opacity=".18" />
              <circle r={px(8)} fill="var(--accent)" stroke="#fff" strokeWidth={px(2.5)} />
              <text x={px(13)} y={-px(10)} fontSize={px(11)} fontWeight="800" fill="var(--ink)">You · Bus {you.bus}</text>
            </g>
          );
        })()}
      </svg>
      {pick && (
        <div className="opsmap-pop" role="status">
          <button className="btn btn-ghost btn-sm" style={{ float: 'right', marginTop: -4 }} onClick={() => setPick(null)} aria-label="Close">✕</button>
          {pick.type === 'bus' && (<><b>Bus {pick.item.bus}</b> · Route {pick.item.route} {pick.item.dir}<div className="small muted">{pick.item.status}{pick.item.late != null && pick.item.status !== 'No AVL ping' ? ` · ${pick.item.late > 0 ? `${pick.item.late} min late` : 'on schedule'}` : ''}{pick.item.layover ? ' · at layover' : ''}</div></>)}
          {pick.type === 'relief' && (<><b>{pick.item.name}</b><div className="small muted">{pick.item.type} · {pick.item.hours}</div><div className="small">{pick.item.busPullNote}</div></>)}
          {pick.type === 'field' && (<><b>{pick.item.label}</b> · Bus {pick.item.bus}<div className="small">“{pick.item.text}”</div><div className="small muted">Routed to {pick.item.routedTo} · {pick.item.status}</div></>)}
        </div>
      )}
      {legend && <div className="opsmap-legend xs">
        {buses.length > 0 && <span><i style={{ background: 'var(--ok)' }} />Bus on time</span>}
        {buses.length > 0 && <span><i style={{ background: 'var(--med)' }} />Late</span>}
        {field.length > 0 && <span><i className="tri" />Operator report</span>}
        {reliefPts.length > 0 && <span><i style={{ background: 'var(--ok)', borderRadius: 99 }} />Relief point</span>}
        {detours.length > 0 && <span><i style={{ background: '#8796ab' }} />Normal route</span>}
        {detours.length > 0 && <span><i style={{ background: '#e01e1e' }} />Closed</span>}
        {detours.length > 0 && <span><i style={{ background: '#0a84ff' }} />Detour</span>}
        {detours.some((d) => d.temporary?.length) && <span><i style={{ background: '#f2b705' }} />Temp stop</span>}
      </div>}
    </div>
  );
}

export const routeColor = (id) => routeById(id)?.color || 'var(--accent)';
export { RELIEF };
