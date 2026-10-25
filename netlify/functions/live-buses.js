// GET -> { live, at, count, vehicles: [{ id, label, route, dir, lat, lng, bearing, speedMph, ts, tripId, stopId }], reason? }
//
// Pulls SMART's public GTFS-Realtime Vehicle Positions feed (hosted by Swiftly)
// and returns plain JSON for the app. The API key stays here on the server.
//
// Netlify environment variables:
//   SWIFTLY_API_KEY        required — key from Swiftly (sent as the Authorization header)
//   SWIFTLY_VEHICLES_URL   optional — override the feed URL
//
// No key, or the feed is down -> { live: false, reason } and the app keeps
// showing its simulated buses.

const FEED_URL = process.env.SWIFTLY_VEHICLES_URL || 'https://api.goswift.ly/real-time/detroit-smartbus/gtfs-rt-vehicle-positions';
const STALE_SEC = 5 * 60; // ignore positions older than 5 minutes
const CACHE_MS = 10_000; // one upstream call per 10 s per function instance

let cache = { at: 0, body: null };

// ---------- minimal protobuf reader (only what GTFS-RT needs) ----------
function readVarint(buf, pos) {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('truncated varint');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7n;
  }
}

// Returns { fieldNumber: [values] }. varint -> BigInt, length-delimited -> Buffer,
// fixed32 -> Buffer(4), fixed64 -> Buffer(8).
function fields(buf) {
  const out = {};
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const field = Number(key >> 3n);
    const wire = Number(key & 7n);
    let val;
    if (wire === 0) [val, pos] = readVarint(buf, pos);
    else if (wire === 1) { val = buf.subarray(pos, pos + 8); pos += 8; }
    else if (wire === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      val = buf.subarray(pos, pos + Number(len));
      pos += Number(len);
    } else if (wire === 5) { val = buf.subarray(pos, pos + 4); pos += 4; }
    else throw new Error(`unsupported wire type ${wire}`);
    (out[field] ||= []).push(val);
  }
  return out;
}

const str = (v) => (v ? Buffer.from(v).toString('utf8') : null);
const f32 = (v) => (v && v.length === 4 ? Buffer.from(v).readFloatLE(0) : null);
const num = (v) => (v == null ? null : Number(v));

export function decodeVehiclePositions(buf) {
  const msg = fields(buf);
  const header = msg[1]?.[0] ? fields(msg[1][0]) : {};
  const feedTs = num(header[3]?.[0]);
  const vehicles = [];
  for (const ent of msg[2] || []) {
    const e = fields(ent);
    const vpRaw = e[4]?.[0];
    if (!vpRaw) continue;
    const vp = fields(vpRaw);
    const trip = vp[1]?.[0] ? fields(vp[1][0]) : {};
    const veh = vp[8]?.[0] ? fields(vp[8][0]) : {};
    const p = vp[2]?.[0] ? fields(vp[2][0]) : null;
    if (!p) continue;
    const lat = f32(p[1]?.[0]);
    const lng = f32(p[2]?.[0]);
    if (lat == null || lng == null || (lat === 0 && lng === 0)) continue;
    const speed = f32(p[5]?.[0]); // metres per second
    vehicles.push({
      id: str(veh[1]?.[0]) || str(e[1]?.[0]),
      label: str(veh[2]?.[0]) || str(veh[1]?.[0]) || null,
      route: str(trip[5]?.[0]),
      dir: trip[6]?.[0] != null ? num(trip[6][0]) : null,
      tripId: str(trip[1]?.[0]),
      stopId: str(vp[7]?.[0]),
      lat: Math.round(lat * 1e6) / 1e6,
      lng: Math.round(lng * 1e6) / 1e6,
      bearing: f32(p[3]?.[0]),
      speedMph: speed != null ? Math.round(speed * 2.23694) : null,
      ts: num(vp[5]?.[0]) || feedTs,
    });
  }
  return { feedTs, vehicles };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=10' },
});

export default async () => {
  const key = process.env.SWIFTLY_API_KEY;
  if (!key) return json({ live: false, reason: 'no-key', vehicles: [] });
  if (cache.body && Date.now() - cache.at < CACHE_MS) return json(cache.body);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(FEED_URL, { headers: { Authorization: key, Accept: 'application/x-protobuf' }, signal: ctl.signal });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) return json({ live: false, reason: 'bad-key', vehicles: [] });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { feedTs, vehicles } = decodeVehiclePositions(Buffer.from(await res.arrayBuffer()));
    const nowSec = Math.floor(Date.now() / 1000);
    const fresh = vehicles.filter((v) => !v.ts || nowSec - v.ts <= STALE_SEC);
    const body = { live: true, at: new Date().toISOString(), feedTs, count: fresh.length, vehicles: fresh };
    cache = { at: Date.now(), body };
    return json(body);
  } catch (err) {
    if (cache.body) return json({ ...cache.body, stale: true });
    return json({ live: false, reason: 'feed-error', detail: String(err.message || err), vehicles: [] });
  }
};
