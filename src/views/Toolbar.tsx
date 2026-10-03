import type { DashboardState, DashboardViewModel } from '../viewmodel/DashboardViewModel';
import { formatClock } from './format';

interface Props {
  state: DashboardState;
  vm: DashboardViewModel;
}

export function Toolbar({ state, vm }: Props) {
  const calibrating = state.calibration.phase === 'relax' || state.calibration.phase === 'contract';

  const handleExport = () => {
    const csv = vm.exportCsv();
    if (!csv) return;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `myoscope-session-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
          <path d="M2 14h5l2-6 3 13 3-17 3 14 2-4h6" fill="none" stroke="currentColor" strokeWidth="2.2"
            strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>MyoScope</span>
      </div>

      <dl className="session-stats">
        <div>
          <dt>Session</dt>
          <dd>{formatClock(state.elapsedSeconds)}</dd>
        </div>
        <div>
          <dt>Reps</dt>
          <dd>{state.repCount}</dd>
        </div>
        <div>
          <dt>Normalization</dt>
          <dd className={state.isCalibrated ? 'ok' : 'muted'}>{state.isCalibrated ? '% of max' : 'Raw mV'}</dd>
        </div>
      </dl>

      <div className="controls">
        <label className="window-select">
          Time window
          <select value={state.windowSeconds} onChange={(e) => vm.setWindowSeconds(Number(e.target.value))}>
            <option value={3}>3 s</option>
            <option value={5}>5 s</option>
            <option value={10}>10 s</option>
          </select>
        </label>
        <button className="btn secondary" onClick={vm.calibrate} disabled={calibrating}>
          {state.isCalibrated ? 'Recalibrate' : 'Calibrate'}
        </button>
        <button className="btn secondary" onClick={handleExport} disabled={!state.hasData}>
          Export CSV
        </button>
        <button className="btn secondary" onClick={vm.reset} disabled={!state.hasData}>
          Reset
        </button>
        {state.isStreaming ? (
          <button className="btn primary stop" onClick={vm.stop}>Stop</button>
        ) : (
          <button className="btn primary" onClick={vm.start}>{state.hasData ? 'Resume' : 'Start streaming'}</button>
        )}
      </div>
    </header>
  );
}
