// Live SMART bus positions from the live-buses Netlify function (GTFS-Realtime
// via Swiftly). Polls only while a screen is using it. Without an API key the
// function answers { live: false } and screens keep the simulated demo fleet.
import { useSyncExternalStore, useEffect } from 'react';
import { CONFIG } from '../lib/config.js';

const POLL_MS = 15_000;
let snap = { status: 'idle', live: false, reason: null, at: null, vehicles: [] };
const subs = new Set();
let users = 0;
let timer = null;

function set(next) { snap = { ...snap, ...next }; subs.forEach((f) => f()); }

async function poll() {
  if (CONFIG.aiMode === 'offline') { set({ status: 'off', live: false, reason: 'offline' }); return; }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 9000);
    const res = await fetch(`${CONFIG.functionsBase}/live-buses`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    set({ status: d.live ? 'live' : 'off', live: !!d.live, reason: d.reason || null, at: d.at || null, stale: !!d.stale, vehicles: d.vehicles || [] });
  } catch {
    set({ status: 'off', live: false, reason: 'unreachable' });
  }
}

function startPolling() {
  if (users++ > 0) return;
  poll();
  timer = setInterval(poll, POLL_MS);
}
function stopPolling() {
  if (--users > 0) return;
  clearInterval(timer);
  timer = null;
}

export function useLiveBuses() {
  useEffect(() => { startPolling(); return () => { stopPolling(); }; }, []);
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => snap, () => snap);
}

export const LIVE_REASON = {
  'no-key': 'Simulated buses · live SMART feed not connected yet (add the Swiftly API key)',
  'bad-key': 'Simulated buses · the Swiftly API key was rejected',
  'feed-error': 'Simulated buses · SMART live feed not responding',
  unreachable: 'Simulated buses · live feed unavailable',
  offline: 'Simulated buses · offline demo mode',
};
