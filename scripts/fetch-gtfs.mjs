// Build step: download SMART's public GTFS feed and extract real route shapes
// and stops for the demo routes into src/data/gtfs.generated.json.
//
// Runs before `vite build` (npm "prebuild"). Never fails the build: if the
// feed can't be reached, it keeps the last generated file (or writes an empty
// marker) and the app falls back to the simplified corridor lines.
//
// Local test with a downloaded zip:  GTFS_FILE=path/to/smart_gtfs.zip node scripts/fetch-gtfs.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src/data/gtfs.generated.json');
const STATUS = path.join(ROOT, 'public/gtfs-status.json');
const writeStatus = (o) => { try { fs.writeFileSync(STATUS, JSON.stringify({ checkedAt: new Date().toISOString(), ...o }, null, 2)); } catch { /* ignore */ } };
const ROUTES = (process.env.GTFS_ROUTES || '250,261,461,462,494,500,510').split(',').map((s) => s.trim());
const AGENCY = process.env.GTFS_AGENCY || 'SMART';
const URLS = [
  'https://apps1.smartbus.org/gtfs/smart_gtfs.zip',
  'http://apps1.smartbus.org/gtfs/smart_gtfs.zip',
  'https://www.smartbus.org/gtfs/smart_gtfs.zip',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// ---------- minimal zip reader (store + deflate) ----------
function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    files[name.split('/').pop()] = () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error(`unsupported compression ${method} for ${name}`);
    };
    p += 46 + nlen + elen + clen;
  }
  return files;
}

// ---------- CSV ----------
function splitLine(line) {
  const out = [];
  let cell = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') { if (line[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cell); cell = ''; }
    else cell += c;
  }
  out.push(cell);
  return out;
}
function* rows(text) {
  const lines = text.split(/\r?\n/);
  const head = splitLine(lines[0].replace(/^﻿/, '')).map((h) => h.trim());
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cells = splitLine(lines[i]);
    const o = {};
    head.forEach((h, j) => (o[h] = (cells[j] ?? '').trim()));
    yield o;
  }
}
const table = (files, name) => {
  const f = files[name];
  if (!f) throw new Error(`${name} missing from feed`);
  return f().toString('utf8');
};

