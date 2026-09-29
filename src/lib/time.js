export const MIN = 60 * 1000;

export function startOfDay(ts = Date.now()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function yymmdd(ts = Date.now()) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: 'long', day: 'numeric' });
}

export function fmtDateTime(ts) {
  const today = startOfDay();
  if (ts >= today) return `Today ${fmtTime(ts)}`;
  return `${new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' })} ${fmtTime(ts)}`;
}

export function ago(ts, now = Date.now()) {
  const m = Math.max(0, Math.round((now - ts) / MIN));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ${m % 60} min ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function durationLabel(ms) {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} hr ${m % 60} min`;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
