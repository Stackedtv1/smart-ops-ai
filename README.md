# SMART Ops AI — Demo / Concept System

Working prototype of a transit operations reporting system: an operator reports a problem by voice, AI structures and routes it, and management sees it on a live command dashboard.

**Operator Mobile App → AI Engine → SMART Command Dashboard**

> Concept prototype by Bestowal Powers A.I. Not affiliated with, endorsed by, or connected to SMART. Route numbers are public SMART routes; fleet numbers, employees and stop IDs are fictional. All operational data is simulated.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # outputs dist/
```

Deploy to Netlify: connect the repo (build `npm run build`, publish `dist`, functions `netlify/functions` — already in `netlify.toml`).

## Environment

Copy `.env.example`. Everything is optional — with nothing set, the demo runs fully on-device.

| Variable | Where | Purpose |
|---|---|---|
| `VITE_AI_MODE` | build | `auto` (default) calls the AI function, falls back on-device. `offline` never calls external APIs — use on bad venue Wi-Fi. |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | build | Cross-device realtime: operator phone → dashboard on the projector. |
| `OPENAI_API_KEY` | Netlify env | Used by `classify-report` and `transcribe-report`. Never exposed to the browser. |
| `OPENAI_MODEL` | Netlify env | Classification model (default `gpt-4o-mini`). |
| `OPENAI_TRANSCRIBE_MODEL` | Netlify env | Speech-to-text model (default `whisper-1`). |

## Supabase (for two-device demos)

1. Create a project, run `supabase/schema.sql` in the SQL editor (tables, realtime, `report-photos` bucket).
2. Set the two `VITE_SUPABASE_*` vars in Netlify and redeploy.
3. Phone opens `/#/operator`, laptop opens `/#/dashboard`. New tickets appear on the dashboard via Supabase Realtime.

The schema's RLS policies allow anonymous access **for the demo only**. Replace with Supabase Auth + role policies before any pilot.

Without Supabase, tabs in the same browser still sync (BroadcastChannel), and **Presenter Mode** shows the phone and dashboard side by side on one screen.

## Demo script (8–10 min)

1. **Login** → Operator → Demo Login (Marcus Johnson, DEMO-1047, Bus 4602, Route 461). Or open **Presenter Mode**.
2. **Report Vehicle Issue** → tap mic and speak, or tap ▶ *Rear door sticking*. Submit → AI analysis → *Ticket SMART-YYMMDD-0142 Created*.
3. Dashboard: Open Issues 14 → 15, new red marker pulses on Woodward, toast appears, and the **AI Pattern Alert** for Bus 4602 fires (3 door reports in 16 days).
4. **Stop / Shelter** → ▶ *Broken shelter glass + trash* → Facilities ticket. Woodward & 9 Mile repeat-location alert goes to 5.
5. **Safety** → ▶ *Aggressive passenger* → Supervisor / Safety, with the emergency-procedures disclaimer.
6. **Maintenance** tab → select the door job → Accept Job → Resolve (note required) → dashboard updates. Report → Route → Repair → Resolution.
7. **Pre-Trip Inspection** → mark Doors as Defect → ticket created automatically.
8. **Analytics** → category mix, garage/shift, repeat problems, digital-reporting adoption (team-level only).
9. **Guardian** → *Live scenario: Bus 4721 brake warning*. Watch it detect the 3rd brake report in 48 h, merge the duplicate, raise priority, alert the Macomb maintenance supervisor, then escalate to the Operations Manager if nobody acknowledges within 2 minutes (demo timer). Show the audit trail and Undo. Then open **Copilot** and ask “What are our biggest unresolved issues right now?”
10. **ROI** → estimated annual value, payback and ROI. *Open full calculator* to enter SMART's own numbers (Conservative / Expected presets).

**Backup:** Demo menu → *Load Demo Scenario* (or `Shift + D`) creates 5 tickets with no network or API. *Reset demo data* restores the morning baseline (17 open issues, including the Guardian demo tickets).

