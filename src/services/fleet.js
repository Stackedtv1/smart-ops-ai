// Fleet Health & Maintenance.
// Data path: Fleet/Bus number -> VIN -> maintenance-system record -> Guardian.
// In this demo the maintenance-system records are simulated (demoFleet.json).
// In production SMART Ops reads mileage, PM schedules, work orders and fault
// codes from SMART's existing fleet/maintenance system; nothing is entered twice.
import fleet from '../data/demoFleet.json';
import { isOpen, patternAlerts } from './store.js';
import { startOfDay } from '../lib/time.js';

const DAY = 86400000;
export const FLEET_RULES = { pmIntervalMi: fleet.pmIntervalMi, oilIntervalMi: fleet.oilIntervalMi, brakeInspectionDays: fleet.brakeInspectionDays, tireInspectionDays: fleet.tireInspectionDays, pmDueSoonMi: 500, pmWatchMi: 750, inspDueSoonDays: 7 };
export const FLEET_BUSES = fleet.vehicles.map((v) => v.bus);

const SAFETY_SYSTEMS = ['brakes', 'steering', 'tires', 'passenger_door', 'accessibility_equipment'];
const SYS_LABEL = { brakes: 'Brakes', passenger_door: 'Doors', accessibility_equipment: 'Wheelchair ramp / lift', preventive_maintenance: 'Preventive maintenance', warning_indicator: 'Warning lights', mirrors: 'Mirrors', hvac: 'HVAC', lights: 'Lights' };
export const sysLabel = (s) => SYS_LABEL[s] || s;

export const STATUS_ORDER = ['Critical Review', 'Attention Required', 'Maintenance Due', 'Normal'];

// Build the current record for a bus from base data + demo state (extra miles
// driven, work orders added during the demo).
export function vehicleRecord(bus, state, now = Date.now()) {
  const base = fleet.vehicles.find((v) => v.bus === String(bus));
  if (!base) return null;
  const f = state.fleet || {};
  const extra = f.extraMiles?.[bus] || 0;
  const extraDays = f.extraDays || 0;
  const mileage = base.mileage + extra;
  const day0 = startOfDay(now);
  const ago = (d) => day0 - (d + extraDays) * DAY;
  const nextPmAt = base.lastPmMi + fleet.pmIntervalMi;
  const workOrders = [
    ...base.workOrders.map((w) => ({ ...w, openedAt: ago(w.openedDaysAgo) })),
    ...(f.workOrders || []).filter((w) => w.bus === base.bus),
  ].map((w) => ({ ...w, status: f.woStatus?.[w.id] || w.status }));
  const brakeDue = ago(base.brakeInspDaysAgo) + fleet.brakeInspectionDays * DAY;
  const tireDue = ago(base.tireInspDaysAgo) + fleet.tireInspectionDays * DAY;
  return {
    ...base,
    mileage,
    engineHours: base.engineHours + Math.round(extra / 14),
    nextPmAt,
    pmRemainingMi: nextPmAt - mileage,
    lastPmAt: ago(base.lastPmDaysAgo),
    oilRemainingMi: base.lastOilMi + fleet.oilIntervalMi - mileage,
    brakeDueAt: brakeDue,
    brakeDueDays: Math.floor((brakeDue - now) / DAY),
    tireDueAt: tireDue,
    tireDueDays: Math.floor((tireDue - now) / DAY),
    faults: base.faults.filter((x) => x.active).map((x) => ({ ...x, at: ago(x.daysAgo) })),
    workOrders,
    openWorkOrders: workOrders.filter((w) => w.status !== 'Closed'),
    lastRepair: base.lastRepair ? { ...base.lastRepair, at: ago(base.lastRepair.daysAgo) } : null,
  };
}

export function openPmOrder(rec) {
  return rec.openWorkOrders.find((w) => w.system === 'preventive_maintenance');
}
export function openOrderFor(rec, system) {
  return rec.openWorkOrders.find((w) => w.system === system);
}

