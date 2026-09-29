import { useNav } from '../lib/router.jsx';
import { useStore, isOpen } from '../services/store.js';
import DashShell from '../components/DashShell.jsx';
import AskCopilot from '../components/AskCopilot.jsx';
import { MonitorModeBadge } from '../components/ui.jsx';
import { useNow } from '../components/TicketTable.jsx';
import { ago } from '../lib/time.js';

export default function Copilot() {
  const { go } = useNav();
  const g = useStore((s) => s.guardian);
  const open = useStore((s) => s.tickets.filter(isOpen).length);
  const now = useNow(5000);
  const esc = g.followups.filter((f) => !f.closed).length;
  const fixes = g.audit.filter((a) => a.kind === 'auto-fix' && !a.undone).length;
  return (
    <DashShell active="/copilot">
      <div>
        <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>SMART Ops AI Copilot</h1>
        <div className="small muted"><b>Guardian watches. Copilot answers.</b> Ask about the operation in plain English. Answers come from live tickets and Guardian's findings.</div>
      </div>
      <div className="cp-grid">
        <AskCopilot tall />
        <div className="stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h2>Guardian status</h2>
              <MonitorModeBadge />
            </div>
            <div className="panel-b">
              <ol className="ranked" style={{ counterReset: 'r' }}>
                <li><span>Open issues</span><b className="num">{open}</b></li>
                <li><span>Auto-fixes by Guardian</span><b className="num">{fixes}</b></li>
                <li><span>Escalations awaiting a person</span><b className="num">{esc}</b></li>
                <li><span>Last check</span><b>{g.lastSweep ? ago(g.lastSweep, now) : 'starting…'}</b></li>
              </ol>
              <button className="btn btn-block" style={{ marginTop: 12 }} onClick={() => go('/guardian')}>Open Guardian →</button>
            </div>
          </section>
          <section className="panel panel-b small muted stack-sm">
            <b style={{ color: 'var(--ink)' }}>How the two fit together</b>
            <span><b style={{ color: 'var(--ink)' }}>Guardian</b> runs on its own: catches duplicates, misroutes, missing data, overdue work and device or feed problems, fixes what it safely can, and escalates the rest.</span>
            <span><b style={{ color: 'var(--ink)' }}>Copilot</b> is who staff talk to: it explains what's happening and where attention is needed. It never overrides a person's decision on a vehicle or safety issue.</span>
          </section>
        </div>
      </div>
    </DashShell>
  );
}