// ---------- geometry ----------
function simplify(pts, tol = 0.00008) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0, idx = -1;
    const [ay, ax] = pts[a], [by, bx] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][1] - dx * pts[i][0] + bx * ay - by * ax) / len;
      if (d > max) { max = d; idx = i; }
    }
    if (max > tol && idx > 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const r5 = (n) => Math.round(n * 1e5) / 1e5;

// ---------- extract ----------
export function extract(buf) {
  const files = readZip(buf);
  const feedInfo = files['feed_info.txt'] ? [...rows(table(files, 'feed_info.txt'))][0] : null;

  const routes = [...rows(table(files, 'routes.txt'))].filter((r) => ROUTES.includes(r.route_short_name || r.route_id));
  const byRouteId = new Map(routes.map((r) => [r.route_id, r]));

  // trips per route, grouped by shape
  const shapeTrips = new Map(); // route_id -> Map(shape_id -> trip_id[])
  for (const t of rows(table(files, 'trips.txt'))) {
    if (!byRouteId.has(t.route_id)) continue;
    if (!shapeTrips.has(t.route_id)) shapeTrips.set(t.route_id, new Map());
    const m = shapeTrips.get(t.route_id);
    const k = t.shape_id || `trip:${t.trip_id}`;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t.trip_id);
  }

  const wantedShapes = new Set([...shapeTrips.values()].flatMap((m) => [...m.keys()]));
  const shapePts = new Map();
  if (files['shapes.txt']) {
    for (const s of rows(table(files, 'shapes.txt'))) {
      if (!wantedShapes.has(s.shape_id)) continue;
      if (!shapePts.has(s.shape_id)) shapePts.set(s.shape_id, []);
      shapePts.get(s.shape_id).push([Number(s.shape_pt_sequence), Number(s.shape_pt_lat), Number(s.shape_pt_lon)]);
    }
  }
  for (const pts of shapePts.values()) pts.sort((a, b) => a[0] - b[0]);

  // one representative trip per shape (most-used shape first) for stop lists
  const repTrips = new Map(); // trip_id -> route_id
  for (const [rid, m] of shapeTrips) {
    const shapes = [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 4);
    for (const [, trips] of shapes) repTrips.set(trips[0], rid);
  }
  const tripStops = new Map();
  for (const st of rows(table(files, 'stop_times.txt'))) {
    if (!repTrips.has(st.trip_id)) continue;
    if (!tripStops.has(st.trip_id)) tripStops.set(st.trip_id, []);
    tripStops.get(st.trip_id).push([Number(st.stop_sequence), st.stop_id]);
  }
  const allStops = new Map([...rows(table(files, 'stops.txt'))].map((s) => [s.stop_id, s]));

  const outRoutes = [];
  const outStops = new Map();
  for (const r of routes) {
    const m = shapeTrips.get(r.route_id) || new Map();
    // longest shape = main pattern; keep up to two distinct long patterns (branches)
    const shapes = [...m.keys()]
      .map((k) => shapePts.get(k))
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);
    const paths = shapes.slice(0, 1).map((pts) => simplify(pts.map(([, la, lo]) => [la, lo])).map(([la, lo]) => [r5(la), r5(lo)]));

    const stopIds = new Set();
    for (const [tid, rid] of repTrips) {
      if (rid !== r.route_id) continue;
      for (const [, sid] of (tripStops.get(tid) || []).sort((a, b) => a[0] - b[0])) stopIds.add(sid);
    }
    for (const sid of stopIds) {
      const s = allStops.get(sid);
      if (!s) continue;
      const cur = outStops.get(sid) || { id: s.stop_code || sid, gtfsId: sid, name: s.stop_name, lat: r5(Number(s.stop_lat)), lng: r5(Number(s.stop_lon)), routes: [] };
      const short = r.route_short_name || r.route_id;
      if (!cur.routes.includes(short)) cur.routes.push(short);
      outStops.set(sid, cur);
    }
    outRoutes.push({ id: r.route_short_name || r.route_id, longName: r.route_long_name, color: r.route_color ? `#${r.route_color}` : null, path: paths[0] || [], stopCount: stopIds.size });
  }

  return {
    source: `${AGENCY} GTFS`,
    generatedAt: new Date().toISOString(),
    feedVersion: feedInfo?.feed_version || null,
    feedStart: feedInfo?.feed_start_date || null,
    feedEnd: feedInfo?.feed_end_date || null,
    routes: outRoutes,
    stops: [...outStops.values()],
  };
}

async function download() {
  const errors = [];
  for (const url of URLS) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 90000);
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, redirect: 'follow', signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      console.log(`[gtfs] downloaded ${(buf.length / 1e6).toFixed(1)} MB from ${url}`);
      return buf;
    } catch (e) {
      errors.push(`${url}: ${e.message}`);
    }
  }
  throw new Error(errors.join(' | '));
}

async function main() {
  try {
    const buf = process.env.GTFS_FILE ? fs.readFileSync(process.env.GTFS_FILE) : await download();
    const data = extract(buf);
    const found = data.routes.filter((r) => r.path.length).map((r) => r.id);
    const missing = ROUTES.filter((r) => !found.includes(r));
    fs.writeFileSync(OUT, JSON.stringify(data));
    console.log(`[gtfs] wrote ${found.length} routes (${found.join(', ')}) and ${data.stops.length} stops; feed ${data.feedVersion || '?'} ${data.feedStart || ''}-${data.feedEnd || ''}`);
    if (missing.length) console.log(`[gtfs] not in feed, using simplified lines: ${missing.join(', ')}`);
    writeStatus({ ok: true, source: data.source, feedVersion: data.feedVersion, feedStart: data.feedStart, feedEnd: data.feedEnd, routes: data.routes.map((r) => ({ id: r.id, name: r.longName, points: r.path.length, stops: r.stopCount })), stops: data.stops.length, missing });
  } catch (e) {
    console.warn(`[gtfs] could not refresh SMART GTFS (${e.message}). Keeping previous data / fallback.`);
    if (!fs.existsSync(OUT)) fs.writeFileSync(OUT, JSON.stringify({ source: 'none', routes: [], stops: [] }));
    writeStatus({ ok: false, error: e.message });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