// Guardian status with the reasons behind it.
export function vehicleHealth(bus, state, now = Date.now()) {
  const rec = vehicleRecord(bus, state, now);
  if (!rec) return null;
  // Passenger/safety incidents are about people, not the vehicle's condition.
  const tickets = state.tickets.filter((t) => t.vehicle === rec.bus && t.ai.category === 'vehicle_defect');
  const open = tickets.filter(isOpen);
  const repeats = patternAlerts(state.tickets, now).filter((a) => a.kind === 'vehicle' && a.bus === rec.bus);
  const reasons = { 'Critical Review': [], 'Attention Required': [], 'Maintenance Due': [] };

  if (rec.pmRemainingMi < 0 && !openPmOrder(rec)) reasons['Critical Review'].push(`PM overdue by ${Math.abs(rec.pmRemainingMi).toLocaleString()} mi with no open work order`);
  rec.faults.filter((x) => x.severity === 'critical').forEach((x) => reasons['Critical Review'].push(`Critical fault ${x.code}: ${x.desc}`));
  repeats.forEach((a) => {
    const sub = state.tickets.find((t) => t.id === a.ticketIds[a.ticketIds.length - 1])?.ai.subcategory;
    const hasHigh = open.some((t) => t.ai.subcategory === sub && t.priority === 'high');
    if (SAFETY_SYSTEMS.includes(sub) && hasHigh) reasons['Critical Review'].push(`Repeat ${a.component.toLowerCase()} defect (${a.ticketIds.length} reports) with an open HIGH ticket`);
    else reasons['Attention Required'].push(`Repeat ${a.component.toLowerCase()} defect (${a.ticketIds.length} reports)`);
  });

  open.filter((t) => t.priority === 'high').forEach((t) => reasons['Attention Required'].push(`Open HIGH ticket: ${t.ai.title}`));
  rec.faults.filter((x) => x.severity !== 'critical').forEach((x) => reasons['Attention Required'].push(`Active fault ${x.code}: ${x.desc}`));

  if (rec.pmRemainingMi < 0 && openPmOrder(rec)) reasons['Maintenance Due'].push(`PM overdue by ${Math.abs(rec.pmRemainingMi).toLocaleString()} mi — ${openPmOrder(rec).id} ${openPmOrder(rec).status.toLowerCase()}`);
  else if (rec.pmRemainingMi >= 0 && rec.pmRemainingMi <= FLEET_RULES.pmWatchMi) reasons['Maintenance Due'].push(`PM due in ${rec.pmRemainingMi.toLocaleString()} mi`);
  if (rec.brakeDueDays <= FLEET_RULES.inspDueSoonDays) reasons['Maintenance Due'].push(rec.brakeDueDays < 0 ? `Brake inspection overdue ${Math.abs(rec.brakeDueDays)} d` : `Brake inspection due in ${rec.brakeDueDays} d`);
  if (rec.tireDueDays <= FLEET_RULES.inspDueSoonDays) reasons['Maintenance Due'].push(rec.tireDueDays < 0 ? `Tire inspection overdue ${Math.abs(rec.tireDueDays)} d` : `Tire inspection due in ${rec.tireDueDays} d`);
  if (rec.oilRemainingMi <= FLEET_RULES.pmWatchMi) reasons['Maintenance Due'].push(rec.oilRemainingMi < 0 ? `Oil service overdue ${Math.abs(rec.oilRemainingMi).toLocaleString()} mi` : `Oil service due in ${rec.oilRemainingMi.toLocaleString()} mi`);

  const status = STATUS_ORDER.find((s) => s === 'Normal' || reasons[s].length);
  return { rec, status, reasons, tickets, open, repeats };
}

export function fleetHealth(state, now = Date.now()) {
  return FLEET_BUSES.map((b) => vehicleHealth(b, state, now)).sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.rec.pmRemainingMi - b.rec.pmRemainingMi);
}
