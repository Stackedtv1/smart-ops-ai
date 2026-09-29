import routeData from '../data/demoRoutes.json';
import stopData from '../data/demoStops.json';
import gtfs from '../data/gtfs.generated.json';

// Real SMART route shapes and stops come from the public GTFS feed, pulled at
// build time by scripts/fetch-gtfs.mjs. Anything missing from the feed falls
// back to the simplified corridor lines in demoRoutes.json.
const G_ROUTES = new Map((gtfs.routes || []).filter((r) => r.path?.length > 1).map((r) => [String(r.id), r]));
const G_STOPS = gtfs.stops || [];

export const GTFS_META = {
  live: G_ROUTES.size > 0,
  source: gtfs.source,
  feedVersion: gtfs.feedVersion,
  feedStart: gtfs.feedStart,
  feedEnd: gtfs.feedEnd,
  routesFromFeed: [...G_ROUTES.keys()],
  stopCount: G_STOPS.length,
};

export const ROUTES = routeData.routes.map((r) => {
  const g = G_ROUTES.get(r.id);
  if (g) return { ...r, path: g.path, fromFeed: true, gtfsName: g.longName, stopCount: g.stopCount };
  return r.sharesPathWith ? { ...r, path: routeData.routes.find((x) => x.id === r.sharesPathWith).path } : r;
});

function distM(aLat, aLng, bLat, bLng) {
  const k = Math.cos(((aLat + bLat) / 2) * (Math.PI / 180));
  return Math.hypot(aLat - bLat, (aLng - bLng) * k) * 111320;
}

// Demo "key" stops (the intersections the scripted reports mention) snap to the
// nearest real SMART stop on the same route, taking its stop ID and name.
export const STOPS = stopData.stops.map((s) => {
  let best = null;
  for (const g of G_STOPS) {
    if (!g.routes.some((r) => s.routes.includes(r))) continue;
    const d = distM(s.lat, s.lng, g.lat, g.lng);
    if (d < 600 && (!best || d < best.d)) best = { g, d };
  }
  if (!best) return { ...s, demoId: s.id };
  const g = best.g;
  return { ...s, demoId: s.id, id: String(g.id), name: g.name, lat: g.lat, lng: g.lng, routes: [...new Set([...s.routes, ...g.routes])], fromFeed: true };
});

// Every stop drawn on the map: the full feed when available.
export const MAP_STOPS = G_STOPS.length ? G_STOPS : STOPS;

export const routeById = (id) => ROUTES.find((r) => r.id === String(id));
export const stopById = (id) => {
  const k = String(id);
  return STOPS.find((s) => s.id === k) || STOPS.find((s) => s.demoId === k) || G_STOPS.find((s) => String(s.id) === k) || null;
};

export function routeLabel(id) {
  const r = routeById(id);
  return r ? `${r.id} ${r.name}` : `Route ${id}`;
}

// Combined label for corridor stops served by 461 and 462.
export function stopRoutesLabel(stop) {
  if (!stop) return '';
  const ids = stop.routes;
  const names = [...new Set(ids.map((id) => routeById(id)?.name).filter(Boolean))];
  return `${ids.join('/')} ${names.join(' / ')}`;
}

function norm(text) {
  return ` ${String(text || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')} `;
}

// Finds a stop named in free text ("Woodward and Nine Mile").
export function findStopInText(text) {
  const t = norm(text);
  let best = null;
  for (const s of STOPS) {
    const road = s.road.some((k) => t.includes(` ${k} `) || t.includes(` ${k}`));
    const cross = s.cross.some((k) => t.includes(` ${k} `) || t.includes(` ${k}`));
    const score = (road ? 2 : 0) + (cross ? 1 : 0);
    if (road && cross && (!best || score > best.score)) best = { stop: s, score };
  }
  return best?.stop || null;
}

export function nearestStop(lat, lng) {
  let best = null;
  for (const s of STOPS) {
    const d = (s.lat - lat) ** 2 + ((s.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (!best || d < best.d) best = { s, d };
  }
  return best?.s || null;
}

// Map projection for the built-in transit map (Metro Detroit bounding box).
export const BOUNDS = (() => {
  const b = { north: 42.668, south: 42.262, west: -83.415, east: -82.975 };
  for (const r of ROUTES) for (const [la, lo] of r.path) {
    b.north = Math.max(b.north, la + 0.01); b.south = Math.min(b.south, la - 0.01);
    b.west = Math.min(b.west, lo - 0.015); b.east = Math.max(b.east, lo + 0.015);
  }
  return b;
})();
const K = Math.cos((42.46 * Math.PI) / 180);
export const MAP_W = 1000;
export const MAP_H = Math.round(((BOUNDS.north - BOUNDS.south) / ((BOUNDS.east - BOUNDS.west) * K)) * MAP_W);

export function project(lat, lng) {
  const x = ((lng - BOUNDS.west) / (BOUNDS.east - BOUNDS.west)) * MAP_W;
  const y = ((BOUNDS.north - lat) / (BOUNDS.north - BOUNDS.south)) * MAP_H;
  return [x, y];
}

// Mile roads north of downtown, for basemap orientation.
export const MILE_ROADS = [
  { name: '8 Mile', lat: 42.4467 },
  { name: '10 Mile', lat: 42.4755 },
  { name: '12 Mile', lat: 42.5050 },
  { name: '14 Mile', lat: 42.5335 },
  { name: '16 Mile / Big Beaver', lat: 42.5625 },
  { name: '18 Mile', lat: 42.5915 },
];
