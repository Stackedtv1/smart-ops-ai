import { useEffect } from 'react';
import { NavProvider, useNav, match } from './lib/router.jsx';
import { startCopilot } from './services/copilot.js';
import Copilot from './pages/Copilot.jsx';
import Login from './pages/Login.jsx';
import OperatorHome from './pages/OperatorHome.jsx';
import ReportIssue from './pages/ReportIssue.jsx';
import AIResult from './pages/AIResult.jsx';
import PreTrip from './pages/PreTrip.jsx';
import MyReports from './pages/MyReports.jsx';
import Dashboard from './pages/Dashboard.jsx';
import TicketDetail from './pages/TicketDetail.jsx';
import Maintenance from './pages/Maintenance.jsx';
import Facilities from './pages/Facilities.jsx';
import Safety from './pages/Safety.jsx';
import Analytics from './pages/Analytics.jsx';
import ROI, { ROICalculator } from './pages/ROI.jsx';
import { DemoFlag } from './components/ui.jsx';

export function Screen({ compact }) {
  const { path } = useNav();
  let m;
  if (path === '/operator') return <OperatorHome />;
  if ((m = match('/operator/report/:type', path))) return <ReportIssue key={path} type={m.type} />;
  if ((m = match('/operator/result/:id', path))) return <AIResult key={path} id={m.id} />;
  if (path === '/operator/pretrip') return <PreTrip />;
  if (path === '/operator/reports') return <MyReports />;
  if (path === '/dashboard') return <Dashboard compact={compact} />;
  if ((m = match('/ticket/:id', path))) return <TicketDetail key={path} id={m.id} />;
  if (path === '/maintenance') return <Maintenance />;
  if (path === '/facilities') return <Facilities />;
  if (path === '/safety') return <Safety />;
  if (path === '/analytics') return <Analytics />;
  if (path === '/copilot') return <Copilot />;
  if (path === '/roi') return <ROI />;
  if (path === '/roi/calculator') return <ROICalculator />;
  return <Login />;
}

// Presenter Mode: operator phone and command dashboard on one screen,
// sharing one live data store.
function Presenter() {
  const { go } = useNav();
  return (
    <div className="presenter">
      <div className="phone-col">
        <div className="row between" style={{ width: '100%', maxWidth: 380 }}>
          <span className="presenter-label">Operator app · Bus 4602</span>
          <button className="btn btn-sm" style={{ background: 'transparent', color: 'var(--bar-ink)', borderColor: 'rgba(255,255,255,.25)' }} onClick={() => go('/')}>Exit</button>
        </div>
        <div className="phone">
          <div className="screen" data-phone-screen>
            <NavProvider initial="/operator" scrollTarget="[data-phone-screen]">
              <Screen />
            </NavProvider>
          </div>
        </div>
        <DemoFlag />
      </div>
      <div className="dash-col" data-dash-col>
        <NavProvider initial="/dashboard" scrollTarget="[data-dash-col]">
          <Screen compact />
        </NavProvider>
      </div>
    </div>
  );
}

function Root() {
  const { path } = useNav();
  if (path === '/present') return <Presenter />;
  return <Screen />;
}

export default function App() {
  useEffect(() => startCopilot(), []);
  return (
    <NavProvider syncHash>
      <Root />
    </NavProvider>
  );
}
