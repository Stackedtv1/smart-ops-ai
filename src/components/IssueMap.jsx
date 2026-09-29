import { useEffect, useMemo, useRef, useState } from 'react';
import { ROUTES, STOPS, MAP_STOPS, MILE_ROADS, MAP_W, MAP_H, BOUNDS, GTFS_META, project, stopById } from '../services/maps.js';
import { fmtTime } from '../lib/time.js';
import { deptLabel, catShort } from '../lib/config.js';
import { PriorityPill, StatusPill } from './ui.jsx';

// Built-in vector transit map (no tile server needed, so it also works inside
// sandboxed previews). Swap for Leaflet + OSM tiles in production if desired.

const RIVER = [[42.262, -83.170], [42.285, -83.130], [42.300, -83.100], [42.318, -83.065], [42.330, -83.030], [42.345, -82.990], [42.358, -82.975]];
const COUNTY_LABELS = [
  { t: 'OAKLAND', lat: 42.60, lng: -83.36 },
  { t: 'MACOMB', lat: 42.61, lng: -83.00 },
  { t: 'WAYNE', lat: 42.39, lng: -83.36 },
  { t: 'Detroit River', lat: 42.300, lng: -83.060, water: true },
];

function markerColor(t) {
  if (t.status === 'Resolved') return 'var(--ok)';
  return { high: 'var(--high)', medium: 'var(--med)', low: 'var(--low)' }[t.priority];
}

function fitView(box, aspect) {
  // box: [x0,y0,x1,y1] in map units; aspect = containerH / containerW
  const bw = box[2] - box[0];
  const bh = box[3] - box[1];
  let w = bw;
  let h = w * aspect;
  if (h < bh) {
    h = bh;
    w = h / aspect;
  }
  return { x: (box[0] + box[2]) / 2 - w / 2, y: (box[1] + box[3]) / 2 - h / 2, w };
}

const DEFAULT_BOX = GTFS_META.live ? [0, 0, MAP_W, MAP_H] : (() => {
  const [x0, y0] = project(42.625, -83.40);
  const [x1, y1] = project(42.285, -83.0);
  return [x0, y0, x1, y1];
})();

