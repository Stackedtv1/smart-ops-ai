// Runtime configuration. Vite injects import.meta.env at build time.
const env = {
  ...((typeof import.meta !== 'undefined' && import.meta.env) || {}),
  // Optional runtime override (used by the single-file hosted preview).
  ...((typeof window !== 'undefined' && window.__SMART_OPS_ENV__) || {}),
};

export const CONFIG = {
  // 'auto' tries the Netlify AI function, falls back to the on-device demo classifier.
  // 'offline' never calls external APIs (used for the hosted demo preview).
  aiMode: env.VITE_AI_MODE || 'auto',
  supabaseUrl: env.VITE_SUPABASE_URL || '',
  supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || '',
  functionsBase: env.VITE_FUNCTIONS_BASE || '/.netlify/functions',
};

export const OPERATOR = {
  id: 'DEMO-1047',
  name: 'Marcus Johnson',
  garage: 'Oakland Terminal',
  bus: '4602',
  route: '461',
  stopId: '1301',
  shift: 'Morning',
};

export const CATEGORIES = {
  vehicle_defect: { label: 'Vehicle Defect', short: 'Vehicle' },
  facilities: { label: 'Stop / Shelter', short: 'Facility' },
  safety: { label: 'Safety / Security', short: 'Safety' },
  operations: { label: 'Operations', short: 'Operations' },
  other: { label: 'Other', short: 'Other' },
};

export const DEPARTMENTS = {
  maintenance: { label: 'Maintenance', crews: ['Tech D. Alvarez', 'Tech R. Chen', 'Tech K. Oduya'], startLabel: 'Inspection started' },
  facilities: { label: 'Facilities', crews: ['Shelter Crew 1', 'Shelter Crew 2', 'Contractor – Cleaning'], startLabel: 'Crew en route' },
  safety: { label: 'Safety', crews: ['Safety Officer 3', 'Road Supervisor 12'], startLabel: 'Safety responding' },
  supervisor: { label: 'Supervisor / Safety', crews: ['Road Supervisor 7', 'Road Supervisor 12', 'Transit Police Liaison'], startLabel: 'Supervisor responding' },
  operations: { label: 'Operations', crews: ['Dispatch Desk', 'Revenue Equipment'], startLabel: 'Dispatch working' },
};

export const PRIORITIES = ['high', 'medium', 'low'];
export const STATUSES = ['New', 'Assigned', 'In Progress', 'Resolved'];

export const deptLabel = (d) => DEPARTMENTS[d]?.label || d;
export const catLabel = (c) => CATEGORIES[c]?.label || c;
export const catShort = (c) => CATEGORIES[c]?.short || c;
