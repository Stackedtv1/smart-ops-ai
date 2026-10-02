import { useEffect } from 'react';
import { NavProvider, useNav, match } from './lib/router.jsx';
import { startGuardian } from './services/guardian.js';
import Copilot from './pages/Copilot.jsx';
import Guardian from './pages/Guardian.jsx';
import FleetHealth, { VehicleDetail } from './pages/FleetHealth.jsx';
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
import { OperatorRelief, OperatorNavigate, OperatorLost, OperatorDispatch, OperatorField } from './pages/OperatorTools.jsx';
import DispatchHub from './pages/DispatchHub.jsx';
import Terminal from './pages/Terminal.jsx';
import LostFound from './pages/LostFound.jsx';

const qs = (path) => new URLSearchParams(path.split('?')[1] || '');

export function Screen({ compact }) {
  const { path } = useNav();
  let m;
  if (path === '/operator') return <OperatorHome />;
  if ((m = match('/operator/report/:type', path))) return <ReportIssue key={path} type={m.type} />;
  if ((m = match('/operator/result/:id', path))) return <AIResult key={path} id={m.id} />;
  if (path === '/operator/pretrip') return <PreTrip />;
  if (path === '/operator/reports') return <MyReports />;
  if (path === '/operator/relief') return <OperatorRelief />;
  if (path.startsWith('/operator/navigate')) return <OperatorNavigate key={path} to={qs(path).get('to')} />;
  if (path === '/operator/lost') return <OperatorLost />;
  if (path === '/operator/dispatch') return <OperatorDispatch />;
  if (path.startsWith('/operator/field')) return <OperatorField key={path} kind={qs(path).get('kind')} relief={qs(path).get('relief')} />;
  if (path === '/dispatch') return <DispatchHub />;
  if (path === '/terminal') return <Terminal />;
  if ((m = match('/terminal/:id', path))) return <Terminal key={path} id={m.id} />;
  if (path === '/lost-found') return <LostFound />;
  if (path === '/dashboard') return <Dashboard compact={compact} />;
  if ((m = match('/ticket/:id', path))) return <TicketDetail key={path} id={m.id} />;
  if (path === '/maintenance') return <Maintenance />;
  if (path === '/facilities') return <Facilities />;
  if (path === '/safety') return <Safety />;
  if (path === '/analytics') return <Analytics />;
  if (path === '/fleet') return <FleetHealth />;
  if ((m = match('/fleet/:bus', path))) return <VehicleDetail key={path} bus={m.bus} />;
  if (path === '/guardian') return <Guardian />;
  if (path === '/copilot') return <Copilot />;
  if (path === '/roi') return <ROI />;
  if (path === '/roi/calculator') return <ROICalculator />;
  return <Login />;
}

// Presenter Mode: operator phone and command dashboard on one screen,
// sharing one live data store.
function Presenter() {
  const { go, path } = useNav();
  const q = qs(path);
  const phoneStart = q.get('phone') || '/operator';
  const dashStart = q.get('dash') || '/dashboard';
  return (
    <div className="presenter">
      <div className="phone-col">
        <div className="row between" style={{ width: '100%', maxWidth: 380 }}>
          <span className="presenter-label">Operator app · Bus 4602</span>
          <button className="btn btn-sm" style={{ background: 'transparent', color: 'var(--bar-ink)', borderColor: 'rgba(255,255,255,.25)' }} onClick={() => go('/')}>Exit</button>
        </div>
        <div className="phone">
          <div className="screen" data-phone-screen>
            <NavProvider initial={phoneStart} scrollTarget="[data-phone-screen]">
              <Screen />
            </NavProvider>
          </div>
        </div>
        <DemoFlag />
      </div>
      <div className="dash-col" data-dash-col>
        <NavProvider initial={dashStart} scrollTarget="[data-dash-col]">
          <Screen compact />
        </NavProvider>
      </div>
    </div>
  );
}

function Root() {
  const { path } = useNav();
  if (path === '/present' || path.startsWith('/present?')) return <Presenter />;
  return <Screen />;
}

export default function App() {
  useEffect(() => startGuardian(), []);
  return (
    <NavProvider syncHash>
      <Root />
    </NavProvider>
  );
}