## Guardian and Copilot

**Guardian watches. Copilot answers.**

- **SMART Ops AI Guardian** (`src/services/guardian.js`, Guardian tab) is the monitoring and automation layer: it watches tickets, catches failures, validates data, escalates overdue issues. In the demo it runs every 15 s in the open browser; in production it runs 24/7 server-side. A badge on screen says exactly that.
- **SMART Ops AI Copilot** (`src/services/copilot.js`, `netlify/functions/ask-copilot.js`, Copilot tab) is the staff-facing assistant: “Which buses have repeat defects?”, “What issues need attention right now?”

### Guardian rules

Guardian runs every 15 s while the app is open (in production: a scheduled server job). Each finding goes Detect → Diagnose → Correct workflow / Escalate → Follow up, and every change is logged with the reason, who was notified, and an undo snapshot.

| Rule | Guardian action |
|---|---|
| Same vehicle + defect reported again within 48 h | Merge duplicates into one ticket; 3+ reports → raise to HIGH, alert maintenance supervisor, follow up |
| Ticket in the wrong department | Reroute (unless a person chose that routing) |
| Vehicle defect with no bus number | Fill from operator sign-on record, or ask the operator |
| Unassigned > 15 min | Assign least-loaded crew |
| Safety report unacknowledged > 10 min, or HIGH job not started > 45 min | Escalate; escalate again if no one acknowledges |
| Repeat defect pattern | Flag for maintenance review |
| GTFS feed missing/expiring, stop IDs not in feed, tablet offline > 60 min | Notify data team / garage IT |

Guardrails (enforced in code): Guardian never resolves a vehicle or safety ticket, never lowers their priority, and never states a bus is repaired or safe. `netlify/functions/ask-copilot.js` answers staff questions from a live data snapshot when `OPENAI_API_KEY` is set; otherwise answers come from the built-in query engine.

## AI contract

The classifier must return JSON, never paragraphs (enforced with OpenAI structured outputs):

```json
{
  "category": "vehicle_defect",
  "subcategory": "passenger_door",
  "priority": "high",
  "department": "maintenance",
  "summary": "Rear passenger door sticking and failing to close correctly.",
  "safety_review_required": true,
  "confidence": 0.96
}
```

Guardrails: the AI never decides whether a bus is safe to operate ("Supervisor / Maintenance Review Required"), never replaces emergency procedures, and pattern alerts recommend review rather than repairs.

## Structure

```
src/
  pages/        Login, OperatorHome, ReportIssue, AIResult, PreTrip, MyReports,
                Dashboard, TicketDetail, Maintenance, Facilities, Safety, Analytics
  components/   IssueMap (built-in vector transit map), TicketTable, DashShell, Widgets, ui
  services/     ai.js (API + on-device fallback), store.js (tickets, pattern detection,
                demo scenario), supabase.js (optional realtime), maps.js
  data/         demoRoutes.json, demoStops.json, demoVehicles.json, demoReports.json
netlify/functions/  classify-report.js, transcribe-report.js
supabase/schema.sql
```

## Known limits / next steps

- Route shapes and stops come from SMART's public GTFS feed, downloaded during each Netlify build by `scripts/fetch-gtfs.mjs` (prebuild). If the feed can't be reached, the map falls back to simplified corridors and the map credit says so. Test locally with `GTFS_FILE=smart_gtfs.zip npm run gtfs`.
- The map is a built-in vector map so it works offline and in sandboxed previews. Leaflet + OpenStreetMap tiles can replace `IssueMap.jsx` if street-level detail is wanted.
- Garage names ("Oakland/Macomb/Wayne Terminal") are placeholders — confirm SMART's actual facility names before presenting.
- Live voice uses the browser's speech recognition (Chrome, Safari). Where unavailable it records audio and calls `transcribe-report`; typing and demo scripts always work.
