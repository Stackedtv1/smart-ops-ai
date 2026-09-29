import { useNav } from '../lib/router.jsx';
import DashShell from '../components/DashShell.jsx';
import { useRoi, computeRoi, applyPreset, setValue, FIELDS, PRESETS, fmtMoney, fmtNum } from '../services/roi.js';

const LINE_COLORS = { paperwork: '#0b5cad', missed: '#0f7a6d', downtime: '#c75f00' };

function PresetSwitch({ preset }) {
  return (
    <div className="filters" role="group" aria-label="Assumption set">
      {Object.entries(PRESETS).map(([k, p]) => (
        <button key={k} className={preset === k ? 'on' : ''} onClick={() => applyPreset(k)} aria-pressed={preset === k}>{p.label}</button>
      ))}
      {preset === 'custom' && <button className="on" aria-pressed="true">Custom</button>}
    </div>
  );
}

function Breakdown({ r }) {
  const max = Math.max(...r.lines.map((l) => l.value), 1);
  return (
    <div className="bars">
      {r.lines.map((l) => (
        <div key={l.key} className="stack-sm" style={{ gap: 4 }}>
          <div className="bar-row" style={{ gridTemplateColumns: 'minmax(120px, 170px) 1fr 96px' }}>
            <span className="lbl">{l.label}</span>
            <span className="track"><span className="fill" style={{ width: `${(l.value / max) * 100}%`, display: 'block', background: LINE_COLORS[l.key] }} /></span>
            <span className="val">{fmtMoney(l.value)}</span>
          </div>
          <span className="xs muted" style={{ paddingLeft: 2 }}>{l.note}</span>
        </div>
      ))}
    </div>
  );
}

const pct = (x) => (x == null ? '—' : `${Math.round(x)}%`);

function Headline({ r, v }) {
  return (
    <>
      <div className="stat-row" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        <div className="stat lead"><div className="n">{fmtMoney(r.total)}</div><div className="l">Estimated annual value</div></div>
        <div className="stat"><div className="n">{fmtMoney(r.net)}</div><div className="l">Year-1 net after {fmtMoney(r.year1Cost)} ({fmtMoney(v.annualCost)} license + {fmtMoney(r.impl)} implementation)</div></div>
        <div className="stat"><div className="n">{r.paybackMonths == null ? '—' : `${r.paybackMonths.toFixed(1)} mo`}</div><div className="l">Payback on year-1 cost</div></div>
        <div className="stat"><div className="n">{pct(r.roiPct)}</div><div className="l">First-year ROI</div></div>
      </div>
      <div className="small muted" style={{ marginTop: -4 }}>
        Year 2 onward (license only): net <b className="num" style={{ color: 'var(--ink)' }}>{fmtMoney(r.ongoingNet)}</b> per year · ROI <b className="num" style={{ color: 'var(--ink)' }}>{pct(r.ongoingRoiPct)}</b>. Pricing shown is an illustrative starting point; final pricing depends on fleet size, garages, integrations and support.
      </div>
    </>
  );
}

export default function ROI() {
  const { go } = useNav();
  const { preset, values: v } = useRoi();
  const r = computeRoi(v);
  return (
    <DashShell active="/roi">
      <div className="row between wrap">
        <div>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>Return on Investment</h1>
          <div className="small muted">What faster, digital operator reporting could be worth each year · illustrative estimate</div>
        </div>
        <PresetSwitch preset={preset} />
      </div>

      <Headline r={r} v={v} />

      <div className="an-grid">
        <section className="panel">
          <div className="panel-h"><h2>Where the value comes from</h2><span className="small muted">Per year</span></div>
          <div className="panel-b"><Breakdown r={r} /></div>
        </section>
        <section className="panel">
          <div className="panel-h"><h2>Operational impact</h2></div>
          <div className="panel-b">
            <ol className="ranked" style={{ counterReset: 'r' }}>
              <li><span>Reports handled digitally per year</span><b className="num">{fmtNum(r.reportsYr)}</b></li>
              <li><span>Staff hours returned to real work</span><b className="num">{fmtNum(r.hoursReturned)}</b></li>
              <li><span>Routing speed, paper vs. digital</span><b className="num">{Math.round(r.speedup)}× faster</b></li>
              <li><span>Road calls avoided</span><b className="num">{fmtNum(r.roadCallsAvoided)}</b></li>
              <li><span>Bus-hours back in service</span><b className="num">{fmtNum(r.busHoursSaved)}</b></li>
            </ol>
          </div>
        </section>
      </div>

      <section className="panel panel-b row between wrap" style={{ gap: 12 }}>
        <div className="stack-sm" style={{ gap: 2, maxWidth: '70ch' }}>
          <b>Every number here is an adjustable assumption.</b>
          <span className="small muted">Enter SMART's own road-call counts, labor rates and report volumes in the full calculator. Paperwork savings are staff capacity returned to other work, not necessarily a budget cut.</span>
        </div>
        <button className="btn btn-primary btn-lg" onClick={() => go('/roi/calculator')}>Open full calculator</button>
      </section>
    </DashShell>
  );
}

