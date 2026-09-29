import { useSyncExternalStore } from 'react';

// ROI model for SMART Ops AI. Every number is an editable assumption, not a
// SMART figure. Replace defaults with the agency's own data during discovery.

export const FIELDS = [
  { group: 'Reporting volume', key: 'reportsPerDay', label: 'Operator reports per day (all garages)', unit: 'reports', min: 5, max: 300, step: 5 },
  { group: 'Reporting volume', key: 'daysPerYear', label: 'Service days per year', unit: 'days', min: 250, max: 365, step: 5 },

  { group: 'Paperwork', key: 'paperMin', label: 'Staff time per paper report (fill, collect, re-key)', unit: 'min', min: 2, max: 40, step: 1 },
  { group: 'Paperwork', key: 'digitalMin', label: 'Staff time per digital report', unit: 'min', min: 0.5, max: 10, step: 0.5 },
  { group: 'Paperwork', key: 'laborRate', label: 'Loaded labor cost', unit: '$/hr', min: 25, max: 120, step: 1 },

  { group: 'Routing speed', key: 'paperDelayHrs', label: 'Time for a paper report to reach the right department', unit: 'hrs', min: 0.5, max: 24, step: 0.5 },
  { group: 'Routing speed', key: 'digitalDelayMin', label: 'Time for a digital report to reach the right department', unit: 'min', min: 1, max: 30, step: 1 },

  { group: 'Missed defects', key: 'roadCallsPerMonth', label: 'In-service road calls per month', unit: 'calls', min: 0, max: 200, step: 1 },
  { group: 'Missed defects', key: 'preventablePct', label: 'Share preventable with earlier defect reporting', unit: '%', min: 0, max: 40, step: 1 },
  { group: 'Missed defects', key: 'roadCallCost', label: 'Cost per road call (service truck, swap bus, lost trips)', unit: '$', min: 200, max: 5000, step: 50 },

  { group: 'Downtime', key: 'vehicleSharePct', label: 'Share of reports that are vehicle defects', unit: '%', min: 10, max: 80, step: 1 },
  { group: 'Downtime', key: 'holdsBusPct', label: 'Vehicle defects that hold a bus out of service', unit: '%', min: 0, max: 60, step: 1 },
  { group: 'Downtime', key: 'downtimeSavedHrs', label: 'Downtime saved per held bus (faster routing)', unit: 'hrs', min: 0, max: 8, step: 0.25 },
  { group: 'Downtime', key: 'busHourCost', label: 'Cost of a bus-hour out of service', unit: '$/hr', min: 20, max: 250, step: 5 },

  { group: 'System cost', key: 'annualCost', label: 'Annual SMART Ops AI cost (subscription + support)', unit: '$', min: 0, max: 500000, step: 1000 },
];

export const PRESETS = {
  conservative: {
    label: 'Conservative',
    reportsPerDay: 20, daysPerYear: 360, paperMin: 8, digitalMin: 3, laborRate: 45,
    paperDelayHrs: 4, digitalDelayMin: 5, roadCallsPerMonth: 30, preventablePct: 5, roadCallCost: 800,
    vehicleSharePct: 43, holdsBusPct: 10, downtimeSavedHrs: 0.5, busHourCost: 60, annualCost: 60000,
  },
  expected: {
    label: 'Expected',
    reportsPerDay: 30, daysPerYear: 360, paperMin: 14, digitalMin: 3, laborRate: 52,
    paperDelayHrs: 6, digitalDelayMin: 3, roadCallsPerMonth: 40, preventablePct: 10, roadCallCost: 1200,
    vehicleSharePct: 43, holdsBusPct: 15, downtimeSavedHrs: 1, busHourCost: 85, annualCost: 60000,
  },
};

export function computeRoi(v) {
  const reportsYr = v.reportsPerDay * v.daysPerYear;
  const hoursReturned = (reportsYr * Math.max(0, v.paperMin - v.digitalMin)) / 60;
  const paperwork = hoursReturned * v.laborRate;

  const roadCallsAvoided = v.roadCallsPerMonth * 12 * (v.preventablePct / 100);
  const missedDefects = roadCallsAvoided * v.roadCallCost;

  const heldBuses = reportsYr * (v.vehicleSharePct / 100) * (v.holdsBusPct / 100);
  const busHoursSaved = heldBuses * v.downtimeSavedHrs;
  const downtime = busHoursSaved * v.busHourCost;

  const delayHoursRemoved = reportsYr * Math.max(0, v.paperDelayHrs - v.digitalDelayMin / 60);

  const total = paperwork + missedDefects + downtime;
  const net = total - v.annualCost;
  const roiPct = v.annualCost > 0 ? (net / v.annualCost) * 100 : null;
  const paybackMonths = total > 0 ? (v.annualCost / total) * 12 : null;

  return {
    reportsYr, hoursReturned, fte: hoursReturned / 2080, paperwork,
    roadCallsAvoided, missedDefects, heldBuses, busHoursSaved, downtime,
    delayHoursRemoved, speedup: (v.paperDelayHrs * 60) / Math.max(1, v.digitalDelayMin),
    total, net, roiPct, paybackMonths,
    lines: [
      { key: 'paperwork', label: 'Reduced paperwork', value: paperwork, note: `${fmtNum(hoursReturned)} staff hours returned (${(hoursReturned / 2080).toFixed(1)} FTE)` },
      { key: 'missed', label: 'Fewer missed defects', value: missedDefects, note: `${fmtNum(roadCallsAvoided)} road calls avoided per year` },
      { key: 'downtime', label: 'Less bus downtime', value: downtime, note: `${fmtNum(busHoursSaved)} bus-hours back in service` },
    ],
  };
}

export const fmtMoney = (n) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`);
export const fmtNum = (n) => Math.round(n).toLocaleString();

// --- shared, remembered inputs (summary + calculator read the same values) ---
const KEY = 'smart-ops-ai.roi.v1';
const listeners = new Set();
let state = (() => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s?.values) return { preset: s.preset || 'custom', values: { ...PRESETS.expected, ...s.values } };
  } catch { /* ignore */ }
  return { preset: 'expected', values: { ...PRESETS.expected } };
})();

function commit(next) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useRoi() {
  return useSyncExternalStore((f) => { listeners.add(f); return () => listeners.delete(f); }, () => state, () => state);
}
export const setValue = (key, val) => commit({ preset: 'custom', values: { ...state.values, [key]: val } });
export const applyPreset = (name) => commit({ preset: name, values: { ...PRESETS[name] } });
