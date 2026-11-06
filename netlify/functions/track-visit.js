// POST /.netlify/functions/track-visit — record one app open or sign-in.
// Body: { event: 'open'|'login'|'presenter', role?, account?, visitor?, referrer?, owner? }
// Adds city/region/country (Netlify geo) and device/browser (user agent),
// then inserts into Supabase so_visits. Bots and link scanners are dropped.
// Read the log at /#/owner?key=<owner key> (see supabase/schema.sql).

const URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const EVENTS = new Set(['open', 'login', 'presenter']);
const BOT = /bot|crawl|spider|preview|scanner|headless|lighthouse|python|curl|wget|node-fetch|axios|go-http|java\/|facebookexternalhit|slackbot|whatsapp|skypeuripreview|microsoft office|outlook|teams/i;

const clip = (v, n) => (v == null ? null : String(v).slice(0, n));

function device(ua) {
  if (/ipad/i.test(ua)) return 'iPad';
  if (/iphone/i.test(ua)) return 'iPhone';
  if (/android/i.test(ua)) return /mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/macintosh|mac os x/i.test(ua)) return 'Mac';
  if (/cros/i.test(ua)) return 'Chromebook';
  if (/linux/i.test(ua)) return 'Linux';
  return 'Other';
}

function browser(ua) {
  if (/edg\//i.test(ua)) return 'Edge';
  if (/crios|chrome\//i.test(ua)) return 'Chrome';
  if (/fxios|firefox\//i.test(ua)) return 'Firefox';
  if (/safari\//i.test(ua)) return 'Safari';
  return 'Other';
}

export default async (req, context) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 });
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua)) return Response.json({ ok: true, skipped: 'bot' });
  if (!URL || !KEY) return Response.json({ ok: false, error: 'Supabase not configured' });

  let b = {};
  try { b = await req.json(); } catch { /* empty body */ }
  if (!EVENTS.has(b.event)) return Response.json({ ok: false, error: 'bad event' }, { status: 400 });

  const geo = context?.geo || {};
  const row = {
    event: b.event,
    role: clip(b.role, 40),
    account: clip(b.account, 40),
    visitor: clip(b.visitor, 64),
    device: device(ua),
    browser: browser(ua),
    city: clip(geo.city, 80),
    region: clip(geo.subdivision?.name || geo.subdivision?.code, 80),
    country: clip(geo.country?.code, 8),
    referrer: clip(b.referrer, 300),
    is_owner: !!b.owner,
  };

  const res = await fetch(`${URL}/rest/v1/so_visits`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify(row),
  });
  if (!res.ok) return Response.json({ ok: false, error: `insert ${res.status}` }, { status: 502 });
  return Response.json({ ok: true });
};
