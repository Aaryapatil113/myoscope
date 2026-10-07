import type { FatigueState, FatigueStatus } from '../viewmodel/DashboardViewModel';

interface Props {
  fatigue: FatigueState;
  isStreaming: boolean;
}

const COPY: Record<FatigueStatus, { label: string; body: string }> = {
  waiting: { label: 'Measuring', body: 'Keep curling. Your starting level is set after a few seconds.' },
  fresh: { label: 'Fresh', body: 'Muscle signal is close to your starting level.' },
  tiring: { label: 'Tiring', body: 'Signal frequency is dropping as fatigue builds.' },
  fatigued: { label: 'Fatigued', body: 'Signal frequency is well below your start. Consider resting.' },
};

const CHART_W = 248;
const CHART_H = 56;
const MIN_POINTS = 60; // the line fills in from the left over the first minute
const MIN_SPAN_HZ = 30; // keeps normal second-to-second jitter from looking dramatic

export function FatiguePanel({ fatigue, isStreaming }: Props) {
  const { history, baselineHz, medianHz, changePercent, status } = fatigue;
  const copy = COPY[status];
  const idle = history.length === 0 && !isStreaming;

  return (
    <section className="fatigue" aria-label={`${fatigue.muscle} fatigue`}>
      <header className="fatigue-head">
        <h2>Fatigue</h2>
        <span>{fatigue.muscle}</span>
      </header>

      <div className="fatigue-readout">
        <div className="fatigue-value">
          {medianHz === null ? '–' : Math.round(medianHz)}
          <span>Hz median</span>
        </div>
        {!idle && (
          <span className={`fatigue-status ${status}`} aria-live="polite">{copy.label}</span>
        )}
      </div>

      <Trend history={history} baselineHz={baselineHz} color={fatigue.color} />

      <p className="fatigue-note">
        {idle ? 'Start streaming to track fatigue in the biceps.' : copy.body}
      </p>
      {changePercent !== null && baselineHz !== null && (
        <p className="fatigue-meta">
          {formatChange(changePercent)} from start ({Math.round(baselineHz)} Hz)
        </p>
      )}
    </section>
  );
}

/**
 * Median-frequency trend. Data arrives once per second through the snapshot,
 * so a React-rendered SVG is cheap here. No canvas loop needed, unlike the traces.
 */
function Trend({ history, baselineHz, color }: { history: readonly number[]; baselineHz: number | null; color: string }) {
  const values = baselineHz === null ? history : [...history, baselineHz];
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 0;
  if (hi - lo < MIN_SPAN_HZ) {
    const mid = (hi + lo) / 2;
    lo = mid - MIN_SPAN_HZ / 2;
    hi = mid + MIN_SPAN_HZ / 2;
  }
  const slots = Math.max(history.length, MIN_POINTS) - 1;
  const x = (i: number) => (i / slots) * CHART_W;
  const y = (hz: number) => 4 + (1 - (hz - lo) / (hi - lo)) * (CHART_H - 8);
  const points = history.map((hz, i) => `${x(i).toFixed(1)},${y(hz).toFixed(1)}`).join(' ');
  const last = history.length - 1;

  const summary = history.length
    ? `Median frequency trend over the last ${history.length} seconds, from ${Math.round(history[0])} to ${Math.round(history[last])} Hz`
    : 'Median frequency trend, no data yet';

  return (
    <svg className="fatigue-trend" viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none"
      role="img" aria-label={summary}>
      {baselineHz !== null && (
        <line x1={0} x2={CHART_W} y1={y(baselineHz)} y2={y(baselineHz)} className="fatigue-baseline" />
      )}
      {history.length > 1 && (
        <polyline points={points} fill="none" stroke={color} strokeWidth={1.75}
          strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      )}
      {/* Zero-length round-capped stroke: stays a circle even though the chart stretches */}
      {last >= 0 && (
        <path d={`M${x(last).toFixed(1)},${y(history[last]).toFixed(1)}h0`} stroke={color} strokeWidth={5}
          strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

function formatChange(percent: number): string {
  const rounded = Math.round(percent);
  if (rounded === 0) return 'No change';
  return `${rounded < 0 ? 'Down' : 'Up'} ${Math.abs(rounded)}%`;
}