export default function IssueMap({ tickets, onOpen, height = 480, focus, showResolved = true }) {
  const wrap = useRef(null);
  const [size, setSize] = useState({ w: 800, h: height });
  const [view, setView] = useState(null);
  const [sel, setSel] = useState(null);
  const drag = useRef(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: r.width || 800, h: r.height || height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [height]);

  const aspect = size.h / size.w;
  const v = view || fitView(DEFAULT_BOX, aspect);
  const vh = v.w * aspect;
  const k = v.w / size.w; // map units per screen px

  useEffect(() => {
    if (!focus) return;
    const [x, y] = project(focus.lat, focus.lng);
    const w = 260;
    setView({ x: x - w / 2, y: y - (w * aspect) / 2, w });
  }, [focus?.lat, focus?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoom = (f, cx, cy) => {
    const nw = Math.min(MAP_W * 1.6, Math.max(90, v.w * f));
    const px = cx ?? v.x + v.w / 2;
    const py = cy ?? v.y + vh / 2;
    setView({ x: px - ((px - v.x) * nw) / v.w, y: py - ((py - v.y) * nw) / v.w, w: nw });
  };

  const onWheel = (e) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain wheel scrolls the page; pinch / ctrl+wheel zooms
    e.preventDefault();
    const r = wrap.current.getBoundingClientRect();
    zoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, v.x + (e.clientX - r.left) * k, v.y + (e.clientY - r.top) * k);
  };
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  const onDown = (e) => {
    drag.current = { sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y, moved: false };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
    if (d.moved) setView({ x: d.vx - dx * k, y: d.vy - dy * k, w: v.w });
  };
  const onUp = () => {
    setTimeout(() => (drag.current = null), 0);
  };

  const visible = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return tickets.filter((t) => t.location?.lat && (t.status !== 'Resolved' ? true : showResolved && t.resolution?.at >= today.getTime()));
  }, [tickets, showResolved]);

  // Spread markers that share a stop.
  const placed = useMemo(() => {
    const groups = new Map();
    const order = [...visible].sort((a, b) => (a.status === 'Resolved') - (b.status === 'Resolved') || a.createdAt - b.createdAt);
    return order.map((t) => {
      const key = t.stopId || `${t.location.lat},${t.location.lng}`;
      const i = groups.get(key) || 0;
      groups.set(key, i + 1);
      const [x, y] = project(t.location.lat, t.location.lng);
      const ang = i * 2.4;
      const rad = i === 0 ? 0 : 11 + i * 2.2;
      return { t, x, y, ox: Math.cos(ang) * rad, oy: Math.sin(ang) * rad };
    });
  }, [visible]);

  const selTicket = sel && tickets.find((t) => t.id === sel);
  const selPlaced = sel && placed.find((p) => p.t.id === sel);
  let popStyle = null;
  if (selPlaced) {
    const sx = (selPlaced.x - v.x) / k + selPlaced.ox;
    const sy = (selPlaced.y - v.y) / k + selPlaced.oy;
    const left = Math.min(Math.max(10, sx + 14), size.w - 310);
    const top = Math.min(Math.max(10, sy - 40), size.h - 320);
    popStyle = { left: Math.max(10, left), top: Math.max(10, top) };
  }

  const fs = (px) => px * k;

  return (
    <div className="map-wrap" ref={wrap} style={{ height }} >
      <svg
        viewBox={`${v.x} ${v.y} ${v.w} ${vh}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onUp}
        onClick={() => {
          if (!drag.current?.moved) setSel(null);
        }}
        role="img"
        aria-label="Map of open operational issues across SMART routes"
      >
        <rect x={-MAP_W} y={-MAP_H} width={MAP_W * 3} height={MAP_H * 3} fill="var(--map-bg)" />
        <polyline
          points={RIVER.map(([a, b]) => project(a, b).join(',')).join(' ')}
          fill="none" stroke="var(--map-water)" strokeWidth={fs(14)} strokeLinecap="round" strokeLinejoin="round"
        />
        {MILE_ROADS.map((m) => {
          const [x0, y] = project(m.lat, BOUNDS.west);
          const [x1] = project(m.lat, BOUNDS.east);
          return (
            <g key={m.name}>
              <line x1={x0} y1={y} x2={x1} y2={y} stroke="var(--map-road)" strokeWidth={fs(1.5)} />
              <text x={project(m.lat, BOUNDS.west + 0.01)[0]} y={y - fs(4)} fontSize={fs(10.5)} fill="var(--map-label)" fontWeight="600">{m.name}</text>
            </g>
          );
        })}
        {/* 8 Mile = Wayne county line; Dequindre = Oakland / Macomb line */}
        <line {...lineProps(42.4467, BOUNDS.west, 42.4467, BOUNDS.east)} stroke="var(--map-label)" strokeWidth={fs(1.2)} strokeDasharray={`${fs(6)} ${fs(4)}`} opacity=".7" />
        <line {...lineProps(42.4467, -83.0855, 42.668, -83.093)} stroke="var(--map-label)" strokeWidth={fs(1.2)} strokeDasharray={`${fs(6)} ${fs(4)}`} opacity=".7" />
        {COUNTY_LABELS.map((c) => {
          const [x, y] = project(c.lat, c.lng);
          return (
            <text key={c.t} x={x} y={y} fontSize={fs(c.water ? 11 : 13)} fill="var(--map-label)" fontWeight={c.water ? 500 : 800} letterSpacing={c.water ? 0 : fs(3)} fontStyle={c.water ? 'italic' : 'normal'}>
              {c.t}
            </text>
          );
        })}

        {ROUTES.filter((r) => r.path.length > 1 && (r.id !== '462' || r.fromFeed)).map((r) => (
          <polyline
            key={r.id}
            points={r.path.map(([a, b]) => project(a, b).join(',')).join(' ')}
            fill="none" stroke={r.color} strokeWidth={fs(r.type === 'FAST' ? 5 : 3.5)} strokeLinecap="round" strokeLinejoin="round" opacity=".85"
          />
        ))}
        {ROUTES.filter((r) => r.id !== '462' && r.path.length > 1).map((r) => {
          const mid = r.path[Math.min(r.path.length - 1, Math.floor(r.path.length * 0.62))];
          const [x, y] = project(mid[0], mid[1]);
          const label = r.id === '461' ? '461/462' : r.id;
          const w = fs(label.length * 7.4 + 10);
          return (
            <g key={`b${r.id}`} transform={`translate(${x + fs(8)},${y - fs(9)})`}>
              <rect width={w} height={fs(17)} rx={fs(3)} fill={r.color} />
              <text x={w / 2} y={fs(12.5)} fontSize={fs(12)} fill="#fff" fontWeight="800" textAnchor="middle" fontFamily="var(--font-display)">{label}</text>
            </g>
          );
        })}
        {(v.w < 520 ? MAP_STOPS : STOPS).map((s) => {
          const [x, y] = project(s.lat, s.lng);
          return <circle key={s.gtfsId || s.id} cx={x} cy={y} r={fs(v.w < 520 ? 2.2 : 2.8)} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={fs(1)} opacity=".8"><title>{`Stop ${s.id} · ${s.name}`}</title></circle>;
        })}

        {placed.map(({ t, x, y, ox, oy }) => {
          const fresh = now - t.createdAt < 90000 && t.status !== 'Resolved';
          const cx = x + ox * k;
          const cy = y + oy * k;
          const c = markerColor(t);
          return (
            <g
              key={t.id}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (!drag.current?.moved) setSel(t.id);
              }}
            >
              {fresh && <circle className="marker-pulse" cx={cx} cy={cy} r={fs(9)} fill={c} />}
              <circle cx={cx} cy={cy} r={fs(sel === t.id ? 10 : 8)} fill={c} stroke="var(--surface)" strokeWidth={fs(2.2)} />
              {t.ai.category === 'safety' && t.status !== 'Resolved' && (
                <text x={cx} y={cy + fs(3.6)} fontSize={fs(10)} textAnchor="middle" fill="#fff" fontWeight="900">!</text>
              )}
              <title>{`${t.id} · ${t.ai.title} · ${t.status}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="map-zoom">
        <button onClick={() => zoom(1 / 1.4)} aria-label="Zoom in">+</button>
        <button onClick={() => zoom(1.4)} aria-label="Zoom out">−</button>
        <button onClick={() => { setView(null); setSel(null); }} aria-label="Reset map" style={{ fontSize: 13 }}>⟲</button>
      </div>
      <div className="map-credit">
        {GTFS_META.live
          ? `Routes & stops: ${GTFS_META.source}${GTFS_META.feedVersion ? ` (feed ${GTFS_META.feedVersion})` : ''}`
          : 'Simplified route corridors'}
      </div>
      <div className="map-legend">
        <span><i style={{ background: 'var(--high)' }} />High</span>
        <span><i style={{ background: 'var(--med)' }} />Medium</span>
        <span><i style={{ background: 'var(--low)' }} />Low</span>
        <span><i style={{ background: 'var(--ok)' }} />Resolved</span>
      </div>

      {selTicket && popStyle && (
        <div className="map-pop" style={popStyle} onPointerDown={(e) => e.stopPropagation()}>
          <div className="row between">
            <span className="mono small" style={{ fontWeight: 600 }}>{selTicket.id}</span>
            <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)} aria-label="Close">✕</button>
          </div>
          <div className="row wrap" style={{ gap: 6, margin: '4px 0 6px' }}>
            {selTicket.status !== 'Resolved' && <PriorityPill p={selTicket.priority} />}
            <StatusPill s={selTicket.status} />
          </div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{selTicket.ai.title}</div>
          <div className="muted">
            {catShort(selTicket.ai.category) === 'Facility' ? `Stop ${selTicket.stopId} · ${stopById(selTicket.stopId)?.name || ''}` : `Bus ${selTicket.vehicle} · Route ${selTicket.route}`}
          </div>
          {selTicket.photo && <img src={selTicket.photo} alt="Operator photo" />}
          <div style={{ margin: '6px 0' }}>{selTicket.ai.summary}</div>
          <div className="small muted">
            Reported {fmtTime(selTicket.createdAt)} · {deptLabel(selTicket.department)}
            {selTicket.assignee ? ` · ${selTicket.assignee}` : ''}
          </div>
          <button className="btn btn-primary btn-sm btn-block" style={{ marginTop: 10 }} onClick={() => onOpen?.(selTicket.id)}>
            Open ticket
          </button>
        </div>
      )}
    </div>
  );
}

function lineProps(la0, ln0, la1, ln1) {
  const [x1, y1] = project(la0, ln0);
  const [x2, y2] = project(la1, ln1);
  return { x1, y1, x2, y2 };
}
