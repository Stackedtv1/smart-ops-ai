import routeData from '../data/demoRoutes.json';
import stopData from '../data/demoStops.json';

export const ROUTES = routeData.routes.map((r) =>
  r.sharesPathWith ? { ...r, path: routeData.routes.find((x) => x.id === r.sharesPathWith).path } : r
);
export const STOPS = stopData.stops;

export const routeById = (id) => ROUTES.find((r) => r.id === String(id));
export const stopById = (id) => STOPS.find((s) => s.id === String(id));

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
export const BOUNDS = { north: 42.668, south: 42.262, west: -83.415, east: -82.975 };
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