export function ROICalculator() {
  const { go } = useNav();
  const { preset, values: v } = useRoi();
  const r = computeRoi(v);
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  return (
    <DashShell active="/roi">
      <div className="row between wrap">
        <div>
          <button className="btn btn-ghost btn-sm" onClick={() => go('/roi')}>← ROI summary</button>
          <h1 className="display" style={{ fontSize: 30, fontWeight: 700, letterSpacing: '.02em' }}>ROI Calculator</h1>
          <div className="small muted">Adjust any assumption. Results update instantly and carry over to the ROI summary.</div>
        </div>
        <PresetSwitch preset={preset} />
      </div>

      <div className="calc-grid">
        <div className="stack" style={{ gap: 16 }}>
          {groups.map((g) => (
            <section key={g} className="panel">
              <div className="panel-h"><h2>{g}</h2></div>
              <div className="panel-b stack" style={{ gap: 14 }}>
                {FIELDS.filter((f) => f.group === g).map((f) => (
                  <div key={f.key} className="calc-field">
                    <label htmlFor={`roi-${f.key}`} className="small" style={{ fontWeight: 600 }}>{f.label}</label>
                    <div className="row" style={{ gap: 10 }}>
                      <input
                        type="range" className="grow" min={f.min} max={f.max} step={f.step} value={v[f.key]}
                        onChange={(e) => setValue(f.key, Number(e.target.value))} aria-label={f.label}
                      />
                      <span className="calc-num">
                        {f.unit === '$' && <span className="muted">$</span>}
                        <input
                          id={`roi-${f.key}`} type="number" inputMode="decimal" min={f.min} step={f.step} value={v[f.key]}
                          onChange={(e) => e.target.value !== '' && setValue(f.key, Math.max(0, Number(e.target.value)))}
                        />
                        {f.unit !== '$' && <span className="muted xs">{f.unit}</span>}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="calc-results stack" style={{ gap: 16 }}>
          <section className="panel">
            <div className="panel-h"><h2>Results</h2><span className="demo-data">Estimate</span></div>
            <div className="panel-b stack">
              <div>
                <div className="eyebrow">Estimated annual value</div>
                <div className="display num" style={{ fontSize: 46, fontWeight: 700, lineHeight: 1 }}>{fmtMoney(r.total)}</div>
              </div>
              <dl className="kv">
                <dt>Annual license</dt><dd className="num">{fmtMoney(v.annualCost)}</dd>
                <dt>Implementation (one-time)</dt><dd className="num">{fmtMoney(r.impl)}</dd>
                <dt>Year-1 net</dt><dd className="num" style={{ color: r.net >= 0 ? 'var(--ok)' : 'var(--high)' }}>{fmtMoney(r.net)}</dd>
                <dt>First-year ROI</dt><dd className="num">{pct(r.roiPct)}</dd>
                <dt>Year 2+ net / yr</dt><dd className="num" style={{ color: r.ongoingNet >= 0 ? 'var(--ok)' : 'var(--high)' }}>{fmtMoney(r.ongoingNet)}</dd>
                <dt>Year 2+ ROI</dt><dd className="num">{pct(r.ongoingRoiPct)}</dd>
                <dt>Payback</dt><dd className="num">{r.paybackMonths == null ? '—' : `${r.paybackMonths.toFixed(1)} months`}</dd>
                <dt>Staff capacity</dt><dd className="num">{fmtNum(r.hoursReturned)} hrs ({r.fte.toFixed(1)} FTE)</dd>
                <dt>Delay removed</dt><dd className="num">{fmtNum(r.delayHoursRemoved)} report-hours</dd>
              </dl>
              <Breakdown r={r} />
            </div>
          </section>
          <section className="panel panel-b small muted stack-sm">
            <b style={{ color: 'var(--ink)' }}>How it's calculated</b>
            <span>Paperwork = reports × days × (paper − digital minutes) × labor rate.</span>
            <span>Missed defects = road calls × 12 × preventable share × cost per call.</span>
            <span>Downtime = vehicle-defect reports that hold a bus × hours saved × bus-hour cost.</span>
            <span>Year 1 cost = annual license + one-time implementation. Year 2+ = license only.</span>
            <span>Routing delay is shown for context and not counted as dollars, to avoid double counting.</span>
          </section>
        </div>
      </div>
    </DashShell>
  );
}
